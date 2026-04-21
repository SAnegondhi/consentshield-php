import { createServerClient } from '@/lib/supabase/server'
import { NewIntakeForm } from './form'

// ADR-0058 Sprint 1.5 — operator-initiated intake.
//
// Pairs with `admin.create_operator_intake(email, plan_code, org_name)`
// (Sprint 1.1 M3). Same row shape as marketing-self-serve intake; same
// dispatch pipeline. Lands the invitee at the customer-app onboarding
// wizard with `origin='operator_intake'` email copy.

export const dynamic = 'force-dynamic'

interface PlanRow {
  plan_code: string
  display_name: string
  base_price_inr: number | null
  trial_days: number
}

export default async function NewIntakePage() {
  const supabase = await createServerClient()

  const { data: plans, error } = await supabase
    .from('plans')
    .select('plan_code, display_name, base_price_inr, trial_days')
    .eq('is_active', true)
    .order('base_price_inr', { ascending: true, nullsFirst: true })

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Invite a new account</h1>
        <p className="text-sm text-text-2">
          Provisions a brand-new customer account on the selected plan and
          emails the invitee a secure link to the onboarding wizard. The
          invite expires in 14 days.
        </p>
      </header>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error.message}
        </div>
      ) : null}

      <NewIntakeForm plans={(plans ?? []) as PlanRow[]} />

      <aside className="rounded border border-[color:var(--border)] bg-bg px-3 py-2 text-[11px] text-text-3">
        <p>
          Use this flow for contracted / sales-qualified customers only.
          Self-serve visitors create their own intakes on
          <code className="mx-1">consentshield.in/signup</code>.
        </p>
      </aside>
    </div>
  )
}
