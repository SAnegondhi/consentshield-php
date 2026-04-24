import type { NextConfig } from 'next'

// ADR-1014 Sprint 5.3 — testing.consentshield.in.
//
// This is a dedicated Vercel project, deliberately isolated from the
// marketing / app / admin deploys. Outages here don't affect the
// customer-facing surface, and outages there don't hide run evidence.
//
// The site is fully static — every route prerenders at build time from
// src/data/runs.ts. No runtime data source, no ambient cloud reads,
// nothing that can go wrong at request time.

const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'"
    ].join('; ')
  }
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS
      }
    ]
  }
}

export default nextConfig
