import { ALLOWED_UPLOAD_MIME } from '@damez/shared';

export type AllowedMime = (typeof ALLOWED_UPLOAD_MIME)[number];

/**
 * Detect the real type from the first bytes (the client-sent Content-Type is never trusted).
 * Returns null for anything unrecognised or executable.
 */
export function sniffMime(b: Buffer): AllowedMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (looksLikeCsv(b)) return 'text/csv';
  return null;
}

function looksLikeCsv(b: Buffer): boolean {
  if (b.length === 0) return false;
  const sample = b.subarray(0, 4096);
  for (const byte of sample) if (byte === 0 || (byte < 9) || (byte > 13 && byte < 32)) return false; // binary
  const text = sample.toString('utf8');
  if (text.includes('�')) return false;
  if (/^\s*(<\s*(!doctype|html|script|\?xml)|#!|MZ)/i.test(text)) return false;
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.length >= 1 && /[,;\t]/.test(lines[0]);
}

/** Declared types that are acceptable aliases of a sniffed type (browsers differ on CSV). */
export function declaredMatches(declared: string | undefined, sniffed: AllowedMime): boolean {
  if (!declared) return true;
  const d = declared.toLowerCase().split(';')[0].trim();
  if (d === 'application/octet-stream') return true;
  if (sniffed === 'text/csv') return ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv'].includes(d);
  return d === sniffed || (sniffed === 'image/jpeg' && d === 'image/jpg');
}

/** Strip paths/control characters, keep a conservative character set, cap the length, keep the extension. */
export function sanitizeFileName(name: string | undefined, mime: AllowedMime): string {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'text/csv': 'csv' }[mime];
  const base = (name ?? 'document').split(/[\\/]/).pop() ?? 'document';
  const stem = base.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^\w\s.()-]/g, '').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 80);
  return `${stem || 'document'}.${ext}`;
}
