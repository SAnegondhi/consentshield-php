import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { ApiKeysPanel, type ApiKey } from './api-keys-panel'

export const dynamic = 'force-dynamic'

export default async function ApiKeysPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">API keys</h1>
        <p className="mt-2 text-sm text-gray-600">No organisation found. Complete signup first.</p>
      </main>
    )
  }

  const { data: org } = await supabase
    .from('organisations')
    .select('id, name, account_id')
    .eq('id', membership.org_id)
    .single()

  if (!org) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">Organisation not found.</p>
      </main>
    )
  }

  const [accountRoleRes, keysRes, accountRes] = await Promise.all([
    supabase.rpc('current_account_role'),
    supabase
      .from('api_keys')
      .select(
        'id, key_prefix, name, scopes, rate_tier, last_used_at, created_at, is_active, revoked_at, previous_key_expires_at',
      )
      .eq('account_id', org.account_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('accounts')
      .select('plan_code')
      .eq('id', org.account_id)
      .single(),
  ])

  const accountRole = (accountRoleRes.data as string | null) ?? null

  if (accountRole !== 'account_owner') {
    return (
      <main className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold">API keys</h1>
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-5 py-6">
          <div className="mb-1 text-sm font-medium text-gray-700">Access restricted</div>
          <p className="text-sm text-gray-500">
            Only account owners can manage API keys. Contact your account owner to request access.
          </p>
        </div>
      </main>
    )
  }

  const keys: ApiKey[] = (keysRes.data ?? []) as ApiKey[]
  const planCode = (accountRes.data?.plan_code as string | null) ?? 'starter'

  return (
    <main className="p-8 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">API keys</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage Bearer keys for the ConsentShield compliance API (<code className="font-mono text-xs">/api/v1/*</code>).
        </p>
      </header>

      <ApiKeysPanel
        keys={keys}
        accountId={org.account_id}
        orgId={org.id}
        rateTier={planCode}
      />
    </main>
  )
}
