// Shared types for the ADR-0058 onboarding wizard.

export interface InvitePreview {
  invited_email: string
  role: string
  account_id: string | null
  org_id: string | null
  plan_code: string | null
  default_org_name: string | null
  expires_at: string
  accepted_at: string | null
}

export interface ResumeContext {
  orgId: string
  orgName: string
  industry: string | null
  step: number
}

export type Industry =
  | 'saas'
  | 'edtech'
  | 'healthcare'
  | 'ecommerce'
  | 'hrtech'
  | 'fintech'
  | 'bfsi'
  | 'general'

export const INDUSTRIES: ReadonlyArray<{ code: Industry; label: string }> = [
  { code: 'saas', label: 'SaaS / developer tools' },
  { code: 'fintech', label: 'Fintech' },
  { code: 'bfsi', label: 'Banking, financial services, insurance' },
  { code: 'ecommerce', label: 'E-commerce / retail' },
  { code: 'edtech', label: 'EdTech / education' },
  { code: 'healthcare', label: 'Healthcare / healthtech' },
  { code: 'hrtech', label: 'HR / people ops' },
  { code: 'general', label: 'Something else' },
]

// Maps an internal 0..7 step to 1-indexed display position for the
// progress bar. Sprint 1.3 ships steps 1-4; 5-7 are rendered as
// placeholder dots and will light up in Sprints 1.4 / 1.5.
export const WIZARD_LABELS: readonly string[] = [
  'Welcome',
  'Company',
  'Data',
  'Purposes',
  'Deploy',
  'Scores',
  'First consent',
]
