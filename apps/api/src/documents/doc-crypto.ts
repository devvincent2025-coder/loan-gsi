import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { FieldCipher } from '../crypto/field-cipher';

/**
 * Envelope encryption for documents: a random 256-bit data key per file encrypts the bytes (AES-256-GCM, AAD `doc:<id>`);
 * the data key is itself wrapped with the FieldCipher (so key rotation re-wraps cheaply). Blob layout: iv(12) | tag(16) | ciphertext.
 */
export const docAad = (docId: string) => `doc:${docId}`;

export function encryptDocument(cipher: FieldCipher, docId: string, bytes: Buffer): { blob: Buffer; keyEnc: string } {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(docAad(docId)));
  const ct = Buffer.concat([c.update(bytes), c.final()]);
  return { blob: Buffer.concat([iv, c.getAuthTag(), ct]), keyEnc: cipher.encrypt(key.toString('base64'), docAad(docId)) };
}

export function decryptDocument(cipher: FieldCipher, docId: string, keyEnc: string, blob: Buffer): Buffer {
  const key = Buffer.from(cipher.decrypt(keyEnc, docAad(docId)), 'base64');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAAD(Buffer.from(docAad(docId)));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}
