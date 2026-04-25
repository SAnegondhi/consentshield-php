// 6-digit OTP generation + salted SHA-256 hash + constant-time compare.
// ADR-0502 Sprint 1.1.

import { randomInt, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface HashedOtp {
  hash: string // hex(sha256(salt || otp))
  salt: string // hex(16 bytes)
}

/** 6 numeric digits; biased-free uniform draw via crypto.randomInt. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function hashOtp(otp: string, saltHex?: string): HashedOtp {
  const salt = saltHex ?? randomBytes(16).toString('hex')
  const hash = createHash('sha256').update(salt + otp).digest('hex')
  return { hash, salt }
}

/** Constant-time compare of two hex digests. */
export function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
