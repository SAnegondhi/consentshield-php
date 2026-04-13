// HMAC-SHA256 utilities — Web Crypto API only, zero dependencies

const encoder = new TextEncoder()

export async function hmacSHA256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return arrayBufferToHex(signature)
}

export async function verifyHMAC(
  orgId: string,
  propertyId: string,
  timestamp: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const message = `${orgId}${propertyId}${timestamp}`
  const expected = await hmacSHA256(message, secret)
  return timingSafeEqual(expected, signature)
}

export function isTimestampValid(timestamp: string, windowMs: number = 5 * 60 * 1000): boolean {
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return false
  const now = Date.now()
  return Math.abs(now - ts) <= windowMs
}

export async function sha256(input: string): Promise<string> {
  const data = encoder.encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return arrayBufferToHex(hash)
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
