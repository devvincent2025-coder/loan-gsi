import { randomBytes } from 'crypto';
import { FieldCipher } from '../crypto/field-cipher';
import { decryptDocument, encryptDocument } from './doc-crypto';
import { declaredMatches, sanitizeFileName, sniffMime } from './mime';
import { EICAR, MockVirusScanner } from './virus-scanner';

const cipher = new FieldCipher(`v1:${randomBytes(32).toString('base64')}`, 'v1', 'doc-test-blind-key-0123456789');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(32)]);

describe('document encryption', () => {
  it('round-trips with a per-file key bound to the document id', () => {
    const data = randomBytes(5000);
    const { blob, keyEnc } = encryptDocument(cipher, 'doc-1', data);
    expect(blob.includes(data.subarray(0, 64))).toBe(false);
    expect(decryptDocument(cipher, 'doc-1', keyEnc, blob).equals(data)).toBe(true);
    expect(() => decryptDocument(cipher, 'doc-2', keyEnc, blob)).toThrow();
    const tampered = Buffer.from(blob); tampered[tampered.length - 1] ^= 1;
    expect(() => decryptDocument(cipher, 'doc-1', keyEnc, tampered)).toThrow();
  });
  it('uses a different key per file', () => {
    const a = encryptDocument(cipher, 'd', Buffer.from('x')); const b = encryptDocument(cipher, 'd', Buffer.from('x'));
    expect(a.keyEnc).not.toBe(b.keyEnc);
  });
});

describe('sniffMime', () => {
  it('detects allowed types by magic bytes', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('date,amount,narration\n2026-01-01,5000,salary\n'))).toBe('text/csv');
  });
  it('rejects executables, scripts, html and binary junk even if the name says otherwise', () => {
    expect(sniffMime(Buffer.from('MZ\x90\x00\x03\x00\x00\x00'))).toBeNull();
    expect(sniffMime(Buffer.from('\x7fELF\x02\x01\x01'))).toBeNull();
    expect(sniffMime(Buffer.from('#!/bin/sh\necho hi, there'))).toBeNull();
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMime(Buffer.from([0, 1, 2, 3, 4, 5]))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
  it('checks the declared type against the sniffed one', () => {
    expect(declaredMatches('image/png', 'image/png')).toBe(true);
    expect(declaredMatches('application/pdf', 'image/png')).toBe(false);
    expect(declaredMatches('application/vnd.ms-excel', 'text/csv')).toBe(true);
    expect(declaredMatches(undefined, 'image/png')).toBe(true);
  });
  it('sanitises file names', () => {
    expect(sanitizeFileName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('my id <script>.png', 'image/png')).toBe('my id script.png');
    expect(sanitizeFileName(undefined, 'image/jpeg')).toBe('document.jpg');
    expect(sanitizeFileName('x'.repeat(300) + '.pdf', 'application/pdf').length).toBeLessThanOrEqual(84);
  });
});

describe('MockVirusScanner', () => {
  const s = new MockVirusScanner();
  it('flags EICAR and executables, errors on empty, passes clean files', async () => {
    expect((await s.scan(Buffer.from(`prefix ${EICAR} suffix`))).status).toBe('INFECTED');
    expect((await s.scan(Buffer.from('MZ\x90\x00'))).status).toBe('INFECTED');
    expect((await s.scan(Buffer.alloc(0))).status).toBe('ERROR');
    expect((await s.scan(PNG)).status).toBe('CLEAN');
  });
});
