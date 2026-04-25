import type { NextConfig } from 'next'

const NOINDEX_VALUE =
  'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai'

const API_HOST = 'api.consentshield.in'

const nextConfig: NextConfig = {
  // Pre-launch: every response carries X-Robots-Tag to cover non-HTML
  // responses (API routes, JSON, files) that bypass the <meta> tag in
  // the HTML <head>.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: NOINDEX_VALUE }],
      },
    ]
  },

  // Host-scoped rewrites so api.consentshield.in serves the public API
  // surface without the customer-app's /api/* path prefix. Customers
  // (and the SDKs) call api.consentshield.in/v1/* and
  // api.consentshield.in/_ping; the App Router routes still live at
  // /api/v1/* on disk.
  //
  // beforeFiles runs BEFORE middleware, so by the time `proxy.ts` sees
  // the request, the path has already been normalised to /api/v1/* and
  // the existing Bearer-gate logic applies unchanged.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/v1/:path*',
          has: [{ type: 'host', value: API_HOST }],
          destination: '/api/v1/:path*',
        },
        {
          source: '/_ping',
          has: [{ type: 'host', value: API_HOST }],
          destination: '/api/v1/_ping',
        },
      ],
    }
  },
}

export default nextConfig
