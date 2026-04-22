# ADR-1018: Self-hosted status page on admin + public surfaces

**Status:** In Progress
**Date proposed:** 2026-04-22
**Date completed:** —
**Supersedes (in part):** ADR-1005 Phase 4 Sprint 4.1/4.2 (StatusPage.io provisioning)
**Related:** ADR-1017 (admin ops-readiness surface)

---

## Context

ADR-1005 Phase 4 scoped a hosted `status.consentshield.in` via StatusPage.io (fallback: Cachet self-hosted on Vercel). BFSI procurement expects a real public status page. StatusPage.io is ~$29/mo for the entry-level plan and carries a third-party cookie + privacy-policy footprint; Cachet needs its own deployment.

Since we already own the admin app and the customer app, and we have the DB + cron infrastructure to probe subsystems, there is no meaningful reason to introduce a third hosting target or a SaaS vendor. Self-hosting keeps the data inside the compliance perimeter, aligns the brand styling with the rest of the product, and removes a monthly spend + vendor dependency.

The admin surface owns management (operators post incidents, adjust subsystems, see probe history). A thin public read-only view at `status.consentshield.in` renders the latest-known state of each subsystem + the last 90 days of resolved incidents. Automated probes run on pg_cron; operator-posted incidents overlay the automated state.

## Decision

1. **Schema in `public`** (not `admin`) so the read path is unauthenticated — `status_subsystems`, `status_checks`, `status_incidents`. RLS opens SELECT to `anon`; INSERT / UPDATE restricted to admin roles via SECURITY DEFINER RPCs.
2. **Admin panel** at `/admin/(operator)/status` — list + edit subsystems, view recent `status_checks`, post + resolve incidents.
3. **Public page** at `/status` on the customer app (later DNS cutover to `status.consentshield.in`) — static-like render of subsystem cards (current state + 90-day uptime) + open-incidents banner.
4. **Automated probes** via pg_cron → Edge Function `run-status-probes` hitting each subsystem's health endpoint every 5 minutes. Results UPSERTed into `status_checks`. Non-200 / timeout transitions a subsystem's state from `operational` → `degraded` or `down`.

Design-wise the public page is deliberately plain — static-feeling, accessible, no cookies, no analytics. Operators see everything through the admin panel.

## Consequences

- Zero new SaaS spend. Zero external vendor for the status surface.
- All status data stays inside ConsentShield's compliance perimeter — useful when the status page itself would need to reflect privacy-sensitive subsystem names.
- Trade-off: ConsentShield itself hosts its own uptime surface. If the customer-app deployment goes down, the public status page goes with it. Mitigation: probes run from a different region than the app; future enhancement moves `status.consentshield.in` to a dedicated ultra-minimal Vercel project with its own Supabase read replica.

---

## Implementation Plan

### Sprint 1.1 — Schema + seed + admin RPCs (~1.5h) — **complete 2026-04-22**

**Deliverables:**
- [x] Migration `20260804000013_status_page.sql`:
  - `public.status_subsystems` (id, slug, display_name, description, health_url, current_state, last_state_change_at, last_state_change_note, sort_order, is_public, created_at, updated_at).
  - `public.status_checks` (id, subsystem_id, checked_at, status, latency_ms, error_message, source_region).
  - `public.status_incidents` (id, title, description, severity, status, `affected_subsystems uuid[]`, started_at, identified_at, monitoring_at, resolved_at, postmortem_url, created_by, last_update_note, created_at, updated_at).
  - CHECKs: `current_state` in ('operational','degraded','down','maintenance'); incident `severity` in ('sev1','sev2','sev3'); incident `status` in ('investigating','identified','monitoring','resolved'); per-check status adds 'error'.
  - RLS: SELECT open to `anon` + `authenticated` (public page needs anon read); writes only via admin RPCs. `cs_orchestrator` has insert/update for probe-cron to land (Sprint 1.4).
  - Indexes: recent-check lookup (subsystem_id, checked_at desc); open-incidents (status, started_at desc) WHERE status <> 'resolved'; all-incidents (started_at desc).
- [x] Seeded 6 subsystems — banner_cdn, consent_capture_api, verification_api, deletion_orchestration, dashboard, notification_channels; all operational; health_url populated where known.
- [x] 4 admin RPCs all SECURITY DEFINER + audit-logged via `admin.admin_audit_log`: `set_status_subsystem_state`, `post_status_incident`, `update_status_incident`, `resolve_status_incident`. Gated by `admin.require_admin('support')`.

### Sprint 1.2 — Admin panel (~1.5h) — **complete 2026-04-22**

**Deliverables:**
- [x] `admin/src/app/(operator)/status/page.tsx` — server component; reads subsystems + last-50 incidents; passes `adminRole` for write-gating.
- [x] `admin/src/app/(operator)/status/actions.ts` — 4 server actions wrapping the 4 RPCs; `revalidatePath('/status')` on success.
- [x] `admin/src/components/status/status-panel.tsx` — subsystem cards with per-state chips + per-subsystem inline state-flip buttons; open-incidents section with **Post incident** modal (title / description / severity / affected subsystems); incident cards with progress + resolve + postmortem-URL input; recent-history collapsible for resolved incidents.
- [x] Sidebar entry "Status Page" → `/status`.

### Sprint 1.3 — Public read-only page (~1.5h) — **complete 2026-04-22**

**Deliverables:**
- [x] `app/src/app/(public)/status/page.tsx` — server component reading via anon supabase-js. Renders:
  - Overall banner with 4-tone mapping (green / amber / red / blue) + aria-live.
  - Subsystem list (state dot + state label + description).
  - Open-incidents section with severity + status badges + latest-update note.
  - Collapsible 90-day resolved-incidents history + postmortem links.
  - Minimal brand footer; no cookies, no analytics.
- [x] `export const revalidate = 60` — 60s edge cache.
- [x] Public-route behaviour: `/status` is not in `proxy.ts` matcher, so the proxy auth gate doesn't fire. Ships without further proxy changes.
- [ ] `/status` layout override stripping dashboard chrome — currently inherits `(public)/layout.tsx`. Acceptable for v1; can split further if design wants a dedicated chrome.

### Sprint 1.4 — Probe cron + Edge Function (~2h) — **complete 2026-04-22**

**Deliverables:**
- [x] `supabase/functions/run-status-probes/index.ts` — iterates subsystems with non-null `health_url`, fetches with 8s timeout, records one `status_checks` row per subsystem, reconciles `current_state` (eager recovery on a single operational probe; failure requires 3 consecutive non-operational checks before auto-flipping; respects manual `maintenance` without stomp).
- [x] `supabase/functions/health/index.ts` — unauthenticated liveness for the Edge-Functions surface. Named `health` (not `_health`) — Supabase rejects Function names that start with `_`.
- [x] `app/src/app/api/health/route.ts` — unauthenticated liveness for the customer app (outside `proxy.ts` matcher, so the Bearer gate does not fire). `GET` returns JSON envelope; `HEAD` returns 200 no-body.
- [x] `supabase/config.toml` — `verify_jwt = false` for both new Functions (cron carries Vault-stored HS256 Bearer; Supabase HS256 rotation 401s at the Functions gateway).
- [x] Migration `20260804000015_status_probes_cron.sql`:
  - Updates seeded `health_url`s for `verification_api` and `dashboard` to `https://app.consentshield.in/api/health` (single unauthenticated endpoint; no probe-key provisioning needed). `deletion_orchestration` now points at the new `functions/v1/health`. `notification_channels` stays null until Sprint 6.1 ships the adapters.
  - Schedules `status-probes-5min` on `*/5 * * * *` calling `run-status-probes`.
  - Schedules `status-probes-heartbeat-check` on `*/15 * * * *` — pure SQL; inserts `admin.ops_readiness_flags` row (`ADR-1018`, `infra`, `high`) if no `status_checks` row has been written in the last 30 minutes. Idempotent: only inserts when no matching `pending`/`in_progress` flag already exists.
- [x] Live smoke-test: `curl POST /functions/v1/run-status-probes` returned `{probed: 5, skipped: 1, flipped: 0}` against the seeded 6-subsystem set. `health` endpoint returns 200 JSON.

### Sprint 1.4b — Audit-log column fix (follow-up) — **complete 2026-04-22**

**Bundled with ADR-1017 Sprint 1.3.** The four status-page admin RPCs landed in `20260804000013` inserted into `admin.admin_audit_log` using non-existent columns (`target_kind`, `payload`) and omitted the required `reason`. Migration `20260804000019_audit_log_column_fix.sql` rewrites the four RPCs with the canonical column set.

**Deliverables:**
- [x] `admin.set_status_subsystem_state`, `admin.post_status_incident`, `admin.update_status_incident`, `admin.resolve_status_incident` — rewritten `create or replace function` to use `target_table`/`target_id`/`target_pk`/`old_value`/`new_value`/`reason`. Function signatures unchanged.
- [x] `tests/admin/status-page-rpcs.test.ts` — 11 assertions covering state transitions, incident lifecycle, public-anon SELECT, invalid-input rejection, unknown-slug/id errors.

### Sprint 1.5 — DNS cutover (~15min, operator step)

**Deliverables:**
- [ ] Add CNAME `status.consentshield.in` → `cname.vercel-dns.com`.
- [ ] Add `status.consentshield.in` as an alias on the `app` Vercel project → routes to `/status` via `vercel.json` rewrite or Next.js host-based routing.
- [ ] Verify TLS issuance (Vercel automatic).
- [ ] Link in marketing footer + admin UI.

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md` — new subsection under Surface 5 (Operator Console) describing the status-page schema + admin vs public split.
- `docs/architecture/consentshield-complete-schema-design.md` — add the three `status_*` tables with column descriptions.

---

## Test Results

### Sprint 1.4 — 2026-04-22

**Live smoke-test against dev Supabase.** Both Edge Functions deployed to `xlqiakmkdjycfiioslgs`; migration `20260804000015` applied.

- `GET https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/health` — `200 OK` — `{"ok":true,"surface":"edge_functions","at":"..."}`
- `POST https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/run-status-probes` — `200 OK` — `{"ok":true,"probed":5,"skipped":1,"flipped":0}` — 5 subsystems with non-null `health_url` probed; `notification_channels` skipped (null). All checks operational → no state flips. One row per subsystem written to `public.status_checks`.

Consecutive-failure flip path, maintenance-override safety, and heartbeat-check cron are exercised in production once probes accumulate; not in the v1 smoke test.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.1 schema + seed + admin RPCs
- `CHANGELOG-dashboard.md` — Sprint 1.2 admin panel + Sprint 1.3 public page
- `CHANGELOG-edge-functions.md` — Sprint 1.4 run-status-probes
- `CHANGELOG-infra.md` — Sprint 1.5 DNS + Vercel alias
- `CHANGELOG-docs.md` — ADR + runbook
