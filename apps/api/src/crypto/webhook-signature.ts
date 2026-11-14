import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Webhook signature helper (HMAC-SHA256 over `${timestamp}.${rawBody}`), constant-time compare,
 * timestamp tolerance to stop replay. Header convention:
 *   x-signature: sha256=<hex>      x-timestamp: <unix seconds>
 * Per-provider schemes (Paystack: x-paystack-signature = HMAC-SHA512 of body, etc.) can be added
 * as sibling functions in later prompts.
 */
export function signWebhook(secret: string, timestamp: number, rawBody: string | Buffer): string {
  const h = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `sha256=${h}`;
}

export interface VerifyWebhookArgs {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string | Buffer | undefined;
  toleranceSeconds?: number;
  now?: number;
}

export function verifyWebhookSignature(a: VerifyWebhookArgs): { ok: true } | { ok: false; reason: string } {
  if (!a.signature || !a.timestamp || a.rawBody === undefined) return { ok: false, reason: 'missing signature headers' };
  const ts = Number(a.timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: 'bad timestamp' };
  const now = a.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (a.toleranceSeconds ?? 300)) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = Buffer.from(signWebhook(a.secret, ts, a.rawBody));
  const given = Buffer.from(a.signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}

/** Hex HMAC over the raw body (no timestamp), used by providers such as Dojah (`x-dojah-signature`). */
export function signHmacHex(secret: string, rawBody: string | Buffer, algorithm: 'sha256' | 'sha512' = 'sha256'): string {
  return createHmac(algorithm, secret).update(rawBody).digest('hex');
}

/** Constant-time check of a hex HMAC signature. Tolerates an `sha256=` style prefix and upper-case hex. */
export function verifyHmacHexSignature(a: {
  secret: string | undefined;
  signature: string | undefined;
  rawBody: string | Buffer | undefined;
  algorithm?: 'sha256' | 'sha512';
}): { ok: true } | { ok: false; reason: string } {
  if (!a.secret) return { ok: false, reason: 'webhook secret not configured' };
  if (!a.signature || a.rawBody === undefined) return { ok: false, reason: 'missing signature or body' };
  const given = a.signature.trim().replace(/^sha(256|512)=/i, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(given)) return { ok: false, reason: 'malformed signature' };
  const expected = Buffer.from(signHmacHex(a.secret, a.rawBody, a.algorithm), 'hex');
  const got = Buffer.from(given, 'hex');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}
