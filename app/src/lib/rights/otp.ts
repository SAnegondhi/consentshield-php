// OTP utilities for rights request email verification
// Codes are 6-digit numeric, hashed with SHA-256 before storage.

import { createHash, randomInt } from 'node:crypto'

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export function otpExpiryIso(minutes: number = 15): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}
