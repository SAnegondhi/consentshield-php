# Status page — setup + operations runbook

**Scope:** ADR-1018 Sprints 1.1 through 1.5. Covers DNS / Vercel / Supabase config the operator needs to complete to take the self-hosted status page fully live.

---

## 1. Schema + admin panel (Sprint 1.1 + 1.2)

**Automatic.** The `20260804000013_status_page.sql` migration creates `public.status_subsystems`, `public.status_checks`, `public.status_incidents` + seeds 6 subsystems + creates 4 admin RPCs (`set_status_subsystem_state`, `post_status_incident`, `update_status_incident`, `resolve_status_incident`). Admin panel lives at `/admin/(operator)/status`.

**Operator step:** Visit the admin panel, confirm all 6 subsystems appear in `operational` state, and post a test incident → resolve it → verify it shows in history.

---

## 2. Public read-only page (Sprint 1.3)

**Ships at:** `https://app.consentshield.in/status` (unauthenticated route inside the customer app).

**Routing:** Next.js `(public)` route group excludes the customer-app proxy auth check. Page is cache-control `s-maxage=60` so operator-posted incidents propagate within a minute. Force-refresh by busting the cache-control via an admin button (Sprint 1.3 deliverable).

**Operator step:** After deploying the app, visit `https://app.consentshield.in/status` in a private window (no auth) and confirm it renders. If the fetch fails without auth, the proxy allow-list needs a patch — see `app/src/proxy.ts` for the `(public)` group bypass.

---

## 3. DNS cutover to `status.consentshield.in` (Sprint 1.5)

Two paths, pick one.

### Option A — Host alias on the existing `app` Vercel project

Simplest. One DNS record + one Vercel alias; no separate deployment.

1. **Cloudflare DNS** (or wherever `consentshield.in` is registered):
   - Add a **CNAME** record:
     - Name: `status`
     - Target: `cname.vercel-dns.com`
     - Proxy: **DNS only** (grey cloud) — Vercel needs the real request path for TLS
2. **Vercel dashboard** → `app` project → **Settings** → **Domains** → **Add**:
   - Domain: `status.consentshield.in`
   - Vercel auto-issues a TLS cert in ~30s
3. **App routing** — the `app` project needs a host-based rewrite so `status.consentshield.in/*` lands on `/status/*`. Two ways:

   **A.1 `vercel.ts` host rewrite** (preferred after ADR-1006 `vercel.ts` migration):
   ```ts
   import { routes, type VercelConfig } from '@vercel/config/v1'
   export const config: VercelConfig = {
     rewrites: [
       routes.rewrite({
         source: '/:path*',
         destination: '/status/:path*',
         has: [{ type: 'host', value: 'status.consentshield.in' }],
       }),
     ],
   }
   ```

   **A.2 Next.js middleware** (current, transitional):
   ```ts
   // app/src/proxy.ts — near the top of the matcher
   if (hostname === 'status.consentshield.in' && !pathname.startsWith('/status')) {
     return NextResponse.rewrite(new URL('/status' + pathname, request.url))
   }
   ```

4. **Probe from a clean browser:** `https://status.consentshield.in` returns the rendered status page. `curl -I` should show `Cache-Control: s-maxage=60`.

### Option B — Dedicated Vercel project for `status.consentshield.in`

Use this if you want the status page to survive an outage in the main `app` project. Slightly more deploy complexity but a real second-region surface.

1. Create a new Vercel project `consentshield-status`.
2. Deploy a minimal Next.js app whose only route is `/` (renders the status page) reading from the same Supabase project via the anon key.
3. Wire `status.consentshield.in` as the project's domain.
4. Monthly cost: $0 (Vercel Hobby fits) → $20/mo when/if it hits the hobby quota.

**Recommended:** start with Option A, split to Option B only if availability needs demand it. The schema stays identical either way.

---

## 4. Probe cron (Sprint 1.4 — to build)

Not implemented yet. When it lands, the setup is:

1. **Edge Function** `supabase/functions/run-status-probes/index.ts` iterates subsystems, hits `health_url`, records one row per subsystem into `status_checks`. 3 consecutive non-200 or timeout responses flips `current_state` to `degraded` → `down`.
2. **pg_cron** schedule: `*/5 * * * *`.
3. Register the cron via `select cron.schedule('status-probes-5min', '*/5 * * * *', $$select net.http_post(...);$$);` — same pattern as `send-sla-reminders`.
4. **Probe key:** use an org-scoped `cs_live_*` key seeded with scope `read:consent` that calls `/v1/_ping` — serves as the verification-API probe without side effects.

**Until probe cron ships**, `current_state` is operator-maintained only (manual flip via admin panel). That's adequate for a first BFSI procurement review — every real incident gets a posted `status_incidents` row regardless of probe automation.

---

## 5. Ongoing operator workflow

### Opening an incident

1. Admin console → **Status Page** → **Post incident**.
2. Title (what's broken, plain English) + description (what customers see) + severity + affected subsystems.
3. Initial status = `investigating`.
4. POSTing emits an `admin.admin_audit_log` row with `action='status.incident_posted'`.

### Progressing an incident

As you learn more, progress through statuses: `investigating → identified → monitoring → resolved`. Each update records a `last_update_note`. The public page shows the most recent note under the incident title.

### Resolving an incident

Set status to `resolved` (or use the **Resolve** button). Paste the postmortem URL if you have one (Notion, Google Doc, internal Wiki). The public page keeps the resolved incident in the 90-day history collapsible.

### Scheduled maintenance

Flip the affected subsystem to `maintenance` via the admin panel before the window. Post an incident with severity `sev3` + status `monitoring`. Flip back to `operational` when done.

---

## 6. Freshness + staleness

- Public page cache is 60s — expect a 1-minute delay between operator action and what public users see. Fine for an incident-comms surface; not OK for real-time ops.
- `status_checks` retains forever by default. If the volume becomes a concern, add a retention cron that deletes rows older than 90 days (mirrors ADR-1004 Phase 3 pattern).

---

## 7. Operator-visible tracking

The ADR-1017 Ops Readiness flag for ADR-1005 Sprint 4 (status page provisioning) should be flipped to `resolved` after:
- Sprint 1.3 public page is live on `https://app.consentshield.in/status`
- DNS + Vercel alias are in place (Sprint 1.5)
- The first real incident has been posted + resolved end-to-end (dogfoods the workflow)

Until probe cron ships (Sprint 1.4), the flag stays `in_progress` with the note "manual-state only, probe cron pending."
