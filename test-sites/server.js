// ADR-1014 Sprint 2.1 — tiny dependency-free static server for the demo
// sites. Runs on Railway (or locally) with PORT from env. Serves index.html
// for bare directory requests. Hardened for public exposure: noindex +
// no-ai-training headers on every response, plus a /robots.txt that denies
// every UA including the major AI model-training crawlers.
//
// Per-vertical isolation (Sprint 2.2 follow-up): when VERTICAL is set, the
// server only serves files under /<VERTICAL>/, plus the always-allowed
// shared/, .well-known/, robots.txt, favicon.ico. Anything else 404s. That
// way one Railway service per vertical cannot leak sibling-vertical content.
// With VERTICAL unset (local dev), the full tree is served.
//
// No npm deps (per repo Rule 15 / zero-deps preference).

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = __dirname
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '0.0.0.0'
const VERTICAL = (process.env.VERTICAL ?? '').trim() || null

// Top-level paths served regardless of VERTICAL — shared banner loader,
// robots.txt deny list, RFC 9116 security contact, favicon.
const ALWAYS_ALLOW_PREFIX = ['/shared/', '/.well-known/']
const ALWAYS_ALLOW_EXACT = ['/robots.txt', '/favicon.ico']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
}

// Headers applied to EVERY response — 200s, 404s, redirects. The
// X-Robots-Tag covers every well-behaved crawler (search + AI), including
// ones that ignore robots.txt but honour HTTP headers. The directive list
// is deliberately exhaustive (noindex, nofollow, noarchive, nosnippet,
// noimageindex, notranslate, noai, noimageai).
const SECURITY_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'interest-cohort=(), browsing-topics=(), geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // CORS stays open so the banner can post from these pages. ConsentShield
  // Worker is the only sensitive destination and does its own origin check.
  'Access-Control-Allow-Origin': '*'
}

function applyHeaders(res, extras = {}) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v)
  for (const [k, v] of Object.entries(extras)) res.setHeader(k, v)
}

function isVerticalPathAllowed(pathname) {
  if (!VERTICAL) return true
  if (pathname === '/') return true
  if (pathname === `/${VERTICAL}` || pathname.startsWith(`/${VERTICAL}/`)) return true
  if (ALWAYS_ALLOW_EXACT.includes(pathname)) return true
  for (const p of ALWAYS_ALLOW_PREFIX) if (pathname.startsWith(p)) return true
  return false
}

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent((req.url || '/').split('?')[0])
  const safe = path.posix.normalize(rawPath).replace(/^(\.\.(\/|$))+/, '/')

  // Per-vertical isolation: when VERTICAL is set, redirect bare `/` to the
  // vertical's index and 404 any path outside the vertical + shared tree.
  if (VERTICAL && safe === '/') {
    applyHeaders(res, { Location: `/${VERTICAL}/` })
    res.writeHead(302)
    res.end()
    return
  }
  if (!isVerticalPathAllowed(safe)) {
    applyHeaders(res, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.writeHead(404)
    res.end('Not found')
    return
  }

  let target = path.join(ROOT, safe.endsWith('/') ? safe + 'index.html' : safe)

  try {
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      applyHeaders(res, {
        Location: rawPath.endsWith('/') ? rawPath + 'index.html' : rawPath + '/'
      })
      res.writeHead(301)
      res.end()
      return
    }
    const body = fs.readFileSync(target)
    const mime = MIME[path.extname(target)] || 'application/octet-stream'
    applyHeaders(res, {
      'Content-Type': mime,
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=60'
    })
    res.writeHead(200)
    res.end(body)
  } catch {
    applyHeaders(res, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(PORT, HOST, () => {
  console.log(`consentshield test-sites listening on http://${HOST}:${PORT}`)
  console.log('  hardened: X-Robots-Tag noindex + AI-bot deny + HSTS + no-referrer')
  if (VERTICAL) console.log(`  vertical-lock: serving only /${VERTICAL}/ + shared assets (VERTICAL=${VERTICAL})`)
  else console.log('  vertical-lock: disabled (no VERTICAL env set) — full demo tree served')
})
