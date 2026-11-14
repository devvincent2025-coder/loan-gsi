import { FieldCipher } from './field-cipher';
import { signWebhook, verifyWebhookSignature } from './webhook-signature';
import { randomBytes } from 'crypto';

const k = (n: number) => randomBytes(32).toString('base64') + n * 0;

describe('FieldCipher', () => {
  const k1 = k(1); const k2 = k(2);
  it('round-trips, binds AAD and supports key rotation', () => {
    const c1 = new FieldCipher(`v1:${k1}`, 'v1', 'blind-key-blind-key-1');
    const ct = c1.encrypt('22123456789', 'customer:1:bvn');
    expect(ct).not.toContain('22123456789');
    expect(c1.decrypt(ct, 'customer:1:bvn')).toBe('22123456789');
    expect(() => c1.decrypt(ct, 'customer:2:bvn')).toThrow();
    const c2 = new FieldCipher(`v1:${k1},v2:${k2}`, 'v2', 'blind-key-blind-key-1');
    expect(c2.needsRotation(ct)).toBe(true);
    const rotated = c2.rotate(ct, 'customer:1:bvn');
    expect(rotated.startsWith('v2:')).toBe(true);
    expect(c2.decrypt(rotated, 'customer:1:bvn')).toBe('22123456789');
  });
  it('blind index is deterministic and keyed', () => {
    const a = new FieldCipher(`v1:${k1}`, 'v1', 'blind-key-blind-key-1');
    const b = new FieldCipher(`v1:${k1}`, 'v1', 'another-blind-key-xxxx');
    expect(a.blindIndex('08031234567', 'phone')).toBe(a.blindIndex('08031234567', 'phone'));
    expect(a.blindIndex('08031234567', 'phone')).not.toBe(b.blindIndex('08031234567', 'phone'));
  });
});

describe('webhook signature', () => {
  const body = '{"event":"charge.success"}';
  it('accepts a valid signature and rejects tampering/replay', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhook('s3cret', ts, body);
    expect(verifyWebhookSignature({ secret: 's3cret', signature: sig, timestamp: String(ts), rawBody: body }).ok).toBe(true);
    expect(verifyWebhookSignature({ secret: 's3cret', signature: sig, timestamp: String(ts), rawBody: body + ' ' }).ok).toBe(false);
    expect(verifyWebhookSignature({ secret: 'other', signature: sig, timestamp: String(ts), rawBody: body }).ok).toBe(false);
    const old = ts - 3600;
    expect(verifyWebhookSignature({ secret: 's3cret', signature: signWebhook('s3cret', old, body), timestamp: String(old), rawBody: body }).ok).toBe(false);
  });
});
