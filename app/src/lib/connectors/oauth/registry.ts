import { mailchimpProvider } from './mailchimp'
import { hubspotProvider } from './hubspot'
import type { OAuthProviderConfig } from './types'

export function getOAuthProvider(id: string): OAuthProviderConfig | null {
  switch (id) {
    case 'mailchimp':
      return mailchimpProvider()
    case 'hubspot':
      return hubspotProvider()
    default:
      return null
  }
}

export function listConfiguredOAuthProviders(): OAuthProviderConfig[] {
  const out: OAuthProviderConfig[] = []
  const mc = mailchimpProvider()
  if (mc) out.push(mc)
  const hs = hubspotProvider()
  if (hs) out.push(hs)
  return out
}
