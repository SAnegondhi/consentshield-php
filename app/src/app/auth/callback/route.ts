import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ensureOrgBootstrap } from '@/lib/auth/bootstrap-org'

// Single post-signup / post-email-confirmation landing path.
// - With ?code=... (email confirmation link): exchange for session.
// - Bootstrap the org if the user has none yet and carries org_name in
//   user_metadata (set by the signup form, see ADR-0013).
// - Always redirect to /dashboard on success; /login?error=... on failure.
//
// Idempotency guard + bootstrap RPC are extracted into ensureOrgBootstrap
// (ADR-0042) for unit testability.

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  const supabase = await createServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_session`)
  }

  const result = await ensureOrgBootstrap(supabase, user)
  if (result.action === 'failed') {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('bootstrap_failed: ' + result.error)}`,
    )
  }

  return NextResponse.redirect(`${origin}/dashboard`)
}
