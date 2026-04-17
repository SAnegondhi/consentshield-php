// ADR-0039 — HubSpot OAuth provider.
//
// HubSpot access tokens expire (~6 hours). Refresh tokens are long-lived and
// rotated by the oauth-token-refresh-daily cron as tokens approach expiry.

import type { OAuthProviderConfig, TokenBundle } from './types'

const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize'
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token'
const ACCOUNT_INFO_URL = 'https://api.hubapi.com/account-info/v3/details'

const DEFAULT_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'oauth',
].join(' ')

export function hubspotProvider(): OAuthProviderConfig | null {
  const client_id = process.env.HUBSPOT_OAUTH_CLIENT_ID
  const client_secret = process.env.HUBSPOT_OAUTH_CLIENT_SECRET
  if (!client_id || !client_secret) return null

  return {
    id: 'hubspot',
    display_name: 'HubSpot',
    client_id,
    client_secret,
    authorize_url: (state, redirectUri) => {
      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('client_id', client_id)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', DEFAULT_SCOPES)
      url.searchParams.set('state', state)
      return url.toString()
    },
    exchange_code: async ({ code, redirectUri }) =>
      exchangeOrRefresh({
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id,
          client_secret,
          redirect_uri: redirectUri,
          code,
        }),
      }),
    refresh: async (refresh_token) =>
      exchangeOrRefresh({
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id,
          client_secret,
          refresh_token,
        }),
      }),
  }
}

async function exchangeOrRefresh({ body }: { body: URLSearchParams }): Promise<TokenBundle> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) {
    throw new Error(`HubSpot token call failed: ${resp.status} ${await resp.text()}`)
  }
  const tok = (await resp.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  const expires_at = new Date(Date.now() + tok.expires_in * 1000).toISOString()

  // Fetch portal id for reference.
  const acc = await fetch(ACCOUNT_INFO_URL, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  })
  let portal_id: number | undefined
  if (acc.ok) {
    try {
      const data = (await acc.json()) as { portalId?: number }
      portal_id = data.portalId
    } catch {
      // best-effort; non-critical.
    }
  }

  return {
    auth_type: 'oauth2',
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at,
    portal_id,
  }
}
