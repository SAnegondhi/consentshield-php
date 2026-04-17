import type { NextConfig } from 'next'

const NOINDEX_VALUE =
  'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai'

const nextConfig: NextConfig = {
  // Admin console is always private — X-Robots-Tag on every response,
  // covering API routes and any non-HTML body the <meta> tag in the
  // HTML <head> cannot reach.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: NOINDEX_VALUE }],
      },
    ]
  },
}

export default nextConfig
