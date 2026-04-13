# ADR-0002: Worker HMAC Verification + Origin Validation

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Proposed
**Date proposed:** 2026-04-13
**Date completed:** —

---

## Context

The Cloudflare Worker (ADR-0001 Sprint 3.1) accepts consent events and tracker observations but currently lacks the two critical security validations mandated by the architecture:

1. **HMAC verification** — every consent event must be signed with the per-property signing secret. The Worker rejects invalid/expired signatures.
2. **Origin validation** — every request's Origin/Referer header must match the web property's registered allowed_origins. Mismatches are rejected with 403.

Without these, any curl command can inject fake consent events into any org's buffer.

## Decision

Implement the full 4-step validation pipeline from the definitive architecture Section 6.4:
1. Origin validation
2. HMAC verification (signature + timestamp ±5 minutes)
3. Payload validation (already done in ADR-0001)
4. Write via cs_worker role (already done in ADR-0001)

Also implement the signing secret rotation mechanism: new secret generated on banner publish, old secret valid for 1-hour grace period.

## Consequences

After this ADR:
- Fake consent events from curl/bots are rejected
- Replay attacks are prevented (±5 min timestamp window)
- Cross-origin injection is blocked
- The Worker is production-ready for security

---

## Implementation Plan

### Phase 1: HMAC + Origin Validation

#### Sprint 1.1: Origin Validation
**Estimated effort:** 2–3 hours
**Deliverables:**
- [ ] Worker reads `banner:config:{propertyId}` from KV (includes allowed_origins)
- [ ] On cache miss, fetch web_properties.allowed_origins via cs_worker role
- [ ] Compare request Origin/Referer against allowed_origins
- [ ] Match → proceed. Missing → flag as `origin_unverified`. Mismatch → 403.
- [ ] Add origin_verified field to consent_events and tracker_observations payloads

**Testing plan:**
- [ ] Request with matching Origin → 202
- [ ] Request with wrong Origin → 403
- [ ] Request with no Origin → 202 but flagged origin_unverified
- [ ] KV cache hit vs cache miss both work

**Status:** `[ ] planned`

#### Sprint 1.2: HMAC Signature Verification
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] Worker reads signing secret from KV (`banner:signing_secret:{propertyId}`)
- [ ] On cache miss, fetch web_properties.event_signing_secret via cs_worker role
- [ ] Extract signature + timestamp from request body
- [ ] Verify timestamp within ±5 minutes
- [ ] Compute HMAC-SHA256(org_id + property_id + timestamp, signing_secret)
- [ ] Compare against provided signature (timing-safe)
- [ ] Expired timestamp → 403. Invalid signature → 403.

**Testing plan:**
- [ ] Valid signature + valid timestamp → 202
- [ ] Valid signature + expired timestamp → 403
- [ ] Invalid signature → 403
- [ ] Missing signature → 403
- [ ] Same tests for /v1/observations endpoint

**Status:** `[ ] planned`

#### Sprint 1.3: Secret Rotation on Banner Publish
**Estimated effort:** 2–3 hours
**Deliverables:**
- [ ] POST /api/orgs/[orgId]/banners/[id]/publish generates new event_signing_secret
- [ ] Old secret cached in KV with 1-hour TTL (`banner:signing_secret_prev:{propertyId}`)
- [ ] Worker checks current secret first, falls back to previous secret during grace period
- [ ] After grace period, old secret expires from KV automatically

**Testing plan:**
- [ ] Publish new banner → new secret active
- [ ] Events signed with old secret accepted during grace period
- [ ] Events signed with old secret rejected after grace period expires

**Status:** `[ ] planned`

---

## Architecture Changes

_None — implements existing architecture Section 6.4._

---

## Test Results

_Pending_

---

## Changelog References

- CHANGELOG-worker.md — [date] — Sprint 1.1, 1.2
- CHANGELOG-api.md — [date] — Sprint 1.3
