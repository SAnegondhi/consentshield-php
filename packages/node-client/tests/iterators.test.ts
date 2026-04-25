// ADR-1006 Phase 1 Sprint 1.4 — async-iterator coverage for events / audit /
// deletion-receipts / rights-requests. Sprint 1.3's methods.test.ts covered
// `iterateArtefacts`; this file rounds out the four remaining helpers + a
// few extra validator branches that pushed coverage over the 80% floor.

import { describe, it, expect, vi } from 'vitest'
import { ConsentShieldClient } from '../src/index'
import type {
  AuditLogEnvelope,
  DeletionReceiptsEnvelope,
  EventListEnvelope,
  FetchImpl,
  RightsRequestListEnvelope,
} from '../src/index'

const VALID_KEY = 'cs_live_abc'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeClient(fetchImpl: FetchImpl) {
  return new ConsentShieldClient({
    apiKey: VALID_KEY,
    baseUrl: 'https://api.example.com',
    fetchImpl,
    sleepImpl: async () => {},
    maxRetries: 0,
  })
}

describe('iterateEvents', () => {
  it('walks pages until next_cursor is null', async () => {
    const page1: EventListEnvelope = {
      items: [
        { id: 'e1', property_id: 'p', source: 'banner', event_type: 'consent_given', purposes_accepted_count: 2, purposes_rejected_count: 0, identifier_type: 'email', artefact_count: 2, created_at: '2026-04-25T10:00:00Z' },
      ],
      next_cursor: 'c2',
    }
    const page2: EventListEnvelope = {
      items: [
        { id: 'e2', property_id: 'p', source: 'banner', event_type: 'consent_given', purposes_accepted_count: 1, purposes_rejected_count: 0, identifier_type: 'email', artefact_count: 1, created_at: '2026-04-25T09:00:00Z' },
      ],
      next_cursor: null,
    }
    const fetchMock = vi.fn<FetchImpl>(async (input) => {
      const u = new URL(String(input))
      return u.searchParams.get('cursor') === 'c2' ? jsonResponse(page2) : jsonResponse(page1)
    })
    const client = makeClient(fetchMock)
    const seen: string[] = []
    for await (const e of client.iterateEvents({ propertyId: 'p' })) seen.push(e.id)
    expect(seen).toEqual(['e1', 'e2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('iterateAuditLog', () => {
  it('walks pages until next_cursor is null + composes snake_case query', async () => {
    const page1: AuditLogEnvelope = {
      items: [
        { id: 'a1', actor_id: 'u-1', actor_email: 'u@x.com', event_type: 'consent_recorded', entity_type: 'artefact', entity_id: 'art-1', payload: {}, created_at: '2026-04-25T10:00:00Z' },
      ],
      next_cursor: 'c2',
    }
    const page2: AuditLogEnvelope = {
      items: [
        { id: 'a2', actor_id: null, actor_email: null, event_type: 'consent_revoked', entity_type: null, entity_id: null, payload: null, created_at: '2026-04-25T09:00:00Z' },
      ],
      next_cursor: null,
    }
    const fetchMock = vi.fn<FetchImpl>(async (input) => {
      const u = new URL(String(input))
      return u.searchParams.get('cursor') === 'c2' ? jsonResponse(page2) : jsonResponse(page1)
    })
    const client = makeClient(fetchMock)
    const seen: string[] = []
    for await (const e of client.iterateAuditLog({ eventType: 'consent_recorded' })) seen.push(e.id)
    expect(seen).toEqual(['a1', 'a2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('iterateDeletionReceipts', () => {
  it('walks pages until next_cursor is null', async () => {
    const page1: DeletionReceiptsEnvelope = {
      items: [
        { id: 'r1', trigger_type: 'rights_request', trigger_id: null, artefact_id: null, connector_id: null, target_system: 'mailchimp', status: 'pending', retry_count: 0, failure_reason: null, requested_at: null, confirmed_at: null, created_at: '2026-04-25T10:00:00Z' },
      ],
      next_cursor: 'c2',
    }
    const page2: DeletionReceiptsEnvelope = {
      items: [
        { id: 'r2', trigger_type: 'rights_request', trigger_id: null, artefact_id: null, connector_id: null, target_system: 'hubspot', status: 'confirmed', retry_count: 1, failure_reason: null, requested_at: null, confirmed_at: '2026-04-25T11:00:00Z', created_at: '2026-04-25T09:00:00Z' },
      ],
      next_cursor: null,
    }
    const fetchMock = vi.fn<FetchImpl>(async (input) => {
      const u = new URL(String(input))
      return u.searchParams.get('cursor') === 'c2' ? jsonResponse(page2) : jsonResponse(page1)
    })
    const client = makeClient(fetchMock)
    const seen: string[] = []
    for await (const r of client.iterateDeletionReceipts({ status: 'pending' })) seen.push(r.id)
    expect(seen).toEqual(['r1', 'r2'])
  })
})

describe('iterateRightsRequests', () => {
  it('walks pages until next_cursor is null', async () => {
    const page1: RightsRequestListEnvelope = {
      items: [
        { id: 'rr1', request_type: 'erasure', requestor_name: 'Alice', requestor_email: 'a@x.com', status: 'new', captured_via: 'api', identity_verified: true, identity_verified_at: '2026-04-25T10:00:00Z', identity_method: 'OTP', sla_deadline: '2026-05-25T10:00:00Z', response_sent_at: null, created_by_api_key_id: 'k', created_at: '2026-04-25T10:00:00Z', updated_at: '2026-04-25T10:00:00Z' },
      ],
      next_cursor: 'c2',
    }
    const page2: RightsRequestListEnvelope = {
      items: [
        { id: 'rr2', request_type: 'access', requestor_name: 'Bob', requestor_email: 'b@x.com', status: 'completed', captured_via: 'portal', identity_verified: true, identity_verified_at: '2026-04-25T09:00:00Z', identity_method: 'OTP', sla_deadline: '2026-05-25T09:00:00Z', response_sent_at: '2026-04-26T09:00:00Z', created_by_api_key_id: 'k', created_at: '2026-04-25T09:00:00Z', updated_at: '2026-04-26T09:00:00Z' },
      ],
      next_cursor: null,
    }
    const fetchMock = vi.fn<FetchImpl>(async (input) => {
      const u = new URL(String(input))
      return u.searchParams.get('cursor') === 'c2' ? jsonResponse(page2) : jsonResponse(page1)
    })
    const client = makeClient(fetchMock)
    const seen: string[] = []
    for await (const r of client.iterateRightsRequests({ requestType: 'erasure' })) seen.push(r.id)
    expect(seen).toEqual(['rr1', 'rr2'])
  })

  it('listRightsRequests rejects invalid requestType + capturedVia synchronously', async () => {
    const fetchMock = vi.fn<FetchImpl>()
    const client = makeClient(fetchMock)
    await expect(
      client.listRightsRequests({ requestType: 'unknown' as unknown as 'erasure' }),
    ).rejects.toBeInstanceOf(TypeError)
    await expect(
      client.listRightsRequests({ capturedVia: 'fax' as unknown as 'portal' }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('createRightsRequest rejects invalid capturedVia synchronously', async () => {
    const fetchMock = vi.fn<FetchImpl>()
    const client = makeClient(fetchMock)
    await expect(
      client.createRightsRequest({
        type: 'erasure',
        requestorName: 'Alice',
        requestorEmail: 'a@x.com',
        identityVerifiedBy: 'OTP',
        capturedVia: 'fax' as unknown as 'portal',
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('triggerDeletion / recordConsent — extra validator branches', () => {
  it('triggerDeletion rejects non-array purposeCodes + non-array scopeOverride + invalid actorType', async () => {
    const fetchMock = vi.fn<FetchImpl>()
    const client = makeClient(fetchMock)
    await expect(
      client.triggerDeletion({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        reason: 'consent_revoked', purposeCodes: 'marketing' as unknown as string[],
      }),
    ).rejects.toThrow(/purposeCodes must be an array/)

    await expect(
      client.triggerDeletion({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        reason: 'erasure_request', scopeOverride: 'art-1' as unknown as string[],
      }),
    ).rejects.toThrow(/scopeOverride must be an array/)

    await expect(
      client.triggerDeletion({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        reason: 'erasure_request',
        actorType: 'admin' as unknown as 'user',
      }),
    ).rejects.toThrow(/actorType must be one of/)

    await expect(
      client.triggerDeletion({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        reason: 'consent_revoked', purposeCodes: ['marketing', '' as unknown as string],
      }),
    ).rejects.toThrow(/purposeCodes\[1\]/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recordConsent forwards rejectedPurposeDefinitionIds when supplied', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      jsonResponse({ event_id: 'e', created_at: 't', artefact_ids: [], idempotent_replay: false }, 201),
    )
    const client = makeClient(fetchMock)
    await client.recordConsent({
      propertyId: 'p',
      dataPrincipalIdentifier: 'd',
      identifierType: 'email',
      purposeDefinitionIds: ['pd-1'],
      rejectedPurposeDefinitionIds: ['pd-2', 'pd-3'],
      capturedAt: 't',
    })
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as Record<string, unknown>
    expect(body.rejected_purpose_definition_ids).toEqual(['pd-2', 'pd-3'])
  })

  it('recordConsent rejects non-array rejectedPurposeDefinitionIds + non-string entries', async () => {
    const fetchMock = vi.fn<FetchImpl>()
    const client = makeClient(fetchMock)
    await expect(
      client.recordConsent({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        purposeDefinitionIds: ['pd-1'], capturedAt: 't',
        rejectedPurposeDefinitionIds: 'pd-2' as unknown as string[],
      }),
    ).rejects.toThrow(/rejectedPurposeDefinitionIds must be an array/)

    await expect(
      client.recordConsent({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        purposeDefinitionIds: ['pd-1'], capturedAt: 't',
        rejectedPurposeDefinitionIds: ['pd-2', 42 as unknown as string],
      }),
    ).rejects.toThrow(/rejectedPurposeDefinitionIds\[1\]/)

    await expect(
      client.recordConsent({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        purposeDefinitionIds: 'pd-1' as unknown as string[], capturedAt: 't',
      }),
    ).rejects.toThrow(/purposeDefinitionIds must be an array/)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
