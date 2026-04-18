// ADR-0050 Sprint 2.1 — admin tier helpers.
//
// Centralises the tier-dominance logic so UI canWrite / canSupport checks
// mirror the Postgres admin.require_admin hierarchy:
//   platform_owner > platform_operator > support > read_only
//
// Every caller previously had `adminRole === 'platform_operator'` inline,
// which silently locks platform_owner users out of UI actions even though
// their RPCs succeed. These helpers close that gap.

export type AdminRole =
  | 'platform_owner'
  | 'platform_operator'
  | 'support'
  | 'read_only'
  | undefined

export function canOperate(role: AdminRole): boolean {
  return role === 'platform_owner' || role === 'platform_operator'
}

export function canSupport(role: AdminRole): boolean {
  return (
    role === 'platform_owner' ||
    role === 'platform_operator' ||
    role === 'support'
  )
}
