import type { MetadataRoute } from 'next'

// Marketing site — fully crawlable. Contrast with admin/src/app/robots.ts,
// which blocks every crawler site-wide.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: 'https://consentshield.in/sitemap.xml',
  }
}
