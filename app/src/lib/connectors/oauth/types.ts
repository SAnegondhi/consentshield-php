// ADR-0039 — shared OAuth provider types.

export interface OAuthProviderConfig {
  id: string
  display_name: string
  client_id: string
  client_secret: string
  authorize_url: (state: string, redirectUri: string) => string
  exchange_code: (params: {
    code: string
    redirectUri: string
  }) => Promise<TokenBundle>
  refresh: (refreshToken: string) => Promise<TokenBundle>
}

export interface TokenBundle {
  auth_type: 'oauth2'
  access_token: string
  refresh_token?: string
  expires_at?: string // ISO; absent if token never expires (Mailchimp)
  // Provider-specific metadata bundled here, not at the outer level, so
  // integration_connectors.config stays a single opaque blob per connector.
  server_prefix?: string // Mailchimp
  portal_id?: number // HubSpot
  account_id?: string // Mailchimp
}
