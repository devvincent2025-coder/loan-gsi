import { describe, expect, it } from 'vitest';
import { Redactor } from './redact';
import { formatNaira, nairaToKobo } from './money';
import { maskPhone } from './mask';

describe('Redactor', () => {
  it('scrubs sensitive keys and free-text patterns', () => {
    const r = new Redactor();
    const out = r.redact({
      bvn: '22123456789',
      msg: 'Call 08031234567 or a@b.com acct 0123456789 nin 12345678901',
      nested: { password: 'x', ok: 'fine' },
    });
    expect(out.bvn).toBe('[REDACTED]');
    expect(out.nested.password).toBe('[REDACTED]');
    expect(out.nested.ok).toBe('fine');
    expect(out.msg).toBe('Call [PHONE] or [EMAIL] acct [ACCT10] nin [ID11]');
  });
  it('scrubs known names and +234 phones', () => {
    const r = new Redactor();
    r.addKnownValues(['Chidinma Okafor']);
    expect(r.scrubString('Hi Chidinma Okafor +2348051234567')).toBe('Hi [NAME] [PHONE]');
  });
  it('handles circular refs and errors', () => {
    const r = new Redactor();
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(r.redact(a).self).toBe('[CIRCULAR]');
    expect((r.redact(new Error('boom 08031234567')) as { message: string }).message).toBe('boom [PHONE]');
  });
});

describe('money', () => {
  it('formats naira from kobo', () => {
    expect(formatNaira(123456789)).toBe('₦1,234,567.89');
    expect(formatNaira(5_000_000n)).toBe('₦50,000.00');
    expect(formatNaira(-150)).toBe('-₦1.50');
    expect(formatNaira(250_000_000_00, { compact: true })).toBe('₦250M');
    expect(formatNaira(null)).toBe('—');
  });
  it('parses naira to integer kobo without float error', () => {
    expect(nairaToKobo('1,234.50')).toBe(123450);
    expect(() => nairaToKobo(0.1 + 0.2)).toThrow();
    expect(nairaToKobo('19.99')).toBe(1999);
    expect(() => nairaToKobo('1.234')).toThrow();
  });
  it('masks phones', () => {
    expect(maskPhone('08031234567')).toBe('0803•••4567');
  });
});
