// HS256 sign + verify using Web Crypto. ADR-0502 Sprint 1.1.
//
// Zero external dep — `crypto.subtle` is native to the Vercel Node and
// Edge runtimes. We hand-roll the JWT envelope rather than pull `jose`
// because the marketing project's dependency surface stays flat (CLAUDE
// rule 16 spirit).

import { webcrypto } from 'node:crypto'

const HEADER = { alg: 'HS256', typ: 'JWT' } as const
const HEADER_B64 = base64UrlEncode(JSON.stringify(HEADER))

export interface JwtPayload {
  // Standard claims we use.
  iat: number // issued-at (unix seconds)
  exp: number // expiry (unix seconds)
  // Caller-defined extras. Keep payloads small — cookies have a 4 KB ceiling.
  [key: string]: unknown
}

export async function sign(payload: JwtPayload, secret: string): Promise<string> {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${HEADER_B64}.${payloadB64}`
  const sig = await hmacSha256(signingInput, secret)
  return `${signingInput}.${sig}`
}

export async function verify<T extends JwtPayload = JwtPayload>(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<T> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new JwtError('malformed', 'expected three segments')
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string]
  if (headerB64 !== HEADER_B64) throw new JwtError('header_mismatch', 'unexpected header')
  const expected = await hmacSha256(`${headerB64}.${payloadB64}`, secret)
  if (!constantTimeEqual(expected, sigB64)) throw new JwtError('signature', 'signature mismatch')
  let payload: T
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as T
  } catch {
    throw new JwtError('malformed', 'payload not JSON')
  }
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new JwtError('expired', 'token past exp')
  }
  return payload
}

export class JwtError extends Error {
  constructor(public readonly code: 'malformed' | 'header_mismatch' | 'signature' | 'expired', msg: string) {
    super(msg)
    this.name = 'JwtError'
  }
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await webcrypto.subtle.sign('HMAC', key, encoder.encode(message))
  return base64UrlEncode(new Uint8Array(sigBuf))
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  // Buffer.from is faster than manual btoa loops; available in Node + Vercel runtimes.
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
