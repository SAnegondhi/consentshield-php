// ADR-1006 Phase 1 Sprint 1.1 — error class hierarchy.

import { describe, it, expect } from 'vitest'
import {
  ConsentShieldError,
  ConsentShieldApiError,
  ConsentShieldNetworkError,
  ConsentShieldTimeoutError,
  ConsentVerifyError,
} from '../src/errors'

describe('ConsentShieldError hierarchy', () => {
  it('every subclass is instanceof ConsentShieldError', () => {
    const apiErr = new ConsentShieldApiError(500, undefined)
    const netErr = new ConsentShieldNetworkError('econnreset')
    const tmoErr = new ConsentShieldTimeoutError(2000)
    const vfyErr = new ConsentVerifyError(netErr)

    expect(apiErr).toBeInstanceOf(ConsentShieldError)
    expect(netErr).toBeInstanceOf(ConsentShieldError)
    expect(tmoErr).toBeInstanceOf(ConsentShieldError)
    expect(vfyErr).toBeInstanceOf(ConsentShieldError)
    // Native Error too — for `process.on('uncaughtException', ...)` / Sentry.
    expect(apiErr).toBeInstanceOf(Error)
  })

  it('every subclass exposes its concrete name', () => {
    expect(new ConsentShieldApiError(404, undefined).name).toBe('ConsentShieldApiError')
    expect(new ConsentShieldNetworkError('x').name).toBe('ConsentShieldNetworkError')
    expect(new ConsentShieldTimeoutError(1).name).toBe('ConsentShieldTimeoutError')
    expect(
      new ConsentVerifyError(new ConsentShieldNetworkError('y')).name,
    ).toBe('ConsentVerifyError')
  })

  it('ConsentShieldApiError.message includes status + detail', () => {
    const e = new ConsentShieldApiError(403, {
      type: 't',
      title: 'Forbidden',
      status: 403,
      detail: 'no scope',
    })
    expect(e.message).toContain('403')
    expect(e.message).toContain('no scope')
  })

  it('ConsentShieldApiError.message falls back to title when detail is empty or absent', () => {
    // Empty-string detail also falls back (RFC 7807 doesn't require detail).
    const empty = new ConsentShieldApiError(401, {
      type: 't',
      title: 'Unauthorized',
      status: 401,
      detail: '',
    })
    expect(empty.message).toContain('Unauthorized')
    expect(empty.message).toContain('401')

    // Undefined detail also falls back.
    const undef = new ConsentShieldApiError(401, {
      type: 't',
      title: 'Unauthorized',
      status: 401,
    } as unknown as never)
    expect(undef.message).toContain('Unauthorized')
  })

  it('ConsentShieldApiError.message falls back to "HTTP <status>" when problem is undefined', () => {
    const e = new ConsentShieldApiError(500, undefined)
    expect(e.message).toContain('HTTP 500')
  })

  it('traceId propagates from constructor onto the instance', () => {
    expect(
      new ConsentShieldApiError(500, undefined, 'trace-1').traceId,
    ).toBe('trace-1')
    expect(new ConsentShieldNetworkError('x', undefined, 'trace-2').traceId).toBe('trace-2')
    expect(new ConsentShieldTimeoutError(2000, 'trace-3').traceId).toBe('trace-3')
  })

  it('ConsentVerifyError carries the underlying cause + propagates its traceId', () => {
    const inner = new ConsentShieldNetworkError('econnreset', undefined, 'trace-deep')
    const wrap = new ConsentVerifyError(inner)
    expect(wrap.cause).toBe(inner)
    expect(wrap.traceId).toBe('trace-deep')
    expect(wrap.message).toContain('econnreset')
  })
})
