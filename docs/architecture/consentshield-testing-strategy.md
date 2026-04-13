# ConsentShield — The Testing Question

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Development reference · April 2026*
*Companion to: Definitive Architecture Reference, Complete Schema Design*

---

## Why Testing Is Different for a Compliance Product

A bug in a todo app is annoying. A bug in a compliance product is a legal liability. ConsentShield makes claims that carry regulatory weight — "your consent was recorded," "your withdrawal was verified," "this tracker violated your consent configuration," "this data was deleted from 3 systems." Every one of those claims must be true. If any of them is wrong and a Data Protection Board auditor discovers it, the customer's exposure is real and ConsentShield's reputation is destroyed.

The additional constraint: AI-generated code also generates tests. The most dangerous failure mode is a test that passes but doesn't actually verify the compliance requirement — a test that checks "did the function return 200?" when the real question is "did the consent event survive in the customer's R2 bucket?" Review every test with one question: if this test passes but the underlying compliance requirement is violated, would I know?

---

## Testing Priority Order

Testing effort is allocated in strict priority order. The top of the list is tested first, tested most frequently, and never skipped. The bottom of the list is tested when capacity allows.

| Priority | What | Why | Frequency |
|---|---|---|---|
| 1 | Multi-tenant isolation (RLS) | A cross-tenant leak is an extinction event | Every deploy |
| 2 | Consent event integrity | Append-only guarantee + delivery pipeline | Hourly in staging |
| 3 | Tracker detection accuracy | The enforcement engine's credibility | Weekly (test pages), monthly (real sites) |
| 4 | Cloudflare Worker reliability | Banner must never break the customer's website | Every Worker deploy |
| 5 | Workflow correctness | SLA timers and breach clocks have legal deadlines | On every workflow change |
| 6 | Deletion orchestration | "Deleted from Mailchimp at 14:32" must be true | Before each connector ships, monthly thereafter |
| 7 | Security posture scanner | Findings must match reality | Before scanner ships, monthly thereafter |

---

## Priority 1: Multi-Tenant Isolation

### What can go wrong

Org A sees Org B's consent logs. Org A modifies Org B's data inventory. A newly created org inherits data from a previously deleted org. A user without an org_id in their JWT bypasses RLS and sees everything. The service role key leaks to the browser and bypasses all policies.

### How to test

Create two test organisations (Org A and Org B) with one user each. Sign in as User A. Attempt every operation against Org B's data.

```
For each table in the schema:
  Authenticate as User A (Org A member)

  SELECT — query with org_id = Org B
    Expected: 0 rows returned

  INSERT — insert row with org_id = Org B
    Expected: permission denied (RLS violation)

  UPDATE — attempt to update any Org B row
    Expected: 0 rows affected or permission denied

  DELETE — attempt to delete any Org B row
    Expected: 0 rows affected or permission denied
```

For all buffer tables (consent_events, tracker_observations, audit_log, processing_log, rights_request_events, delivery_buffer, deletion_receipts, withdrawal_verifications, security_scans, consent_probe_runs):

```
  Authenticate as User A (Org A member)

  UPDATE any row (even Org A's own rows)
    Expected: permission denied — no UPDATE policy exists

  DELETE any row (even Org A's own rows)
    Expected: permission denied — no DELETE policy exists
```

Additional edge cases:

- Create a user with no organisation membership. Sign in. Query any table. Expected: 0 rows from every table. The `current_org_id()` function returns null, which matches nothing.
- Delete an organisation. Verify all associated data is cascade-deleted. Create a new organisation. Verify it has no residual data from the deleted org.
- Test with the Supabase `anon` key (unauthenticated). Every query should return 0 rows or be rejected.

### Automation

This is implemented as a test script that runs against the Supabase API using real JWTs. It creates the test orgs, runs every assertion, and tears down the test data. The script is triggered on every deploy via a GitHub Action or a Vercel deployment hook.

### The non-negotiable rule

This test suite must pass before any customer data enters the system. It is the first code committed, before any UI. If it fails, development stops until it passes. No exceptions, no "we'll fix it later."

---

## Priority 2: Consent Event Integrity

### What can go wrong

A consent event is lost between the Cloudflare Worker and Supabase. The delivery buffer writes to customer storage but the confirmation fails, so the buffer row is never deleted and the event is delivered twice. The buffer purge job deletes rows before delivery is confirmed, creating a gap in the compliance record. The append-only constraint is bypassed through a migration or a role escalation.

### How to test

**Append-only verification:**

```
Authenticate as the application database role (not service role)

INSERT into consent_events — Expected: success
UPDATE consent_events SET event_type = 'modified' WHERE id = [row just inserted]
  Expected: permission denied
DELETE FROM consent_events WHERE id = [row just inserted]
  Expected: permission denied
```

Run the same test against all 10 buffer tables: tracker_observations, audit_log, processing_log, rights_request_events, delivery_buffer, deletion_receipts, withdrawal_verifications, security_scans, consent_probe_runs.

**Delivery pipeline end-to-end:**

```
1. POST a consent event to cdn.consentshield.in/v1/events (Worker endpoint)
2. Wait 5 seconds
3. Query consent_events buffer table for the event
   Expected: row exists with delivered_at = null (or already delivered)
4. Wait for delivery Edge Function to run (or trigger it manually)
5. Check customer's R2 bucket for the exported event
   Expected: event file exists with correct content
6. Query consent_events buffer table again
   Expected: delivered_at is set (or row is deleted by purge job)
```

**Delivery failure handling:**

```
1. Configure a test org with an invalid export destination (non-existent R2 bucket)
2. POST a consent event
3. Verify: buffer row exists, delivery_error is populated, attempt_count increments
4. Verify: after 10 failed attempts, an alert is triggered (not silently dropped)
5. Fix the export destination
6. Verify: next delivery attempt succeeds, buffer row is cleaned up
```

### Automation

The delivery pipeline test runs hourly in the staging environment via pg_cron calling a Supabase Edge Function. It fires a synthetic consent event, waits for delivery, checks R2, and logs the result. If delivery fails, it sends an alert via the notification channels (email + Slack webhook).

---

## Priority 3: Tracker Detection Accuracy

### What can go wrong

A functional script (Razorpay checkout) is flagged as a marketing tracker — false positive that erodes trust. Meta Pixel loads before consent but the detection misses it — false negative that undermines the enforcement claim. A CDN-hosted font from Google's servers triggers a "Google tracking" alert. A new version of a tracker changes its script URL pattern and the signature database no longer matches.

### How to test

**Controlled test pages (weekly):**

Create 5 HTML pages hosted on a test domain (e.g., test.consentshield.in). Each page loads a known, controlled set of scripts:

| Test page | Scripts loaded | Expected detections |
|---|---|---|
| Page 1: Full tracking | GA4 + Meta Pixel + Hotjar + Razorpay | 3 consent-required (GA4, Meta, Hotjar) + 1 functional (Razorpay) |
| Page 2: Functional only | Razorpay + Intercom chat + Cloudflare CDN | 0 consent-required, 3 functional |
| Page 3: Marketing only | Meta Pixel + Google Ads + LinkedIn Insight | 3 consent-required (all marketing category) |
| Page 4: Empty | No third-party scripts | 0 detections |
| Page 5: Violation scenario | GA4 hardcoded in head (loads before consent) | 1 violation: "loaded before consent" |

Deploy the banner script on each page. Compare the observation report against the known ground truth. Every detection must match. Every missed detection is a bug. Every false positive is a bug.

**Real website calibration (monthly):**

Visit 20–30 real Indian SaaS, ecommerce, and edtech websites. For each:

1. Open browser devtools → Network tab
2. Record which third-party domains load and when
3. Inject the banner script (via devtools console or test proxy)
4. Compare the observation report against your manual audit

Document every discrepancy. Adjust the tracker signature database. Re-test.

**Signature database version control:**

The tracker signature database is a JSON file. Every change is committed with a changelog entry: what was added, modified, or removed, and why. Before any signature update ships, run it against all 5 controlled test pages to verify no regressions.

### What cannot be automated

The monthly real-website calibration is inherently manual. You are comparing ConsentShield's output against your own expert inspection of what's actually loading on a website. There is no oracle to automate against — ConsentShield is the oracle. The human review is the check on the oracle's accuracy.

---

## Priority 4: Cloudflare Worker Reliability

### What can go wrong

The Worker serves a stale banner config from KV after the customer updates their banner. The Worker crashes on a malformed consent event payload and returns a 500 to the user's browser, breaking the page. Supabase is down and the Worker has no fallback, so banners stop loading for all customers. The Worker's CORS headers are wrong and consent events are silently blocked by the browser.

### How to test

**Banner delivery:**

```
# Correct delivery
curl -s "https://cdn.consentshield.in/v1/banner.js?org=test_org&prop=test_prop"
  Expected: 200, Content-Type: application/javascript, non-empty body

# Missing parameters
curl -s "https://cdn.consentshield.in/v1/banner.js"
  Expected: 400

# Non-existent property
curl -s "https://cdn.consentshield.in/v1/banner.js?org=fake&prop=fake"
  Expected: 404

# KV cache invalidation: update banner config in Supabase, wait 5 minutes,
# request banner again. Expected: new config served.
```

**Consent event ingestion:**

```
# Valid event
curl -X POST "https://cdn.consentshield.in/v1/events" \
  -H "Content-Type: application/json" \
  -d '{"org_id":"test","property_id":"test","banner_id":"test","event_type":"consent_given","purposes_accepted":["analytics"]}'
  Expected: 202

# Invalid event type
curl -X POST ... -d '{"org_id":"test","event_type":"invalid"}'
  Expected: 400

# Malformed JSON
curl -X POST ... -d 'not json'
  Expected: 400 (not 500 — must not crash)

# CORS preflight
curl -X OPTIONS "https://cdn.consentshield.in/v1/events"
  Expected: 200 with Access-Control-Allow-Origin: *
```

**Supabase downtime simulation:**

Using `wrangler dev` locally, point the Worker's SUPABASE_URL at a non-existent host. Request a banner. Expected behaviour: Worker serves from KV cache if available, returns 503 gracefully if not. The customer's website continues to function — the banner simply doesn't appear. It must never return a JavaScript error that breaks the page.

### Automation

The curl-based tests can run as a simple bash script in CI. The Supabase downtime simulation is a local test during development, not a CI test.

---

## Priority 5: Workflow Correctness

### What can go wrong

The SLA deadline is calculated wrong — 30 business days instead of 30 calendar days (DPDP specifies calendar days). The 7-day reminder fires on day 8 instead of day 7. The breach notification 72-hour clock starts from the wrong timestamp (report time vs discovery time). A rights request stuck in "identity check" status never triggers an SLA warning because the timer only runs on "in progress" requests.

### How to test

**SLA timer accuracy:**

```sql
-- Create a rights request with a known created_at
INSERT INTO rights_requests (org_id, request_type, requestor_name, requestor_email, created_at)
VALUES ('test_org', 'erasure', 'Test User', 'test@example.com', '2026-04-01 10:00:00+05:30');

-- Verify sla_deadline
SELECT sla_deadline FROM rights_requests WHERE id = [new row];
  Expected: '2026-05-01 10:00:00+05:30' (exactly 30 days)
```

**Breach notification deadline:**

```sql
INSERT INTO breach_notifications (org_id, discovered_at)
VALUES ('test_org', '2026-04-01 10:00:00+05:30');

SELECT dpb_notification_deadline FROM breach_notifications WHERE id = [new row];
  Expected: '2026-04-04 10:00:00+05:30' (exactly 72 hours)
```

**Reminder Edge Function:**

```
1. Create a rights request dated 24 days ago (6 days remaining)
2. Trigger the send-sla-reminders Edge Function
   Expected: no reminder sent (threshold is 7 days)

3. Create a rights request dated 23 days ago (7 days remaining)
4. Trigger the Edge Function
   Expected: reminder email sent to compliance contact

5. Create a rights request dated 31 days ago (1 day overdue)
6. Trigger the Edge Function
   Expected: overdue alert sent
```

**Status edge cases:**

```
1. Create a rights request, leave status as 'new' (never assigned)
2. Let 30 days pass
   Expected: SLA warning fires regardless of status — the clock doesn't wait for someone to start working

3. Create a rights request, set status to 'completed', set completed_at to day 29
   Expected: no SLA warning — request was completed in time
```

### Automation

These are database-level tests implemented as SQL scripts that create test data, trigger the Edge Functions, check the results, and clean up. Run on every change to the workflow engine or the reminder functions.

---

## Priority 6: Deletion Orchestration

### What can go wrong

ConsentShield reports "Mailchimp: 1 subscriber deleted at 14:32" but the subscriber still exists in Mailchimp. The deletion API returns 200 but the data isn't actually deleted (some APIs return success for already-deleted or non-existent records). The webhook callback never arrives and ConsentShield shows "pending" forever with no timeout. OAuth tokens expire and deletions silently fail.

### How to test

**Pre-built connectors (per connector):**

```
1. Create a real test record in the third-party service
   (e.g., add a subscriber to a Mailchimp test list)

2. Trigger deletion through ConsentShield

3. Wait for the API response

4. Query the third-party service directly
   Expected: record no longer exists (or is anonymised, depending on the service)

5. Check deletion_receipts table
   Expected: status = 'confirmed', confirmed_at populated, response_payload contains the API response

6. Check audit_log
   Expected: deletion event logged with correct details
```

**Generic webhook protocol:**

```
1. Set up a test webhook receiver (simple Express server or a service like webhook.site)

2. Trigger a deletion via ConsentShield's webhook connector

3. Verify the payload received at the webhook matches the expected schema:
   {
     event: 'deletion_request',
     request_id: [uuid],
     data_principal: { identifier: '...', identifier_type: 'email' },
     reason: 'erasure_request',
     callback_url: 'https://api.consentshield.in/v1/deletion-receipts/[uuid]',
     deadline: '...'
   }

4. Send the confirmation callback to the callback_url

5. Check deletion_receipts table
   Expected: status updated to 'confirmed'

6. Test timeout: don't send the callback. Wait for retry.
   Expected: attempt_count increments, retry fires per retry_policy

7. Test permanent failure: return 500 from the webhook 10 times
   Expected: status set to 'failed', alert sent to compliance contact
```

**OAuth token expiry:**

```
1. Connect a test Mailchimp account
2. Manually invalidate the OAuth token (revoke via Mailchimp settings)
3. Trigger a deletion
   Expected: connector status changes to 'error', last_error populated,
   dashboard shows reconnect prompt, deletion_receipt shows 'failed'
```

### Test accounts

Set up dedicated test/developer-tier accounts on each integrated service. Never test deletion against a customer's real account. Document the test account credentials in a secure location (not in the codebase).

| Service | Test account | Notes |
|---|---|---|
| Mailchimp | Free plan, dedicated test list | Create 10 test subscribers before each test run |
| HubSpot | Developer account | Free sandbox with full API access |
| Zoho CRM | Developer sandbox | Free, separate from production |

---

## Priority 7: Security Posture Scanner

### What can go wrong

The scanner reports "HSTS missing" but the header is present (false positive). The scanner misses an expired SSL certificate (false negative). The vulnerable library detection reports jQuery 3.7.1 as vulnerable when it's not (stale CVE database). The scanner takes too long and times out, leaving the security score stale.

### How to test

**Controlled test pages:**

| Test page | Configuration | Expected findings |
|---|---|---|
| secure.test.consentshield.in | Valid SSL, all headers present, no vulnerable libraries | 0 findings — all pass |
| insecure.test.consentshield.in | Self-signed cert, no security headers, jQuery 3.3.1 | SSL: critical, HSTS: warning, CSP: warning, jQuery: critical |
| partial.test.consentshield.in | Valid SSL, HSTS present, CSP partial, mixed content | CSP: partial, mixed content: warning |

Run the scanner against each page. Compare output against known configuration. Every finding must match. Every missed finding is a bug.

**Cross-reference with known tools:**

Run Mozilla Observatory (https://observatory.mozilla.org) against the same test pages. Compare ConsentShield's findings against Observatory's. They should broadly agree on the major signals (SSL, HSTS, CSP). Document any discrepancies and determine whether ConsentShield or Observatory is more correct.

---

## Priority 1b: Database Guard Verification

These tests run the verification queries from consentshield-complete-schema-design.md Section 9. They must pass on every deploy alongside the RLS isolation tests.

### What can go wrong

A migration removes RLS from a table and nobody notices. A scoped role gains excessive permissions through a careless GRANT. A trigger is dropped during a schema change. The sweep job is deactivated. Buffer tables gain UPDATE/DELETE grants for the authenticated role through a policy change.

### How to test

Run all 11 verification queries from Section 9 of the schema design doc:

```
1. RLS enabled on every table — expected: rowsecurity = true for ALL rows
2. No UPDATE/DELETE grants on buffer tables for authenticated — expected: 0 rows
3. No INSERT grants on critical buffers for authenticated — expected: 0 rows
4. SLA deadline trigger active — expected: 1 row, INSERT, BEFORE
5. Breach deadline trigger active — expected: 1 row, INSERT, BEFORE
6. pg_cron jobs scheduled — expected: all 5 jobs active
7. No stale buffer data — expected: 0 rows from detect_stuck_buffers()
8a-8g. Scoped role privilege tests (cs_worker, cs_delivery, cs_orchestrator)
9. Event signing secrets populated — expected: 0 rows with null/short secrets
10. Encryption salts populated — expected: 0 rows with null/short salts
11. Cross-tenant isolation — expected: 0 rows returned for wrong org
```

### Automation

This is implemented as a SQL test script that runs the same verification queries in the schema doc. Triggered on every deploy via the same mechanism as the RLS test suite. If any verification fails, deployment is blocked.

---

## Priority 8: Rights Request Submission Flow (Turnstile + OTP)

### What can go wrong

A bot submits thousands of rights requests without Turnstile verification, flooding the compliance contact with emails. A user submits a request with a fake email, and the compliance contact is notified before the email is verified. The OTP expiry window is too long and a leaked OTP is reused hours later. An abandoned request (no OTP verification) is never cleaned up.

### How to test

```
1. Submit rights request WITHOUT Turnstile token
   Expected: 403 — rejected before any database row is created

2. Submit with valid Turnstile but skip OTP verification
   Expected: row created with email_verified = false
   Expected: NO notification email sent to compliance contact
   Expected: row auto-deleted after 24 hours

3. Submit with valid Turnstile + correct OTP
   Expected: email_verified = true, notification email sent to compliance contact
   Expected: SLA clock starts from original submission time, not OTP time

4. Submit with valid Turnstile + wrong OTP 5 times
   Expected: row remains with email_verified = false, rate-limited OTP attempts

5. Rate limiting: 6 submissions from same IP in 1 hour
   Expected: 6th request returns 429
```

---

## Priority 9: Processing Mode Enforcement

### What can go wrong

A Zero-Storage organisation's consent events are written to a persistent buffer table. An API route fails to check `storage_mode` before writing data. A migration adds a new data path that bypasses the mode check.

### How to test

```
1. Create an org with storage_mode = 'zero_storage'
2. POST a consent event through the Worker
   Expected: event processed, delivered to customer storage, buffer row deleted immediately
   Expected: no row in consent_events with delivered_at IS NULL after 30 seconds

3. Attempt to write directly to any buffer table via API for a zero_storage org
   Expected: rejected at the API gateway level (not at the database level)

4. Create an org with storage_mode = 'standard'
5. POST same consent event
   Expected: normal buffer lifecycle (write → deliver → delete)
```

---

## What Not to Test (Yet)

- **Unit tests for every React component.** The UI is not the risk — the data layer is. Test components only when a specific UI bug has customer impact.
- **Full CI/CD pipeline.** Before you have customers, a manual deploy-and-test cycle is fine. Build CI/CD when the deployment frequency and customer count justify it.
- **GDPR module.** Don't test Phase 3 features during Phase 1. The test infrastructure for GDPR consent detection (geo-based banner switching) is separate work.
- **ABDM integration.** Phase 4. The FHIR edge cases are extensive but irrelevant until clinics commit to pilots.
- **Load testing.** ConsentShield's first year will not have traffic volumes that stress the infrastructure. A Cloudflare Worker handling 10,000 banner loads per day is trivial. Load test when traffic approaches 100,000+ daily events.

---

## The Testing Rhythm

### During Phase 1 build (Weeks 1–8)

| When | What | Who |
|---|---|---|
| Week 1 | RLS isolation test suite written and passing | Write tests, review every assertion |
| Week 1 | Append-only constraint tests passing | Write tests, verify against DPDP requirements |
| Week 2–4 | Worker endpoint tests (curl-based) | Write tests, run against wrangler dev |
| Week 3 | Controlled test pages deployed | Build test pages, write comparison logic |
| Week 3–4 | Tracker detection calibrated against test pages | Inspect results, adjust signature DB |
| Week 5 | Workflow timer tests passing | Write tests, verify time calculations |
| Week 6 | Delivery pipeline end-to-end test running in staging | Write Edge Function, verify R2 content |
| Week 7–8 | Full manual end-to-end: signup → deploy banner → trigger violation → verify dashboard → export audit | Manual testing — no delegation |

### Ongoing after launch

| Frequency | What |
|---|---|
| Every deploy | RLS isolation test suite (automated, blocks deploy on failure) |
| Hourly (staging) | Delivery pipeline health check |
| Weekly | Tracker detection against controlled test pages |
| Monthly | Tracker detection against 20+ real websites |
| Monthly | Deletion connector health check (create + delete test records) |
| Monthly | Security scanner cross-reference against Mozilla Observatory |
| On every schema change | RLS + append-only constraint re-verification |
| On every workflow change | SLA timer + reminder accuracy tests |

### The one manual test that never gets automated

Before every major release, sign up as a brand new customer. Complete the full onboarding. Deploy the banner on a real test site. Trigger a consent event. Trigger a tracker violation. Submit a rights request. Approve it. Trigger deletion. Export the audit package. Open the PDF. Read it. Is the data correct? Is the timeline accurate? Does the enforcement evidence actually show what the dashboard said it would show?

This takes 30 minutes. It catches integration bugs that no individual automated test covers. Do it every time.

---

*Document prepared April 2026. Testing priorities should be reviewed at each phase checkpoint. The RLS isolation test is the only test classified as a deploy blocker — all others are monitoring tests that alert on failure but do not block deployment.*
