import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0028 Sprint 1.1 — admin sign-out.
//
// POST-only (no GET) so a GET navigation cannot accidentally log out a
// user. Returns to /login after clearing the Supabase cookies.

export async function POST(request: Request) {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
