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
}

export default nextConfig
