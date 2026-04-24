// ADR-1019 Sprint 1.2 — S3-compatible endpoint derivation, shared helper.
//
// Originally lived inline in nightly-verify.ts; extracted here so the
// delivery orchestrator (Sprint 2.1 / Sprint 2.2) can reuse the same logic
// without copy-paste. Callers pass the minimum set of fields from an
// `export_configurations` row plus an optional `deps` slot for injecting
// `process.env` in tests.
//
// Provider → endpoint rules:
//
//   * `cs_managed_r2` — the bucket is in ConsentShield's CF account. Endpoint
//     is account-scoped: `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`.
//     Throws if `CLOUDFLARE_ACCOUNT_ID` is unset.
//
//   * `customer_s3` — AWS S3 in the customer's account. Endpoint is the
//     region-scoped S3 URL `https://s3.<region>.amazonaws.com`. Defaults to
//     `us-east-1` when no region is set.
//
//   * `customer_r2` — BYOK Cloudflare R2 in the customer's account. Not yet
//     supported: BYOK R2 endpoints are account-scoped and the customer's
//     account id isn't persisted on `export_configurations` today. Throws.
//     When the first BYOK-R2 customer arrives, persist the account id on the
//     row (additive column) and handle it here.

export type StorageProvider =
  | 'cs_managed_r2'
  | 'customer_r2'
  | 'customer_s3'
  | (string & {})

export interface EndpointDeps {
  env?: NodeJS.ProcessEnv
}

export function endpointForProvider(
  provider: StorageProvider,
  region: string | null | undefined,
  deps: EndpointDeps = {},
): string {
  const env = deps.env ?? process.env

  if (provider === 'cs_managed_r2') {
    const acct = env.CLOUDFLARE_ACCOUNT_ID
    if (!acct) {
      throw new Error(
        'CLOUDFLARE_ACCOUNT_ID is not set — required to derive the ' +
          'cs_managed_r2 endpoint. Add it to the customer-app env.',
      )
    }
    return `https://${acct}.r2.cloudflarestorage.com`
  }

  if (provider === 'customer_s3') {
    const r = region && region.trim().length > 0 ? region : 'us-east-1'
    return `https://s3.${r}.amazonaws.com`
  }

  throw new Error(
    `cannot derive endpoint for provider='${provider}' ` +
      '(BYOK customer_r2 requires a persisted account id; not yet supported)',
  )
}
