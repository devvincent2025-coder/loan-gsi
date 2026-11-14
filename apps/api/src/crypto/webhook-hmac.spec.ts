import { signHmacHex, verifyHmacHexSignature } from './webhook-signature';

describe('verifyHmacHexSignature', () => {
  const secret = 'whsec_test'; const body = Buffer.from('{"reference_id":"face_1"}');
  const good = signHmacHex(secret, body);
  it('accepts a correct signature (also upper-case and prefixed)', () => {
    expect(verifyHmacHexSignature({ secret, signature: good, rawBody: body }).ok).toBe(true);
    expect(verifyHmacHexSignature({ secret, signature: good.toUpperCase(), rawBody: body }).ok).toBe(true);
    expect(verifyHmacHexSignature({ secret, signature: `sha256=${good}`, rawBody: body }).ok).toBe(true);
  });
  it('rejects tampering, wrong secret, malformed and missing input', () => {
    expect(verifyHmacHexSignature({ secret, signature: good, rawBody: Buffer.from('{"reference_id":"face_2"}') }).ok).toBe(false);
    expect(verifyHmacHexSignature({ secret: 'other', signature: good, rawBody: body }).ok).toBe(false);
    expect(verifyHmacHexSignature({ secret, signature: 'zz', rawBody: body }).ok).toBe(false);
    expect(verifyHmacHexSignature({ secret, signature: good.slice(2), rawBody: body }).ok).toBe(false);
    expect(verifyHmacHexSignature({ secret, signature: undefined, rawBody: body }).ok).toBe(false);
    expect(verifyHmacHexSignature({ secret: undefined, signature: good, rawBody: body }).ok).toBe(false);
  });
});
