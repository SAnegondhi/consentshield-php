// ADR-1006 Phase 1 — `@consentshield/node` public surface.
//
// Sprint 1.1 (THIS) ships: ConsentShieldClient + auth + transport +
// error hierarchy + ping. Per-endpoint methods (verify, verifyBatch,
// recordConsent, revokeArtefact, triggerDeletion, artefact CRUD,
// rights, audit) land in Sprint 1.2 / 1.3.

export { ConsentShieldClient, type ConsentShieldClientOptions } from './client'

export {
  ConsentShieldError,
  ConsentShieldApiError,
  ConsentShieldNetworkError,
  ConsentShieldTimeoutError,
  ConsentVerifyError,
  type ProblemJson,
} from './errors'

export type { FetchImpl, HttpRequest } from './http'

export {
  isOpenFailure,
  type VerifyInput,
  type VerifyBatchInput,
} from './verify'

export type {
  IdentifierType,
  OpenFailureEnvelope,
  VerifyBatchEnvelope,
  VerifyBatchResultRow,
  VerifyEnvelope,
  VerifyStatus,
} from './types'
