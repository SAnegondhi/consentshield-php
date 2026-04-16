// Supabase Edge Function: check-stuck-deletions
// Scheduled hourly via pg_cron. Owns the retry/timeout state machine for
// `deletion_receipts.status = 'awaiting_callback'`. See ADR-0011.
//
// Runs as cs_orchestrator. Decrypts `integration_connectors.config` using
// per-org HMAC-derived key + the same pgcrypto `decrypt_secret` RPC that the
// Next.js app uses — no plaintext secrets leave the DB/Edge boundary.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
const MASTER_KEY = Deno.env.get('MASTER_ENCRYPTION_KEY')

if (!ORCHESTRATOR_KEY) {
  throw new Error('CS_ORCHESTRATOR_ROLE_KEY is required.')
}
if (!MASTER_KEY) {
  throw new Error('MASTER_ENCRYPTION_KEY is required to decrypt connector config.')
}

// Backoff applied after retry N completes. After retry #3, the receipt is
// marked failed regardless of outcome.
const BACKOFF_HOURS = [1, 6, 24]
const MAX_RETRIES = 3
const WEBHOOK_TIMEOUT_MS = 10_000

interface StuckReceipt {
  id: string
  org_id: string
  connector_id: string | null
  trigger_type: string
  trigger_id: string | null
  retry_count: number | null
  requested_at: string
  request_payload: {
    callback_url?: string
    deadline?: string
  } | null
}

interface ConnectorConfig {
  webhook_url: string
  shared_secret?: string
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)
  const now = new Date()
  const nowIso = now.toISOString()
  const cutoff30dIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: stuck, error } = await supabase
    .from('deletion_receipts')
    .select('id, org_id, connector_id, trigger_type, trigger_id, retry_count, requested_at, request_payload')
    .eq('status', 'awaiting_callback')
    .gt('requested_at', cutoff30dIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const summary = { scanned: (stuck ?? []).length, retried: 0, failed: 0, skipped: 0 }

  for (const receipt of (stuck ?? []) as StuckReceipt[]) {
    try {
      const outcome = await processReceipt(supabase, receipt, now)
      if (outcome === 'retried') summary.retried++
      else if (outcome === 'failed') summary.failed++
      else summary.skipped++
    } catch (e) {
      console.error(`[check-stuck-deletions] ${receipt.id}`, e)
      summary.skipped++
    }
  }

  return new Response(JSON.stringify({ ok: true, at: nowIso, ...summary }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

async function processReceipt(
  supabase: SupabaseClient,
  r: StuckReceipt,
  now: Date,
): Promise<'retried' | 'failed' | 'skipped'> {
  if (!r.connector_id) return 'skipped'

  const currentRetries = r.retry_count ?? 0
  const nextRetries = currentRetries + 1

  const config = await loadConnectorConfig(supabase, r.org_id, r.connector_id)
  if (!config) {
    await markFailed(supabase, r, 'connector config unavailable', nextRetries)
    return 'failed'
  }

  const identifier = await resolveIdentifier(supabase, r.trigger_type, r.trigger_id)

  const payload = {
    event: 'deletion_request',
    request_id: r.trigger_id,
    receipt_id: r.id,
    data_principal: identifier
      ? { identifier, identifier_type: 'email' }
      : { identifier_hash: r.id, identifier_type: 'opaque' },
    reason: r.trigger_type,
    callback_url: r.request_payload?.callback_url ?? null,
    deadline: r.request_payload?.deadline ?? null,
    retry_attempt: nextRetries,
  }
  const body = JSON.stringify(payload)

  const signature = config.shared_secret
    ? await hmacHex(config.shared_secret, body)
    : null

  let ok = false
  let reason = ''
  try {
    const res = await fetch(config.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-ConsentShield-Signature': signature } : {}),
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    if (res.ok) ok = true
    else reason = `HTTP ${res.status}`
  } catch (e) {
    reason = e instanceof Error ? e.message : 'network error'
  }

  if (!ok && nextRetries >= MAX_RETRIES) {
    await markFailed(supabase, r, `${reason} (retries exhausted)`, nextRetries)
    return 'failed'
  }

  const backoffHours = BACKOFF_HOURS[Math.min(nextRetries, BACKOFF_HOURS.length) - 1]
  const nextRetryAt = new Date(now.getTime() + backoffHours * 3_600_000).toISOString()

  const update: Record<string, unknown> = {
    retry_count: nextRetries,
    next_retry_at: nextRetryAt,
  }
  if (!ok) update.failure_reason = reason

  await supabase.from('deletion_receipts').update(update).eq('id', r.id)
  return 'retried'
}

async function markFailed(
  supabase: SupabaseClient,
  r: StuckReceipt,
  reason: string,
  retryCount: number,
) {
  await supabase
    .from('deletion_receipts')
    .update({ status: 'failed', failure_reason: reason, retry_count: retryCount })
    .eq('id', r.id)

  await supabase.from('audit_log').insert({
    org_id: r.org_id,
    event_type: 'deletion_retry_exhausted',
    entity_type: 'deletion_receipt',
    entity_id: r.id,
    payload: {
      failure_reason: reason,
      retry_count: retryCount,
      trigger_type: r.trigger_type,
      trigger_id: r.trigger_id,
    },
  })
}

async function loadConnectorConfig(
  supabase: SupabaseClient,
  orgId: string,
  connectorId: string,
): Promise<ConnectorConfig | null> {
  const { data: conn } = await supabase
    .from('integration_connectors')
    .select('config')
    .eq('id', connectorId)
    .single()
  if (!conn) return null

  const { data: org } = await supabase
    .from('organisations')
    .select('encryption_salt')
    .eq('id', orgId)
    .single()
  if (!org) return null

  const salt = (org as { encryption_salt: string }).encryption_salt
  const derivedKey = await hmacHex(MASTER_KEY!, `${orgId}${salt}`)

  const configField = (conn as { config: string }).config
  const ciphertext = configField.startsWith('\\x') ? configField : `\\x${configField}`

  const { data: plaintext, error } = await supabase.rpc('decrypt_secret', {
    ciphertext,
    derived_key: derivedKey,
  })
  if (error || typeof plaintext !== 'string') return null

  try {
    return JSON.parse(plaintext) as ConnectorConfig
  } catch {
    return null
  }
}

async function resolveIdentifier(
  supabase: SupabaseClient,
  triggerType: string,
  triggerId: string | null,
): Promise<string | null> {
  if (!triggerId) return null
  if (triggerType === 'erasure_request') {
    const { data } = await supabase
      .from('rights_requests')
      .select('requestor_email')
      .eq('id', triggerId)
      .single()
    return (data as { requestor_email: string } | null)?.requestor_email ?? null
  }
  return null
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
