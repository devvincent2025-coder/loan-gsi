import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * Field-level encryption for PII columns (BVN, NIN, account numbers, phone, TOTP secrets).
 * AES-256-GCM, versioned keys for rotation. Ciphertext format: `kid:iv:tag:ct` (base64url parts).
 * Blind index (HMAC-SHA256) allows exact-match lookups without decrypting.
 *
 * Key rotation: add a new key to ENCRYPTION_KEYS ("v1:…,v2:…"), set ENCRYPTION_ACTIVE_KEY=v2, deploy,
 * run `npm run rotate-keys -w @damez/api` (re-encrypts rows still on old keys), then retire v1.
 */
export class FieldCipher {
  private keys = new Map<string, Buffer>();

  constructor(
    keysSpec: string,
    private activeKid: string,
    private blindKey: string,
  ) {
    for (const part of keysSpec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const idx = part.indexOf(':');
      const kid = part.slice(0, idx);
      const key = Buffer.from(part.slice(idx + 1), 'base64');
      if (key.length !== 32) throw new Error(`Encryption key ${kid} must be 32 bytes (base64)`);
      this.keys.set(kid, key);
    }
    if (!this.keys.has(activeKid)) throw new Error(`Active encryption key ${activeKid} not found`);
  }

  get activeKeyId(): string {
    return this.activeKid;
  }

  encrypt(plain: string, aad = ''): string {
    const key = this.keys.get(this.activeKid)!;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    if (aad) c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    const tag = c.getAuthTag();
    return [this.activeKid, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
  }

  decrypt(payload: string, aad = ''): string {
    const [kid, iv, tag, ct] = payload.split(':');
    const key = this.keys.get(kid);
    if (!key || !iv || !tag || ct === undefined) throw new Error('Unknown key id or malformed ciphertext');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    if (aad) d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }

  needsRotation(payload: string): boolean {
    return payload.split(':')[0] !== this.activeKid;
  }

  rotate(payload: string, aad = ''): string {
    return this.needsRotation(payload) ? this.encrypt(this.decrypt(payload, aad), aad) : payload;
  }

  /** Deterministic keyed hash for equality lookups. `purpose` namespaces the index. */
  blindIndex(value: string, purpose: string): string {
    const normalised = value.trim().toLowerCase();
    return createHmac('sha256', this.blindKey).update(`${purpose}:${normalised}`).digest('hex');
  }
}
