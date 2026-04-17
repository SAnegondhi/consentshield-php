// ADR-0039 — Mailchimp OAuth provider.
//
// Mailchimp access tokens never expire (no refresh_token flow). server_prefix
// returned by the metadata endpoint is required for all API calls — persist
// it alongside the access_token.

import type { OAuthProviderConfig, TokenBundle } from './types'

const AUTHORIZE_URL = 'https://login.mailchimp.com/oauth2/authorize'
const TOKEN_URL = 'https://login.mailchimp.com/oauth2/token'
const METADATA_URL = 'https://login.mailchimp.com/oauth2/metadata'

export function mailchimpProvider(): OAuthProviderConfig | null {
  const client_id = process.env.MAILCHIMP_OAUTH_CLIENT_ID
  const client_secret = process.env.MAILCHIMP_OAUTH_CLIENT_SECRET
  if (!client_id || !client_secret) return null

  return {
    id: 'mailchimp',
    display_name: 'Mailchimp',
    client_id,
    client_secret,
    authorize_url: (state, redirectUri) => {
      const url = new URL(AUTHORIZE_URL)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', client_id)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      return url.toString()
    },
    exchange_code: async ({ code, redirectUri }) => {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id,
        client_secret,
        redirect_uri: redirectUri,
        code,
      })
      const resp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      if (!resp.ok) {
        throw new Error(`Mailchimp token exchange failed: ${resp.status} ${await resp.text()}`)
      }
      const tok = (await resp.json()) as { access_token: string }

      // Fetch metadata (server prefix etc).
      const mdResp = await fetch(METADATA_URL, {
        headers: { Authorization: `OAuth ${tok.access_token}` },
      })
      if (!mdResp.ok) {
        throw new Error(`Mailchimp metadata failed: ${mdResp.status} ${await mdResp.text()}`)
      }
      const md = (await mdResp.json()) as { dc: string; accountname?: string }

      const bundle: TokenBundle = {
        auth_type: 'oauth2',
        access_token: tok.access_token,
        server_prefix: md.dc,
        account_id: md.accountname,
      }
      return bundle
    },
    refresh: async () => {
      // Mailchimp doesn't issue refresh tokens — access tokens are long-lived.
      throw new Error('Mailchimp does not support token refresh')
    },
  }
}
