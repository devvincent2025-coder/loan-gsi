/** Money is ALWAYS integer kobo. These helpers never use floating point for storage. */
export type Kobo = number | bigint | string;

export const KOBO_PER_NAIRA = 100;

export function toKoboBigInt(v: Kobo): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') return BigInt(v.trim() || '0');
  if (!Number.isInteger(v)) throw new Error(`Kobo must be an integer, got ${v}`);
  return BigInt(v);
}

/** "1,234.50" | "1234.5" | 1234.5 -> 123450 (integer kobo). Throws on >2 decimals. */
export function nairaToKobo(input: string | number): number {
  const s = String(input).replace(/[₦,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid naira amount: ${input}`);
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const kobo = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return neg ? -kobo : kobo;
}

export function koboToNairaNumber(v: Kobo): number {
  return Number(toKoboBigInt(v)) / 100;
}

export interface FormatNairaOptions {
  /** hide kobo when zero (default false) */
  trimZeroKobo?: boolean;
  /** 1.2M / 3.4B style */
  compact?: boolean;
  symbol?: string;
}

export function formatNaira(v: Kobo | null | undefined, opts: FormatNairaOptions = {}): string {
  if (v === null || v === undefined) return '—';
  const symbol = opts.symbol ?? '₦';
  const k = toKoboBigInt(v);
  const neg = k < 0n;
  const abs = neg ? -k : k;
  const sign = neg ? '-' : '';
  if (opts.compact) {
    const n = Number(abs) / 100;
    const units: [number, string][] = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];
    for (const [size, suffix] of units) {
      if (n >= size) {
        const val = n / size;
        return `${sign}${symbol}${val >= 100 ? val.toFixed(0) : val.toFixed(val >= 10 ? 1 : 2).replace(/\.?0+$/, '')}${suffix}`;
      }
    }
    return `${sign}${symbol}${Math.round(n).toLocaleString('en-NG')}`;
  }
  const whole = abs / 100n;
  const frac = Number(abs % 100n);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (opts.trimZeroKobo && frac === 0) return `${sign}${symbol}${wholeStr}`;
  return `${sign}${symbol}${wholeStr}.${frac.toString().padStart(2, '0')}`;
}
