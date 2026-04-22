import { test, expect } from './utils/fixtures'
import { countConsentEventsSince } from './utils/supabase-admin'

// Paired negative for worker-consent-event.spec.ts — ADR-1014 Sprint 3.2.
// See specs/worker-consent-event-origin-mismatch.md for the normative spec.
//
// Unlike worker-consent-event-tampered.spec.ts (which exercises the HMAC
// path with a flipped signature byte), this spec exercises the Origin-path
// rejection: a browser-style unsigned POST whose Origin header does not
// appear in the property's allowed_origins list must 403 at the Worker's
// step-1 origin validation and never write a buffer row.

test.describe('@pipeline @worker Origin mismatch — paired negative', () => {
  test('POST /v1/events with unsigned body and foreign Origin → 403 + zero rows written', async ({
    ecommerce,
    tracedRequest
  }, testInfo) => {
    const workerUrl = process.env.WORKER_URL
    if (!workerUrl) {
      test.skip(true, 'WORKER_URL env not set.')
      return
    }

    // Use ecommerce.properties[2] (Sandbox probe) so this test's counts are
    // isolated from the positive (properties[0]) and the HMAC-tampered
    // negative (properties[1]). Sandbox probe's allowed_origins list is
    // `['http://localhost:4001']` — no public origins at all — which makes
    // "not in the allowed list" trivially expressible from a test runner on
    // any other host.
    const property = ecommerce.properties[2]
    expect(
      property,
      'fixture missing properties[2] (Sandbox probe)'
    ).toBeTruthy()

    const cutoffIso = new Date().toISOString()

    // Unsigned envelope — no `signature` / `timestamp` fields. This puts the
    // Worker on the origin-only path, where origin MUST be valid.
    const envelope = {
      org_id: ecommerce.orgId,
      property_id: property.id,
      banner_id: property.bannerId,
      banner_version: 1,
      event_type: 'consent_given',
      purposes_accepted: ['essential']
    }

    // Origin that is NOT in allowed_origins. Any plausible attacker-shape
    // hostname works; we use a domain that clearly shouldn't be in any
    // fixture's allow-list.
    const foreignOrigin = 'https://attacker.example.invalid'

    const response = await tracedRequest.post(`${workerUrl}/v1/events`, {
      headers: {
        'Content-Type': 'application/json',
        Origin: foreignOrigin
      },
      data: envelope,
      failOnStatusCode: false
    })

    const status = response.status()
    const bodyText = await response.text()

    await testInfo.attach('origin-mismatch-response.json', {
      body: JSON.stringify(
        {
          status,
          headers: response.headers(),
          bodyPreview: bodyText.slice(0, 300)
        },
        null,
        2
      ),
      contentType: 'application/json'
    })

    expect(status, `expected 403, got ${status}: ${bodyText}`).toBe(403)
    // Body shape: `Origin <origin> is not in the allowed origins for this property`
    expect(bodyText).toContain(foreignOrigin)
    expect(bodyText).toContain('not in the allowed origins')

    // Observable-state proof: zero rows for this property since cutoff. The
    // Worker's origin check happens BEFORE any INSERT, so we give it 1 s to
    // not-write anything — same reasoning as the HMAC-tampered paired test.
    await new Promise((r) => setTimeout(r, 1_000))

    const count = await countConsentEventsSince(property.id, cutoffIso)
    expect(
      count,
      'origin-mismatch event must not produce a buffer row'
    ).toBe(0)
  })

  test('POST /v1/events unsigned with no Origin header → 403 + zero rows written', async ({
    ecommerce,
    tracedRequest
  }, testInfo) => {
    const workerUrl = process.env.WORKER_URL
    if (!workerUrl) {
      test.skip(true, 'WORKER_URL env not set.')
      return
    }

    // Same property as the paired test above — the `cutoffIso` scoping keeps
    // the two sub-tests from observing each other's (non-)rows. Serial-in-
    // file execution guarantees the first sub-test has already completed
    // its cutoff-window poll before this one starts.
    const property = ecommerce.properties[2]
    expect(property).toBeTruthy()

    const cutoffIso = new Date().toISOString()

    const envelope = {
      org_id: ecommerce.orgId,
      property_id: property.id,
      banner_id: property.bannerId,
      banner_version: 1,
      event_type: 'consent_given',
      purposes_accepted: ['essential']
    }

    // Deliberately omit Origin (and Referer). Playwright's APIRequestContext
    // won't add one for a raw POST like this.
    const response = await tracedRequest.post(`${workerUrl}/v1/events`, {
      headers: { 'Content-Type': 'application/json' },
      data: envelope,
      failOnStatusCode: false
    })

    const status = response.status()
    const bodyText = await response.text()

    await testInfo.attach('origin-missing-response.json', {
      body: JSON.stringify(
        {
          status,
          headers: response.headers(),
          bodyPreview: bodyText.slice(0, 300)
        },
        null,
        2
      ),
      contentType: 'application/json'
    })

    expect(status, `expected 403, got ${status}: ${bodyText}`).toBe(403)
    // Body shape: "Origin required for unsigned events" (worker/src/events.ts)
    expect(bodyText).toContain('Origin required')

    await new Promise((r) => setTimeout(r, 1_000))

    const count = await countConsentEventsSince(property.id, cutoffIso)
    expect(
      count,
      'unsigned + no-origin event must not produce a buffer row'
    ).toBe(0)
  })
})
