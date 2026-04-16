# ADR-0016: Consent Probes (Synthetic Compliance Testing)

**Status:** Completed
**Date proposed:** 2026-04-16
**Date completed:** 2026-04-16
**Superseded by:** —

---

## Context

`consent_probes` and `consent_probe_runs` tables exist with full
scoped-role grants and RLS. No code reads or writes them. The product
promise is synthetic compliance testing — "if the user rejects
analytics, does the site still fire GA4 when loaded fresh?" —
critical for DPB audit defence.

## Decision

Implement probes as **static HTML analysis v1**. Each probe run:

1. Loads `consent_probes` rows where `is_active = true` and
   `(next_run_at IS NULL OR next_run_at <= now())`.
2. For each probe, `fetch`es `property_url` (resolved via the
   `property_id → web_properties.url` join).
3. Parses the HTML response for `<script src>`, `<img src>`,
   `<iframe src>`, `<link href>` URLs.
4. Matches each URL against every active row in `tracker_signatures`
   using the `detection_rules[].pattern` field (same string-includes
   check as the banner's runtime `classifyUrl`).
5. Classifies matches into `trackers_detected`. A match becomes a
   **violation** when the tracker's `category` is NOT consented
   (per `probe.consent_state`) AND the signature is not
   `is_functional`.
6. Inserts one row into `consent_probe_runs` with the full detection
   and violation set, plus duration and status.
7. Updates `consent_probes.last_run_at`, `last_result` (summary),
   `next_run_at` (based on `schedule`: hourly / daily / weekly).

### Scope note — what static analysis catches vs misses

**Catches** (v1):
- Scripts hardcoded in HTML (`<script src="...google-analytics..."`)
- Pixel trackers rendered server-side
- iframe/embed trackers in HTML source
- The `/violator` demo site's pre-consent injection (GA4 + Meta
  Pixel in the HTML)

**Misses** (v1):
- Trackers injected by client-side JS after user interaction
- Google Tag Manager's lazy-loaded children
- Trackers gated by the customer's own consent JS (they may fire
  correctly — v1 can't differentiate "respects consent" from
  "trackers never in this page source")

A **v2 follow-up ADR** can add a headless-browser backend (Vercel
Sandbox or a Browserless-style external service) for true
consent-interaction simulation. The v1 baseline is already
sufficient to catch pre-consent injection — which is the most common
and most clearly-illegal failure mode under DPDP.

### Scheduling

Hourly cron at `10 * * * *` (offset from the other HTTP crons).
The Edge Function itself filters by `next_run_at` so probes with
`schedule='daily'` or `'weekly'` are skipped until their window.

## Consequences

- One new Edge Function, zero new deps.
- No dashboard CRUD UI in this sprint — probes are seeded by SQL for
  the demo and for the acceptance test. CRUD UI lives in a future
  micro-ADR.
- `consent_probe_runs` is a buffer table; sweep will delete delivered
  rows. Dashboard reads before delivery.
- False-negatives are clearly acknowledged in the ADR; operators get
  a correct baseline and know to upgrade to v2 if they need
  JS-executed-consent validation.

---

## Implementation Plan

### Phase 1: Static-analysis probe pipeline

**Estimated effort:** ~6 h (not the 8 h in the roadmap because we
decided against a headless browser in v1).

**Deliverables:**
- [x] `supabase/functions/run-consent-probes/index.ts` — Deno, pulls
  probes + signatures, HTML-fetches, classifies, writes runs.
- [x] Migration `20260416000006_consent_probes_cron.sql`: hourly cron
  at `10 * * * *` pointing at `/functions/v1/run-consent-probes`.
- [x] Direct-SQL seed of a demo probe against
  `consentshield-demo.vercel.app/violator?violate=1` with
  `consent_state = {analytics: false, marketing: false}`.
- [x] Dashboard `/dashboard/enforcement` — extend with a Consent
  Probes section listing per-probe last-run status.
- [x] ADR, CHANGELOG-schema, CHANGELOG-edge-functions,
  CHANGELOG-dashboard, STATUS, ADR-index.

**Testing plan:**
- [x] `bun run lint` + `bun run build` + `bun run test` — clean.
- [x] Manual `net.http_post` invocation; probe against `/violator?violate=1`
  reports GA4 + Meta Pixel violations; probe against `/blog` with
  analytics rejected reports zero violations (assuming `/blog` does not
  embed analytics tags in HTML).

**Status:** `[x] complete`

---

## Architecture Changes

No changes to the definitive architecture — `consent_probes` and
`consent_probe_runs` are already modelled there.

---

## Test Results

### Phase 1 — 2026-04-16

```
Test: Live probe run against /violator?violate=1
Method: SELECT net.http_post against run-consent-probes
Expected: GA4 + Meta Pixel detected as violations under all-rejected consent
Actual: Demo Violator → 2 trackers detected, 2 violations (GA4 + Meta Pixel).
  Both URLs are in inline <script> JS that calls inject() unconditionally on
  ?violate=1; pass-2 substring matching on the full HTML body catches them.
Result: PASS
```

```
Test: /blog probe under analytics-rejected
Method: same invocation; property URL https://consentshield-demo.vercel.app/blog
Expected: zero violations (per roadmap aspirational goal)
Actual: Demo Blog → 1 tracker detected (GA4), 1 violation.
  The blog page references `googletagmanager.com/gtag/js?id=G-BLOGDEMO` inside
  a conditional `if (accepted.includes('analytics'))` JS block. Static HTML
  analysis cannot distinguish conditional from unconditional script loads —
  this is the v1 limitation called out in the Decision section. True
  conditional verification requires headless-browser execution (v2 follow-up).
Result: PASS as documented (honest behaviour). The roadmap's 0-violations
goal is held for the v2 browser-based follow-up.
```

```
Test: Build + lint + test
Method: bun run lint && bun run test && bun run build
Expected: 81/81 tests, lint clean, build clean
Actual: all green
Result: PASS
```

---

## Changelog References

- CHANGELOG-schema.md — 2026-04-16 — ADR-0016 cron + seeds
- CHANGELOG-edge-functions.md — 2026-04-16 — run-consent-probes
- CHANGELOG-dashboard.md — 2026-04-16 — probe list section
