// ADR-1006 Phase 1 Sprint 1.4 — Express middleware example.
//
// Refuses inbound requests with HTTP 451 ("Unavailable For Legal Reasons")
// when the data principal has not actively granted consent for the
// purpose. Honours the SDK's fail-CLOSED default — a 5xx / network /
// timeout from ConsentShield SHOULD result in a 503 from your service,
// NOT a silent default-grant.
//
// Usage:
//
//   import express from 'express'
//   import { ConsentShieldClient } from '@consentshield/node'
//   import { consentRequired } from './middleware'
//
//   const client = new ConsentShieldClient({ apiKey: process.env.CS_API_KEY! })
//
//   app.post(
//     '/api/marketing/send',
//     consentRequired(client, {
//       propertyId: process.env.CS_PROPERTY_ID!,
//       purposeCode: 'marketing',
//       identifierType: 'email',
//       getIdentifier: (req) => req.body.email,
//     }),
//     (req, res) => { /* send-marketing handler */ },
//   )

import type { NextFunction, Request, RequestHandler, Response } from 'express'
import {
  ConsentShieldApiError,
  ConsentVerifyError,
  isOpenFailure,
  type ConsentShieldClient,
  type IdentifierType,
} from '@consentshield/node'

export interface ConsentRequiredOptions {
  /** ConsentShield property the verify call is scoped to. */
  propertyId: string
  /** Purpose code being checked (e.g. 'marketing', 'analytics'). */
  purposeCode: string
  /** Identifier class — 'email' / 'phone' / 'pan' / 'aadhaar' / 'custom'. */
  identifierType: IdentifierType | string
  /** Pull the data-principal identifier off the request. Return null/undefined to short-circuit with a 400. */
  getIdentifier: (req: Request) => string | null | undefined
  /** Optional — propagate caller-side trace id (default: read req.headers['x-trace-id']). */
  getTraceId?: (req: Request) => string | null | undefined
}

export function consentRequired(
  client: ConsentShieldClient,
  opts: ConsentRequiredOptions,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = opts.getIdentifier(req)
    if (!identifier) {
      res.status(400).json({ error: 'Missing data-principal identifier on the request' })
      return
    }
    const traceIdHeader = opts.getTraceId
      ? opts.getTraceId(req)
      : (req.headers['x-trace-id'] as string | undefined)

    try {
      const result = await client.verify({
        propertyId: opts.propertyId,
        dataPrincipalIdentifier: identifier,
        identifierType: opts.identifierType,
        purposeCode: opts.purposeCode,
        traceId: traceIdHeader ?? undefined,
      })

      // failOpen=true callers get the open envelope; we honour the
      // override but propagate the trace + reason for downstream logs.
      if (isOpenFailure(result)) {
        res.setHeader('X-CS-Override', `${result.cause}:${result.reason}`)
        if (result.traceId) res.setHeader('X-CS-Trace-Id', result.traceId)
        next()
        return
      }

      if (result.traceId) res.setHeader('X-CS-Trace-Id', result.traceId)

      if (result.status !== 'granted') {
        res.status(451).json({
          error: 'consent_not_granted',
          status: result.status,
          property_id: result.property_id,
          purpose_code: result.purpose_code,
          evaluated_at: result.evaluated_at,
        })
        return
      }
      next()
    } catch (err) {
      // Fail-CLOSED default: ConsentVerifyError → 503 (service degraded).
      if (err instanceof ConsentVerifyError) {
        if (err.traceId) res.setHeader('X-CS-Trace-Id', err.traceId)
        res.status(503).json({ error: 'consent_verification_unavailable', traceId: err.traceId })
        return
      }
      // 4xx/auth/scope errors → bubble up as 502 with the trace id.
      if (err instanceof ConsentShieldApiError) {
        if (err.traceId) res.setHeader('X-CS-Trace-Id', err.traceId)
        res.status(502).json({ error: 'consent_check_failed', status: err.status, traceId: err.traceId })
        return
      }
      next(err)
    }
  }
}
