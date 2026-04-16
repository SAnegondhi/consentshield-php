// Billing plans config — single source of truth

export type PlanId = 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise'

export interface Plan {
  id: PlanId
  name: string
  price_inr: number // monthly, in rupees
  razorpay_plan_id?: string // set when plan is created in Razorpay dashboard
  limits: {
    web_properties: number | null // null = unlimited
    deletion_connectors: number | null
    api_rate_limit_per_hour: number | null
  }
  features: {
    consent_banner: boolean
    privacy_notice: boolean
    data_inventory: boolean
    breach_workflow: boolean
    rights_requests: boolean
    withdrawal_verification: boolean
    security_scanning: boolean
    retention_rules: boolean
    gdpr_module: boolean
    consent_probes: boolean
    sector_templates: boolean
    compliance_api: boolean
    multi_team_roles: boolean
    dpo_matching: boolean
    white_label: boolean
    cross_border_module: boolean
    abdm_bundle: boolean
  }
}

const base_features = {
  consent_banner: true,
  privacy_notice: true,
  data_inventory: true,
  breach_workflow: true,
  rights_requests: false,
  withdrawal_verification: false,
  security_scanning: false,
  retention_rules: false,
  gdpr_module: false,
  consent_probes: false,
  sector_templates: false,
  compliance_api: false,
  multi_team_roles: false,
  dpo_matching: false,
  white_label: false,
  cross_border_module: false,
  abdm_bundle: false,
}

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: 'trial',
    name: 'Trial',
    price_inr: 0,
    limits: { web_properties: 1, deletion_connectors: 0, api_rate_limit_per_hour: 0 },
    features: { ...base_features },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price_inr: 2999,
    razorpay_plan_id: process.env.RAZORPAY_PLAN_STARTER,
    limits: { web_properties: 1, deletion_connectors: 0, api_rate_limit_per_hour: 0 },
    features: { ...base_features },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    price_inr: 5999,
    razorpay_plan_id: process.env.RAZORPAY_PLAN_GROWTH,
    limits: { web_properties: 3, deletion_connectors: 3, api_rate_limit_per_hour: 1000 },
    features: {
      ...base_features,
      rights_requests: true,
      withdrawal_verification: true,
      security_scanning: true,
      retention_rules: true,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_inr: 9999,
    razorpay_plan_id: process.env.RAZORPAY_PLAN_PRO,
    limits: { web_properties: 10, deletion_connectors: 13, api_rate_limit_per_hour: 10000 },
    features: {
      ...base_features,
      rights_requests: true,
      withdrawal_verification: true,
      security_scanning: true,
      retention_rules: true,
      gdpr_module: true,
      consent_probes: true,
      sector_templates: true,
      compliance_api: true,
      multi_team_roles: true,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price_inr: 24999,
    razorpay_plan_id: process.env.RAZORPAY_PLAN_ENTERPRISE,
    limits: {
      web_properties: null,
      deletion_connectors: null,
      api_rate_limit_per_hour: null,
    },
    features: {
      ...base_features,
      rights_requests: true,
      withdrawal_verification: true,
      security_scanning: true,
      retention_rules: true,
      gdpr_module: true,
      consent_probes: true,
      sector_templates: true,
      compliance_api: true,
      multi_team_roles: true,
      dpo_matching: true,
      white_label: true,
      cross_border_module: true,
      abdm_bundle: true,
    },
  },
}

export const PLAN_ORDER: PlanId[] = ['trial', 'starter', 'growth', 'pro', 'enterprise']

export function getPlan(planId: string): Plan {
  return PLANS[(planId as PlanId) ?? 'trial'] ?? PLANS.trial
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}
