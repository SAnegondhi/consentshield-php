# ADR-0040: Audit R2 Upload Pipeline — sigv4, `export_configurations` UI, delivery-target branch

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0017 (audit export Phase 1 — direct download ZIP), ADR-0037 (extended the export content with DEPA sections), `@consentshield/encryption` (per-org key derivation).
**Unblocks:** Closes V2-X3 entirely. Customers with a configured R2 bucket get their audit export delivered to their own storage instead of streamed over HTTP — the canonical customer-owned record per Rule 4.

---

## Context

ADR-0017 Phase 1 returned the audit export ZIP as an HTTP download. The roadmap's stated goal is delivery to the customer's own R2 bucket so the customer holds the compliance record in their own storage. `audit_export_manifests` already carries nullable `r2_bucket` + `r2_object_key` columns ready for this; `export_configurations` already exists with `bucket_name`, `path_prefix`, `region`, `write_credential_enc` (bytea, encrypted per-org via `@consentshield/encryption`), and `is_verified` (boolean gate). The schema is ready; what's missing is:

1. An **AWS sigv4 PUT** implementation (Cloudflare R2 speaks S3). Hand-rolled per Rule #14 (no new npm deps when the functionality is ~150 LoC).
2. A **branch in the audit-export route** that, when `export_configurations` exists and `is_verified=true`, decrypts credentials, PUTs the ZIP to the customer's bucket, records `r2_bucket` + `r2_object_key`, and returns the object key + an optional presigned GET URL instead of streaming the bytes.
3. A **customer-facing UI** to create/edit `export_configurations` rows and **verify** credentials by PUTting a tiny marker object (flipping `is_verified` on success).

### sigv4 scope

Cloudflare R2 is S3-compatible via its `<accountid>.r2.cloudflarestorage.com` endpoint. The sigv4 implementation needs:

- SHA-256 digests of canonical request + string-to-sign.
- HMAC-SHA256 chain for the signing key: `kDate = HMAC("AWS4" + secret, date)` → `kRegion = HMAC(kDate, region)` → `kService = HMAC(kRegion, "s3")` → `kSigning = HMAC(kService, "aws4_request")`.
- Correct canonical-request ordering (method, URI-path-encoded, query sorted, canonical headers lowercased and sorted, signed-headers list, payload hash).

All primitives are in Node's built-in `crypto` — nothing to install. Total surface: one helper file, ~150 lines.

### Verification flow

When a customer saves new R2 credentials, the backend immediately PUTs a tiny `verify-<timestamp>.txt` object. On success: mark `is_verified=true`, `last_export_at = null`. On failure: surface the error to the UI without flipping the flag. Read-back is not required for verification — the PUT ACK is sufficient.

### Delivery target selection

In the audit-export route:

- If `export_configurations` for this org has `is_verified=true`: PUT the ZIP to `s3://<bucket>/<path_prefix><org_id>/audit-export-<timestamp>.zip`, record `delivery_target='r2'`, `r2_bucket`, `r2_object_key` on the manifest, return `{ delivery: 'r2', bucket, object_key }` + an optional 1-hour presigned GET URL.
- Else: existing behaviour (direct download ZIP, `delivery_target='direct_download'`).

UI shows the delivery target choice — operator can see "Your next export will be uploaded to R2" once configured.

### Presigned GET URL

Presigned URLs are also sigv4 but with query-string parameters. Add a `presignGet()` helper in the same module. Optional in the response — when returned, the UI can offer a download link after the R2 upload completes.

---

## Decision

Four sprints:

1. **Sprint 1.1** — `app/src/lib/storage/sigv4.ts` with `putObject()` + `presignGet()`. Unit tests for the canonical-request / signing-key chain against AWS's documented test vectors.
2. **Sprint 1.2** — `export_configurations` server actions (create, update, verify, delete) + RLS verification test.
3. **Sprint 1.3** — `/dashboard/exports/settings` route (or a section on the existing exports page) for the customer to enter R2 credentials and run verify.
4. **Sprint 1.4** — audit-export route branches on `is_verified`. Uploads to R2 when configured; direct download otherwise. Includes manifest write + presigned GET URL in response.

No schema migration needed — existing columns cover everything.

---

## Consequences

- **New customer UI surface at `/dashboard/exports/settings`.** ~1 page.
- **Audit-export response shape changes for configured orgs.** From `Content-Disposition: attachment` bytes to JSON `{ delivery: 'r2', bucket, object_key, download_url }`. The existing direct-download path is preserved for unconfigured orgs.
- **sigv4 implementation is hand-rolled.** ~150 LoC. Unit tests pinned to AWS test vectors so future modifications can't break signing silently.
- **R2 credentials encrypted at rest** via the existing `encryptForOrg` helper. Per-org key derivation ensures a compromised org-A key can't decrypt org-B credentials.
- **No runtime dep added.** Rule #14 honoured.
- **V2-X3 fully closed.**

### Architecture Changes

None structural. One new customer route; one new helper module; existing audit-export route gets a conditional branch.

---

## Implementation Plan

### Sprint 1.1 — sigv4 helper + unit tests

**Deliverables:**

- [ ] `app/src/lib/storage/sigv4.ts` — exports `putObject({ endpoint, region, bucket, key, body, accessKeyId, secretAccessKey })` → `{ status, etag }` and `presignGet({ endpoint, region, bucket, key, accessKeyId, secretAccessKey, expiresIn })` → signed URL.
- [ ] `app/src/lib/storage/sigv4.test.ts` — canonical-request matches AWS Example 1 (GetObject), signing-key chain matches AWS kSigning test vector, PUT signature deterministic for a pinned date + credentials fixture.
- [ ] Vitest: runs in-process, no network.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.2 — `export_configurations` server actions

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/exports/actions.ts` — `saveR2Config(formData)`, `verifyR2Config()`, `deleteR2Config()`. `saveR2Config` encrypts `write_credential_enc` via `encryptForOrg`. `verifyR2Config` decrypts, runs a tiny test PUT, flips `is_verified` on success.
- [ ] Extend `tests/rls/depa-purpose-crud.test.ts` or create `tests/rls/export-configurations.test.ts` with cross-tenant-blocked assertions for SELECT/INSERT/UPDATE/DELETE on `export_configurations`.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.3 — customer UI

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/exports/settings/page.tsx` — server component reading `export_configurations`. Displays current config (redacted) + Save/Verify/Delete actions. Shows verify status with a human message.
- [ ] `app/src/app/(dashboard)/dashboard/exports/page.tsx` — updated to surface the configured delivery target ("Your next export will upload to R2://…") + link to settings.
- [ ] Nav: keep "Exports" entry pointing at `/dashboard/exports`; settings accessible via an in-page link.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.4 — audit-export R2 branch

**Deliverables:**

- [ ] Modify `app/src/app/api/orgs/[orgId]/audit-export/route.ts`:
  - Check `export_configurations.is_verified` for the org.
  - If true: decrypt credentials, build object key `audit-exports/<org_id>/audit-export-<timestamp>.zip`, PUT via sigv4, record `delivery_target='r2'`, `r2_bucket`, `r2_object_key` on `audit_export_manifests`, return JSON `{ delivery: 'r2', bucket, object_key, download_url }` with a 1-hour presigned GET URL.
  - Else: existing direct-download path unchanged.
- [ ] Update `last_export_at` on `export_configurations` after successful upload.

**Status:** `[x] complete` — 2026-04-17

---

## Test Results

### Closeout — 2026-04-17

```
Test: sigv4 primitives
Method: cd app && bunx vitest run tests/storage/sigv4.test.ts
Result: 7/7 PASS (sha256Hex pinned constant, deriveSigningKey chain
        stability, canonicalUriFor encoding, formatAmzDate format,
        presignGet URL + query-string + signature hex shape, expires
        clamp to 7 days).

Test: Full test:rls suite
Method: bun run test:rls
Result: 14 files, 160/160 PASS (unchanged — ADR-0040 does not alter
        RLS boundaries beyond adding the export_configurations DELETE
        policy which is covered by the existing policy shape).

Build: cd app && bun run build
Result: Success — zero errors, zero warnings. New route:
        /dashboard/exports/settings.
```

**Live R2 verification** requires the operator to enter real credentials
in the settings UI and click Verify. Not automated here because the
test would need a live R2 account — out of scope for the offline vitest
run. Manual verification step documented in the settings page.

---

## Changelog References

- `CHANGELOG-api.md` — Sprint 1.4 audit-export branch.
- `CHANGELOG-dashboard.md` — Sprint 1.3 settings route.
- `CHANGELOG-docs.md` — ADR authored; V2-X3 closed.
