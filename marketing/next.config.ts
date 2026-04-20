import type { NextConfig } from 'next'

// Marketing site (consentshield.in) — the only public surface.
// Unlike admin/, no blanket `X-Robots-Tag: noindex` header.
// Security hardening (CSP / HSTS / etc.) lands in ADR-0501 Phase 4.
const nextConfig: NextConfig = {}

export default nextConfig
