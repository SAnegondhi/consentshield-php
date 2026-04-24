// ADR-1019 Sprint 1.2 — endpoint derivation tests.

import { describe, expect, it } from 'vitest'
import { endpointForProvider } from '@/lib/storage/endpoint'

describe('endpointForProvider', () => {
  it('derives cs_managed_r2 endpoint from CLOUDFLARE_ACCOUNT_ID', () => {
    const url = endpointForProvider('cs_managed_r2', null, {
      env: { CLOUDFLARE_ACCOUNT_ID: 'abc123' } as NodeJS.ProcessEnv,
    })
    expect(url).toBe('https://abc123.r2.cloudflarestorage.com')
  })

  it('throws for cs_managed_r2 when CLOUDFLARE_ACCOUNT_ID is unset', () => {
    expect(() =>
      endpointForProvider('cs_managed_r2', null, {
        env: {} as NodeJS.ProcessEnv,
      }),
    ).toThrow(/CLOUDFLARE_ACCOUNT_ID is not set/)
  })

  it('derives customer_s3 endpoint from region', () => {
    const url = endpointForProvider('customer_s3', 'ap-south-1', {
      env: {} as NodeJS.ProcessEnv,
    })
    expect(url).toBe('https://s3.ap-south-1.amazonaws.com')
  })

  it('defaults customer_s3 region to us-east-1 when null', () => {
    const url = endpointForProvider('customer_s3', null, {
      env: {} as NodeJS.ProcessEnv,
    })
    expect(url).toBe('https://s3.us-east-1.amazonaws.com')
  })

  it('defaults customer_s3 region to us-east-1 when empty string', () => {
    const url = endpointForProvider('customer_s3', '   ', {
      env: {} as NodeJS.ProcessEnv,
    })
    expect(url).toBe('https://s3.us-east-1.amazonaws.com')
  })

  it('throws for customer_r2 (BYOK R2 endpoint not yet supported)', () => {
    expect(() =>
      endpointForProvider('customer_r2', 'auto', {
        env: {} as NodeJS.ProcessEnv,
      }),
    ).toThrow(/cannot derive endpoint for provider='customer_r2'/)
  })

  it('throws for unknown provider string', () => {
    expect(() =>
      endpointForProvider('gcs' as 'cs_managed_r2', null, {
        env: { CLOUDFLARE_ACCOUNT_ID: 'x' } as NodeJS.ProcessEnv,
      }),
    ).toThrow(/cannot derive endpoint for provider='gcs'/)
  })

  it('reads from process.env by default when deps.env is omitted', () => {
    const prior = process.env.CLOUDFLARE_ACCOUNT_ID
    process.env.CLOUDFLARE_ACCOUNT_ID = 'from-process'
    try {
      expect(endpointForProvider('cs_managed_r2', null)).toBe(
        'https://from-process.r2.cloudflarestorage.com',
      )
    } finally {
      if (prior === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID
      else process.env.CLOUDFLARE_ACCOUNT_ID = prior
    }
  })
})
