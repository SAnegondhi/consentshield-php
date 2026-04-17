import { readImpersonationCookie } from '@/lib/impersonation/cookie'
import { BannerClient } from './active-session-banner-client'

// ADR-0029 Sprint 3.1 — always-visible banner while an impersonation
// session is active. Rendered by the operator layout above the red
// admin-mode strip so it's impossible to miss.
//
// The Server Component reads the cookie (httpOnly — only the server can)
// and hands the serialised payload off to a Client Component which owns
// the "minutes remaining" live countdown. Splitting the two avoids the
// `react-hooks/purity` lint error on Date.now() in server code.

export async function ActiveSessionBanner() {
  const cookie = await readImpersonationCookie()
  if (!cookie) return null
  return (
    <BannerClient
      sessionId={cookie.session_id}
      targetOrgId={cookie.target_org_id}
      targetOrgName={cookie.target_org_name}
      reason={cookie.reason}
      expiresAt={cookie.expires_at}
    />
  )
}
