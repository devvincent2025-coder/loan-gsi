import { Injectable } from '@nestjs/common';
import { FieldCipher } from '../crypto/field-cipher';

/** Canonical local format 0XXXXXXXXXX (what the blind index is computed over). Returns the input trimmed if it is not a Nigerian mobile. */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/[\s()-]/g, '');
  if (/^\+?234\d{10}$/.test(d)) return `0${d.replace(/^\+?234/, '')}`;
  return d;
}

/** Customer PII helpers: same AAD / blind-index conventions as CustomersService.encryptFields, but every field is optional. */
@Injectable()
export class CustomerPii {
  constructor(public readonly cipher: FieldCipher) {}

  aad(id: string, field: string): string { return `customer:${id}:${field}`; }
  enc(id: string, field: string, value: string): string { return this.cipher.encrypt(value, this.aad(id, field)); }
  dec(id: string, field: string, payload: string | null | undefined): string | null {
    if (!payload) return null;
    try { return this.cipher.decrypt(payload, this.aad(id, field)); } catch { return null; }
  }
  hash(value: string, purpose: 'phone' | 'bvn' | 'nin' | 'email' | 'account'): string { return this.cipher.blindIndex(value, purpose); }
  phoneHash(raw: string): string { return this.hash(normalizePhone(raw), 'phone'); }
}
