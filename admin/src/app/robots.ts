import type { MetadataRoute } from 'next'

// Admin console is always private — never indexed, never ingested by AI.
//
// Layered with:
//   - <meta name="robots" content="noindex, ..., noai, noimageai"> (layout.tsx)
//   - X-Robots-Tag HTTP header (next.config.ts)
//   - Future: Cloudflare Access gate on admin.consentshield.in

const AI_AND_SEARCH_BOTS = [
  'Googlebot',
  'Google-Extended',
  'Googlebot-Image',
  'Googlebot-News',
  'Bingbot',
  'Slurp',
  'DuckDuckBot',
  'Baiduspider',
  'YandexBot',
  'Sogou',
  'Applebot',
  'Applebot-Extended',
  'Amazonbot',
  'FacebookBot',
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'anthropic-ai',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Perplexity-User',
  'Bytespider',
  'CCBot',
  'Diffbot',
  'Omgilibot',
  'FriendlyCrawler',
  'cohere-ai',
  'YouBot',
  'ImagesiftBot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', disallow: '/' },
      ...AI_AND_SEARCH_BOTS.map((userAgent) => ({
        userAgent,
        disallow: '/',
      })),
    ],
  }
}
