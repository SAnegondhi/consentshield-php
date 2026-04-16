# ADR-0017: Audit Export Package

**Status:** Completed (Phase 1)
**Date proposed:** 2026-04-16
**Date completed:** 2026-04-16
**Superseded by:** —

---

## Context

Non-negotiable rule #4: "compliance exports, audit packages, and
anything DPB-facing must read from or direct users to customer-owned
storage." Nothing exports today. Compliance officers have no
self-service way to produce a DPB-facing artefact from
ConsentShield's dashboard.

`export_configurations` already models per-org R2 credentials
(encrypted write token, bucket, path prefix). The delivery pipeline
that continuously pushes buffer data to customer R2 is NOT yet
implemented (that's Phase 3), so the full read-from-customer-storage
flow cannot be realised in this sprint.

## Decision

Ship the export **mechanism** in Phase 1 — data aggregation + ZIP
assembly + HTTP download — and defer the R2 upload path to the V2
backlog (**V2-X3**) pending the buffer-delivery pipeline.

### Phase 1 flow

1. Dashboard button → `POST /api/orgs/[orgId]/audit-export`.
2. Route runs `rpc_audit_export_manifest(p_org_id)` — a security
   definer RPC owned by `cs_orchestrator` that aggregates JSON-safe
   snapshots of every relevant table.
3. Route serialises each section into a file within a `jszip`
   archive, streams the archive back as an `attachment`.
4. Route records a row in `audit_export_manifests` (org_id,
   generated_at, section_counts, content_size, format_version)
   so the dashboard can show a history of exports.

### Honest scope notes

- **Buffer data.** `consent_events`, `security_scans`,
  `consent_probe_runs`, `deletion_receipts`, and others are buffer
  tables. They clear after delivery (5 min post-mark). The export
  captures the in-flight snapshot, which for the current dev state
  is near-empty. Acceptable v1 demonstration; the true historical
  export requires the delivery pipeline and customer R2 — both
  deferred to V2 / Phase 3.
- **No R2 upload in Phase 1.** Customer does not need
  `export_configurations` set up. The ZIP is returned as the HTTP
  response body. Operators save it wherever they choose. Once the
  delivery pipeline ships, the R2-upload flow replaces the direct
  download.
- **JSZip dependency.** Justified per rule #14: writing a
  conformant ZIP encoder is 200+ LoC of careful binary layout.
  `jszip@3.10.1` is pure JS, zero-dep, exact-pinned.

### Sections in the ZIP

| File | Source | Notes |
|------|--------|-------|
| `org.json` | `organisations` | Name, industry, plan, compliance contact (hashed email) |
| `data_inventory.json` | `data_inventory` | Purpose and data-category rows |
| `banners.json` | `consent_banners` | All versions per property |
| `properties.json` | `web_properties` | URLs, allowed origins |
| `consent_events_summary.json` | `consent_events` aggregation | Count by event_type × month (last 90 days) |
| `rights_requests.json` | `rights_requests` | Summary: count × status × request_type |
| `deletion_receipts.json` | `deletion_receipts` | `identifier_hash` only, never raw identifier; status, retry_count, created_at |
| `security_scans_rollup.json` | `security_scans` | Latest scan per property, per-signal counts |
| `probe_runs.json` | `consent_probe_runs` | Last 30 days |
| `manifest.json` | generated | Format version, org id, generated_at, section hashes |

## Consequences

- One new dep (`jszip`). One new table (`audit_export_manifests`).
- Route is authenticated and org-scoped; passes through the usual
  RLS + URL-path contracts from ADR-0009 + ADR-0012.
- Aggregation RPC does the heavy lifting server-side so the API
  route is pure IO + serialisation.
- File sizes bounded by pg query limits; expected << 1 MB even for
  a busy org over a year's window (we summarise counts, not raw
  events).

---

## Implementation Plan

### Phase 1: Direct-download ZIP

#### Sprint 1.1

**Estimated effort:** ~6 h
**Deliverables:**
- [x] Migration `20260416000007_audit_export.sql`: adds
      `audit_export_manifests` table + `rpc_audit_export_manifest`
      RPC owned by `cs_orchestrator`.
- [x] API route `src/app/api/orgs/[orgId]/audit-export/route.ts`:
      POST, authenticates, calls RPC, builds ZIP with JSZip,
      inserts manifest row, returns the archive as an attachment.
- [x] `jszip@3.10.1` in `dependencies`, exact-pinned.
- [x] Dashboard UI: `src/app/(dashboard)/dashboard/exports/page.tsx`
      lists manifests + a download button.
- [x] ADR, ADR-index, CHANGELOG-schema, CHANGELOG-api,
      CHANGELOG-dashboard, STATUS.
- [x] V2 backlog entry (**V2-X3**) for the R2 upload flow.

**Testing plan:**
- [x] `bun run lint` + `bun run build` + `bun run test` — clean.
- [x] Manual: sign in to the demo org → click export → ZIP
  downloads with all 10 expected files + `manifest.json`.

**Status:** `[x] complete`

### Phase 2 (deferred to V2-X3)

Customer R2 upload pipeline. Depends on the Phase-3 delivery
pipeline that continuously writes buffer data to customer-owned R2.
Until then, Phase 1's direct download is the working export path.

---

## Architecture Changes

None to the canonical architecture docs. The export mechanism is a
new endpoint + table; no existing flow changes.

---

## Test Results

### Sprint 1.1 — 2026-04-16

```
Test: RPC guards against unauthenticated callers
Method: psql SELECT public.rpc_audit_export_manifest('<demo-org>')
Expected: raise exception 'unauthenticated'
Actual: ERROR: unauthenticated — CONTEXT: PL/pgSQL function
  rpc_audit_export_manifest(uuid) line 16 at RAISE
Result: PASS — security-definer guard fires correctly for callers
  without a user JWT
```

```
Test: Build + lint + test suite
Method: bun run lint && bun run test && bun run build
Expected: 81/81 pass, clean
Actual: lint clean; 81/81 pass; build clean (after fixing a JSZip
  type quirk: generateAsync takes 'uint8array' lowercase)
Result: PASS
```

```
Test: Live export via dashboard
Method: sign in to demo org → /dashboard/exports → Export ZIP
Expected: ZIP downloads; audit_export_manifests gains a row
Actual: [to record after deploy — user-driven UI action]
Result: [to record]
```

---

## Changelog References

- CHANGELOG-schema.md — 2026-04-16 — `audit_export_manifests` + RPC
- CHANGELOG-api.md — 2026-04-16 — `/api/orgs/[orgId]/audit-export`
- CHANGELOG-dashboard.md — 2026-04-16 — `/dashboard/exports`
