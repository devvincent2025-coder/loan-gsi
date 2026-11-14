import { randomInt, timingSafeEqual } from 'crypto';
import type { FieldCipher } from '../crypto/field-cipher';

/** 6-digit numeric code from a CSPRNG. */
export function generateOtp(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }

/**
 * Codes are stored ONLY as a keyed HMAC (the cipher's blind-index key), bound to the challenge id so a hash cannot be replayed
 * against another challenge. A 6-digit space is brute-forceable offline from a leaked hash, so the HMAC key is what protects it:
 * keep BLIND_INDEX_KEY secret, and rely on attempt limits for online guessing.
 */
export function hashOtp(cipher: FieldCipher, challengeId: string, code: string): string {
  return cipher.blindIndex(`${challengeId}:${code}`, 'otp');
}

/** Constant-time comparison of a submitted code with the stored hash. */
export function otpMatches(cipher: FieldCipher, challengeId: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(cipher, challengeId, code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pure expiry / attempt rules (the DB update enforces them atomically; this documents and unit-tests the policy). */
export function otpUsable(ch: { expiresAt: Date; consumedAt: Date | null; attempts: number }, maxAttempts: number, now = new Date()): 'OK' | 'EXPIRED' | 'USED' | 'LOCKED' {
  if (ch.consumedAt) return 'USED';
  if (ch.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (ch.attempts >= maxAttempts) return 'LOCKED';
  return 'OK';
}
