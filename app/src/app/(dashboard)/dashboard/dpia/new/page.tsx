import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { NewDpiaForm } from './form'

export const dynamic = 'force-dynamic'

export default async function NewDpiaPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const { data: org } = await supabase
    .from('organisations')
    .select('id, name')
    .eq('id', membership.org_id)
    .single()

  return (
    <main className="p-8 max-w-3xl">
      <div className="mb-6">
        <Link href="/dashboard/dpia" className="text-xs text-gray-500 hover:underline">
          ← Back to DPIA records
        </Link>
        <h1 className="mt-1 text-2xl font-bold">New DPIA</h1>
        <p className="mt-1 text-sm text-gray-500">Creating under <strong>{org?.name}</strong></p>
      </div>
      <NewDpiaForm orgId={membership.org_id} />
    </main>
  )
}
