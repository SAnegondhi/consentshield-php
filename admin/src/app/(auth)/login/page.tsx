// Admin login — stub for ADR-0026 Sprint 3.1. Real Supabase Auth sign-in
// + WebAuthn hardware-key enrolment ships in ADR-0028.
//
// When running with ADMIN_HARDWARE_KEY_ENFORCED=false (local dev only),
// any admin user with is_admin=true in auth.users.raw_app_meta_data can
// sign in with email/password via the customer app, and the admin
// proxy.ts will accept the session without AAL2.

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <header className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-wider text-red-700">
            ConsentShield — Operator Console
          </p>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-zinc-600">
            Authentication with hardware-key second factor is required in
            production. This skeleton ships auth wiring in a later ADR.
          </p>
        </header>

        <ReasonNotice searchParams={searchParams} />

        <div className="space-y-3 text-sm">
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <strong>Stub:</strong> real Supabase Auth login + WebAuthn flow
            lands in ADR-0028. For local dev, set{' '}
            <code className="font-mono">ADMIN_HARDWARE_KEY_ENFORCED=false</code>{' '}
            and seed <code className="font-mono">is_admin=true</code> on your
            user via the Supabase SQL editor:
          </p>
          <pre className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
            {`UPDATE auth.users
   SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
 WHERE email = 'a.d.sudhindra@gmail.com';`}
          </pre>
          <p className="text-zinc-600">
            Then sign in via the customer app at{' '}
            <code className="font-mono">app.consentshield.in</code> and
            return here.
          </p>
        </div>
      </div>
    </main>
  )
}

async function ReasonNotice({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  if (!reason) return null
  const messages: Record<string, string> = {
    mfa_required:
      'Hardware-key second factor required. Enrol a passkey via the customer app, then return.',
  }
  const msg = messages[reason] ?? reason
  return (
    <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      {msg}
    </p>
  )
}
