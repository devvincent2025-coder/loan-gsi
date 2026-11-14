import { BankStatementAnalyzer, MonthlyPoint, StatementAnalysis, StatementParseError } from './statement-types';

/**
 * REAL offline bank-statement parser. Accepts CSV with date, description, debit, credit, balance columns
 * (header names vary by bank; amounts may carry ₦/NGN/commas; dates dd/mm/yyyy, dd-MMM-yyyy or ISO).
 * Any malformed data row rejects the whole file rather than silently under-counting income.
 */

const GAMBLING = /bet9ja|sportybet|nairabet|1xbet|betking|bet365|merrybet|betway|supabets|lottery/i;
const SALARY = /\b(salary|payroll|sal)\b/i;
const NON_INCOME = /\b(reversal|reversed|rvsl|refund(ed)?|chargeback|failed|unsuccessful|returned)\b/i;
const SELF_TRANSFER = /\b(self\s*transfer|transfer\s*(to|from)\s*self|own\s*(account|acct)|between\s*own|to\s*self|from\s*self|savings\s*(transfer|top.?up))\b/i;
const MAX_ROWS = 50_000;

const HEADERS = {
  date: ['date', 'transaction date', 'trans date', 'trans. date', 'txn date', 'value date', 'posting date', 'tran date'],
  description: ['description', 'narration', 'details', 'remarks', 'particulars', 'transaction details', 'narrative', 'transaction description'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'dr', 'debit amount', 'paid out'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'cr', 'credit amount', 'paid in'],
  balance: ['balance', 'running balance', 'closing balance', 'available balance', 'bal'],
} as const;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** RFC-4180-ish: quoted fields, doubled quotes, commas inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      rows.push(row); row = [];
    } else cur += c;
  }
  if (q) throw new StatementParseError('Unterminated quoted field');
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 .]/g, ' ').replace(/\s+/g, ' ').trim();

/** "₦1,234.50", "NGN 1234", "(500.00)", "-12.5", "1,000 Cr" → integer kobo; blank / "-" → 0. */
export function parseKobo(raw: string | undefined): number {
  if (raw === undefined) return 0;
  let s = raw.trim();
  if (s === '' || s === '-' || s === '--') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bdr\b\.?$/i.test(s)) { neg = true; s = s.replace(/\bdr\b\.?$/i, ''); }
  s = s.replace(/\bcr\b\.?$/i, '').replace(/₦|NGN|N(?=\d)/gi, '').replace(/[,\s]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new StatementParseError(`Invalid amount "${raw}"`);
  const [w, f = ''] = s.split('.');
  const kobo = Number(w) * 100 + Math.round(Number(`0.${f}`) * 100);
  return neg ? -kobo : kobo;
}

/** → UTC date at midnight; null when unparseable. */
export function parseStatementDate(raw: string): Date | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?$/i, '').replace(/T.*$/, '');
  let y: number; let m: number; let d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) { d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000; }
  else if ((r = /^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2,4})$/.exec(s))) {
    const mm = MONTHS[r[2].slice(0, 4).toLowerCase()] ?? MONTHS[r[2].slice(0, 3).toLowerCase()];
    if (!mm) return null;
    d = +r[1]; m = mm; y = +r[3]; if (y < 100) y += 2000;
  } else return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

interface Txn { date: Date; desc: string; debit: number; credit: number; balance: number | null; idx: number }

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

export class CsvStatementAnalyzer implements BankStatementAnalyzer {
  analyze(content: Buffer | string): StatementAnalysis {
    const text = typeof content === 'string' ? content : content.toString('utf8');
    if (text.includes('\u0000')) throw new StatementParseError('File is not a text CSV');
    const rows = parseCsv(text);
    const txns = this.toTransactions(rows);
    return this.compute(txns);
  }

  private toTransactions(rows: string[][]): Txn[] {
    // locate the header row (banks put preambles above it)
    let hi = -1;
    let col: Record<keyof typeof HEADERS, number> = { date: -1, description: -1, debit: -1, credit: -1, balance: -1 };
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const cells = rows[i].map(norm);
      const find = (names: readonly string[]) => cells.findIndex((c) => names.includes(c));
      const c = { date: find(HEADERS.date), description: find(HEADERS.description), debit: find(HEADERS.debit), credit: find(HEADERS.credit), balance: find(HEADERS.balance) };
      if (c.date >= 0 && (c.debit >= 0 || c.credit >= 0) ) { hi = i; col = c; break; }
    }
    if (hi < 0) throw new StatementParseError('Could not find a header row with a date and debit/credit columns');
    if (col.debit < 0 && col.credit < 0) throw new StatementParseError('Statement needs debit and/or credit columns');
    const out: Txn[] = [];
    const data = rows.slice(hi + 1);
    if (data.length > MAX_ROWS) throw new StatementParseError(`Statement has more than ${MAX_ROWS} rows`);
    data.forEach((cells, i) => {
      const rowNo = hi + 2 + i;
      const get = (c: number) => (c >= 0 ? (cells[c] ?? '') : '');
      const dateRaw = get(col.date).trim();
      const debitRaw = get(col.debit); const creditRaw = get(col.credit);
      if (dateRaw === '' && debitRaw.trim() === '' && creditRaw.trim() === '') return; // totals / blank footers
      const date = parseStatementDate(dateRaw);
      if (!date) throw new StatementParseError(`Invalid date "${dateRaw}"`, rowNo);
      let debit: number; let credit: number; let balance: number | null = null;
      try {
        debit = Math.abs(parseKobo(debitRaw));
        credit = Math.abs(parseKobo(creditRaw));
        if (col.balance >= 0 && get(col.balance).trim() !== '') balance = parseKobo(get(col.balance));
      } catch (e) { throw new StatementParseError((e as Error).message, rowNo); }
      if (debit > 0 && credit > 0) throw new StatementParseError('Row has both a debit and a credit', rowNo);
      out.push({ date, desc: get(col.description).trim(), debit, credit, balance, idx: out.length });
    });
    if (!out.length) throw new StatementParseError('Statement has no transactions');
    return out;
  }

  private compute(input: Txn[]): StatementAnalysis {
    // newest-first statements are reversed so running balances read chronologically
    let txns = input;
    if (txns.length > 1 && txns[0].date.getTime() > txns[txns.length - 1].date.getTime()) txns = [...txns].reverse().map((t, i) => ({ ...t, idx: i }));
    txns = [...txns].sort((a, b) => a.date.getTime() - b.date.getTime() || a.idx - b.idx);

    const first = monthIndex(txns[0].date);
    const last = monthIndex(txns[txns.length - 1].date);
    const periodMonths = last - first + 1;
    const monthly: MonthlyPoint[] = [];
    for (let m = first; m <= last; m++) monthly.push({ month: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`, inflowKobo: 0, outflowKobo: 0, closingBalanceKobo: null });
    const at = (d: Date) => monthly[monthIndex(d) - first];

    let gambling = false;
    let overdraft = false;
    const income: Txn[] = [];
    for (const t of txns) {
      const p = at(t.date);
      p.outflowKobo += t.debit;
      if (t.balance !== null) { p.closingBalanceKobo = t.balance; if (t.balance < 0) overdraft = true; }
      if (GAMBLING.test(t.desc)) gambling = true;
      if (t.credit > 0 && !NON_INCOME.test(t.desc) && !SELF_TRANSFER.test(t.desc)) { p.inflowKobo += t.credit; income.push(t); }
    }

    const inflows = monthly.map((m) => m.inflowKobo);
    const mean = inflows.reduce((s, v) => s + v, 0) / periodMonths;
    const variance = inflows.reduce((s, v) => s + (v - mean) ** 2, 0) / periodMonths;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    const closings = monthly.map((m) => m.closingBalanceKobo).filter((v): v is number => v !== null);
    const avgBalance = closings.length ? Math.round(closings.reduce((s, v) => s + v, 0) / closings.length) : 0;
    const sal = this.detectSalary(income);

    return {
      periodMonths,
      avgMonthlyInflowKobo: Math.round(mean),
      inflowStability: Math.round(Math.max(0, Math.min(1, 1 - cv)) * 100),
      avgBalanceKobo: avgBalance,
      gamblingFlag: gambling, overdraftFlag: overdraft,
      salaryDetected: sal.detected, salaryDay: sal.day, monthly,
    };
  }

  /** (a) narration says salary/payroll in ≥2 months, or (b) similar-amount credits (±10%) on a stable day (±3) in ≥3 months. */
  private detectSalary(income: Txn[]): { detected: boolean; day: number | null } {
    const byNarration = income.filter((t) => SALARY.test(t.desc));
    const narrMonths = new Set(byNarration.map((t) => ym(t.date)));
    if (narrMonths.size >= 2) return { detected: true, day: median(byNarration.map((t) => t.date.getUTCDate())) };
    let best: Txn[] = [];
    for (const anchor of income) {
      const group = new Map<string, Txn>();
      for (const t of income) {
        if (Math.abs(t.credit - anchor.credit) <= anchor.credit * 0.1 && Math.abs(t.date.getUTCDate() - anchor.date.getUTCDate()) <= 3) {
          const key = ym(t.date);
          if (!group.has(key)) group.set(key, t);
        }
      }
      if (group.size > best.length) best = [...group.values()];
    }
    if (best.length >= 3) return { detected: true, day: median(best.map((t) => t.date.getUTCDate())) };
    return { detected: false, day: null };
  }
}
