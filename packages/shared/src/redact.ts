/**
 * PII redaction layer. Used by logging, error-tracking hooks and analytics events.
 * Two mechanisms:
 *  1. key-based: any value under a sensitive key is replaced wholesale
 *  2. pattern-based: free text is scrubbed for emails, phones, BVN/NIN (11 digits), NUBAN (10 digits)
 * Plus a registry of "known values" (e.g. a customer's name loaded for the current request).
 */
const SENSITIVE_KEYS = new Set([
  'bvn', 'nin', 'nuban', 'accountnumber', 'accountno', 'acctnumber', 'phone', 'phonenumber',
  'msisdn', 'mobile', 'email', 'emailaddress', 'password', 'passwordhash', 'newpassword',
  'currentpassword', 'otp', 'totp', 'totpsecret', 'secret', 'authorization', 'cookie', 'setcookie',
  'firstname', 'lastname', 'middlename', 'fullname', 'accountname', 'mothermaidenname', 'dob',
  'dateofbirth', 'address', 'homeaddress', 'cardnumber', 'pan', 'cvv', 'pin', 'selfie', 'signature',
]);
const SENSITIVE_KEY_FRAGMENTS = ['password', 'secret', 'token', 'apikey', 'authorization', 'privatekey'];

const PATTERNS: Array<{ re: RegExp; repl: string }> = [
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, repl: '[EMAIL]' },
  { re: /(?<![\d.])(?:\+?234|0)[789][01]\d{8}(?!\d)/g, repl: '[PHONE]' },
  { re: /(?<![\d.])\d{11}(?!\d)/g, repl: '[ID11]' },
  { re: /(?<![\d.])\d{10}(?!\d)/g, repl: '[ACCT10]' },
];

const REDACTED = '[REDACTED]';

function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(k: string): boolean {
  const n = normaliseKey(k);
  if (SENSITIVE_KEYS.has(n)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((f) => n.includes(f));
}

export class Redactor {
  private known = new Set<string>();

  /** Register literal values (names etc.) to scrub from free text, e.g. for the current request. */
  addKnownValues(values: Array<string | null | undefined>): void {
    for (const v of values) if (v && v.trim().length >= 3) this.known.add(v.trim());
  }
  clearKnownValues(): void {
    this.known.clear();
  }

  scrubString(input: string): string {
    let out = input;
    for (const v of this.known) {
      out = out.split(v).join('[NAME]');
    }
    for (const { re, repl } of PATTERNS) out = out.replace(re, repl);
    return out;
  }

  redact<T>(value: T, depth = 0): T {
    return this.walk(value, depth, new WeakSet()) as T;
  }

  private walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return this.scrubString(value);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object') return value;
    if (value instanceof Date) return value;
    if (depth > 8) return '[DEPTH_LIMIT]';
    if (seen.has(value as object)) return '[CIRCULAR]';
    seen.add(value as object);
    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.scrubString(value.message),
        stack: value.stack ? this.scrubString(value.stack) : undefined,
      };
    }
    if (Array.isArray(value)) return value.map((v) => this.walk(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) && v !== null && v !== undefined ? REDACTED : this.walk(v, depth + 1, seen);
    }
    return out;
  }
}

export const defaultRedactor = new Redactor();
export const redact = <T>(v: T): T => defaultRedactor.redact(v);
