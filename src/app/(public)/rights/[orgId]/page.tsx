import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { RightsRequestForm } from './form'

export default async function RightsRequestPage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = await params

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: org } = await admin
    .from('organisations')
    .select('id, name')
    .eq('id', orgId)
    .single()

  if (!org) notFound()

  const turnstileSiteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <header className="mb-8 pb-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold">Data Rights Request</h1>
        <p className="mt-2 text-sm text-gray-600">
          Submit a rights request to <strong>{org.name}</strong> under the Digital Personal
          Data Protection Act 2023. You have the right to access, correct, erase, or nominate
          someone to act on your data.
        </p>
      </header>

      <RightsRequestForm orgId={org.id} orgName={org.name} turnstileSiteKey={turnstileSiteKey} />

      <p className="mt-8 text-xs text-gray-500">
        After submission, you will receive a 6-digit verification code by email.
        The code expires in 15 minutes. Once verified, your request enters the 30-day SLA.
      </p>
    </main>
  )
}
