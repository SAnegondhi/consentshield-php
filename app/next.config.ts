import type { NextConfig } from 'next'

const NOINDEX_VALUE =
  'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai'

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

  // The host-scoped /v1/* → /api/v1/* rewrite lives in `app/src/proxy.ts`,
  // not here. On Vercel, middleware runs before `next.config.ts` rewrites
  // in practice (despite the Next.js docs claim that `beforeFiles` runs
  // first); putting the rewrite in middleware makes the order explicit
  // and avoids the platform-vs-docs mismatch.
}

export default nextConfig
