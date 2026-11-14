import { randomBytes } from 'crypto';
import { FieldCipher } from '../crypto/field-cipher';
import { generateOtp, hashOtp, otpMatches, otpUsable } from './otp';

const cipher = new FieldCipher(`v1:${randomBytes(32).toString('base64')}`, 'v1', 'otp-test-blind-key-0123456789');

describe('otp', () => {
  it('generates 6 digits (including leading zeros)', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('stores only a keyed hash bound to the challenge id', () => {
    const h = hashOtp(cipher, 'ch-1', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(otpMatches(cipher, 'ch-1', '123456', h)).toBe(true);
    expect(otpMatches(cipher, 'ch-1', '123457', h)).toBe(false);
    expect(otpMatches(cipher, 'ch-2', '123456', h)).toBe(false); // not replayable on another challenge
    expect(otpMatches(cipher, 'ch-1', '123456', 'abcd')).toBe(false); // malformed hash: no throw
  });
  it('enforces expiry, single use and attempt limits', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const ok = { expiresAt: new Date(now.getTime() + 1000), consumedAt: null, attempts: 0 };
    expect(otpUsable(ok, 5, now)).toBe('OK');
    expect(otpUsable({ ...ok, expiresAt: new Date(now.getTime() - 1) }, 5, now)).toBe('EXPIRED');
    expect(otpUsable({ ...ok, consumedAt: now }, 5, now)).toBe('USED');
    expect(otpUsable({ ...ok, attempts: 5 }, 5, now)).toBe('LOCKED');
    expect(otpUsable({ ...ok, attempts: 4 }, 5, now)).toBe('OK');
  });
});
