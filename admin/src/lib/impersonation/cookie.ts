import { cookies } from 'next/headers'

// ADR-0029 Sprint 3.1 — impersonation cookie lifecycle.
//
// Session payload we stash in the httpOnly cookie. The source of truth
// is admin.impersonation_sessions; the cookie just tells the admin
// shell which session the current operator has open.

export const IMPERSONATION_COOKIE = 'cs_admin_impersonation'

export interface ImpersonationCookie {
  session_id: string
  target_org_id: string
  target_org_name: string
  reason: string
  expires_at: string // ISO
  started_at: string // ISO
}

export async function readImpersonationCookie(): Promise<ImpersonationCookie | null> {
  const jar = await cookies()
  const raw = jar.get(IMPERSONATION_COOKIE)?.value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ImpersonationCookie
    if (!parsed.session_id || !parsed.expires_at) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeImpersonationCookie(payload: ImpersonationCookie) {
  const jar = await cookies()
  const expiresAt = new Date(payload.expires_at)
  jar.set(IMPERSONATION_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  })
}

export async function clearImpersonationCookie() {
  const jar = await cookies()
  jar.delete(IMPERSONATION_COOKIE)
}

export function isExpired(cookie: ImpersonationCookie, nowMs = Date.now()): boolean {
  return new Date(cookie.expires_at).getTime() <= nowMs
}
