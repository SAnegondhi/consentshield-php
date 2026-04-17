// ADR-0039 — daily cron. Refreshes OAuth access tokens approaching expiry.
//
// Walks integration_connectors rows whose encrypted config JSON indicates
// auth_type='oauth2' and expires_at within the next 7 days. Currently only
// HubSpot tokens expire; Mailchimp is skipped (no refresh_token).
//
// Decrypts the config via the encrypt_secret_v2 / decrypt_secret RPC
// pattern; re-encrypts the refreshed bundle. Preserves provider metadata
// (portal_id, server_prefix) across the rotation.
//
// Runs as cs_orchestrator. Deployed with --no-verify-jwt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) throw new Error('CS_ORCHESTRATOR_ROLE_KEY is required')

const HUBSPOT_CLIENT_ID = Deno.env.get('HUBSPOT_OAUTH_CLIENT_ID') ?? ''
const HUBSPOT_CLIENT_SECRET = Deno.env.get('HUBSPOT_OAUTH_CLIENT_SECRET') ?? ''

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

interface Connector {
  id: string
  org_id: string
  connector_type: string
  config: string // bytea base64/hex depending on PostgREST serialisation
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  const { data: connectors, error } = await supabase
    .from('integration_connectors')
    .select('id, org_id, connector_type, config')
    .eq('status', 'active')
  if (error) {
    return json({ error: error.message }, 500)
  }

  const rows = (connectors ?? []) as Connector[]
  let inspected = 0
  let refreshed = 0
  let skipped = 0
  const failures: Array<{ id: string; error: string }> = []

  for (const c of rows) {
    if (c.connector_type !== 'hubspot') {
      continue
    }
    inspected++
    try {
      const plaintext = await decryptForOrg(supabase, c.org_id, c.config)
      const bundle = JSON.parse(plaintext) as {
        auth_type?: string
        access_token?: string
        refresh_token?: string
        expires_at?: string
        portal_id?: number
      }
      if (bundle.auth_type !== 'oauth2' || !bundle.refresh_token) {
        skipped++
        continue
      }
      const expiresAt = bundle.expires_at ? new Date(bundle.expires_at).getTime() : 0
      if (expiresAt - Date.now() > REFRESH_WINDOW_MS) {
        skipped++
        continue
      }
      if (!HUBSPOT_CLIENT_ID || !HUBSPOT_CLIENT_SECRET) {
        failures.push({ id: c.id, error: 'HubSpot OAuth env vars unset' })
        continue
      }

      const newBundle = await refreshHubspot(bundle.refresh_token, bundle.portal_id)
      const ciphertext = await encryptForOrg(
        supabase,
        c.org_id,
        JSON.stringify(newBundle),
      )
      const { error: uerr } = await supabase
        .from('integration_connectors')
        .update({
          config: ciphertext,
          last_health_check_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', c.id)
      if (uerr) throw new Error(uerr.message)
      refreshed++
    } catch (e) {
      failures.push({
        id: c.id,
        error: e instanceof Error ? e.message : String(e),
      })
      await supabase
        .from('integration_connectors')
        .update({
          last_error: e instanceof Error ? e.message : String(e),
          last_health_check_at: new Date().toISOString(),
        })
        .eq('id', c.id)
    }
  }

  return json({ inspected, refreshed, skipped, failures }, 200)
})

async function refreshHubspot(
  refresh_token: string,
  portal_id: number | undefined,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: HUBSPOT_CLIENT_ID,
    client_secret: HUBSPOT_CLIENT_SECRET,
    refresh_token,
  })
  const resp = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) {
    throw new Error(`HubSpot refresh failed: ${resp.status} ${await resp.text()}`)
  }
  const tok = (await resp.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  return {
    auth_type: 'oauth2',
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    portal_id,
  }
}

// The Deno Edge Function can call the same pgcrypto wrappers the app uses:
// encrypt_secret / decrypt_secret RPCs. They take the derived key; we have
// to derive it here too (same formula as packages/encryption).

async function deriveOrgKey(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<string> {
  const { data: org } = await supabase
    .from('organisations')
    .select('encryption_salt')
    .eq('id', orgId)
    .single()
  if (!org?.encryption_salt) throw new Error(`no encryption_salt for org ${orgId}`)
  // Derivation formula must match packages/encryption/src/crypto.ts:
  // hmac-sha256(masterSecret, `${orgId}${salt}`) in hex.
  const masterKey = Deno.env.get('MASTER_ENCRYPTION_KEY') ?? ''
  if (!masterKey) throw new Error('MASTER_ENCRYPTION_KEY unset')
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    keyMaterial,
    enc.encode(`${orgId}${org.encryption_salt}`),
  )
  return toHex(new Uint8Array(sig))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function encryptForOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  plaintext: string,
): Promise<string> {
  const key = await deriveOrgKey(supabase, orgId)
  const { data, error } = await supabase.rpc('encrypt_secret', {
    plaintext,
    derived_key: key,
  })
  if (error) throw new Error(`encrypt_secret: ${error.message}`)
  return data as string
}

async function decryptForOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  ciphertext: string,
): Promise<string> {
  const key = await deriveOrgKey(supabase, orgId)
  const { data, error } = await supabase.rpc('decrypt_secret', {
    ciphertext,
    derived_key: key,
  })
  if (error) throw new Error(`decrypt_secret: ${error.message}`)
  return data as string
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
