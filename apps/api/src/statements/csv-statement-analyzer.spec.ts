import { CsvStatementAnalyzer, parseKobo, parseStatementDate } from './csv-statement-analyzer';
import { StatementParseError } from './statement-types';

const a = new CsvStatementAnalyzer();
const HEAD = 'Date,Description,Debit,Credit,Balance';
const csv = (...rows: string[]) => [HEAD, ...rows].join('\n');

/** 6 months of ₦250,000 salary on the 25th + some spending. */
const salaryRows = () => {
  const rows: string[] = [];
  let bal = 50_000;
  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, '0');
    bal += 250_000; rows.push(`25/${mm}/2026,SALARY PAYMENT ACME LTD,,"250,000.00","${bal.toLocaleString('en-US')}.00"`);
    bal -= 90_000; rows.push(`28/${mm}/2026,POS PURCHASE,"90,000.00",,"${bal.toLocaleString('en-US')}.00"`);
  }
  return rows;
};

describe('parsing helpers', () => {
  it('parses naira amounts', () => {
    expect(parseKobo('₦1,234.50')).toBe(123_450);
    expect(parseKobo('NGN 2,000')).toBe(200_000);
    expect(parseKobo('(500.00)')).toBe(-50_000);
    expect(parseKobo('-12.5')).toBe(-1_250);
    expect(parseKobo('')).toBe(0);
    expect(parseKobo('-')).toBe(0);
    expect(parseKobo('1,000.00 Cr')).toBe(100_000);
    expect(() => parseKobo('abc')).toThrow(StatementParseError);
  });
  it('parses Nigerian date formats', () => {
    const iso = (d: Date | null) => d?.toISOString().slice(0, 10);
    expect(iso(parseStatementDate('25/03/2026'))).toBe('2026-03-25');
    expect(iso(parseStatementDate('25-Mar-2026'))).toBe('2026-03-25');
    expect(iso(parseStatementDate('5 Sept 2026'))).toBe('2026-09-05');
    expect(iso(parseStatementDate('2026-03-25'))).toBe('2026-03-25');
    expect(iso(parseStatementDate('2026-03-25T10:11:12Z'))).toBe('2026-03-25');
    expect(iso(parseStatementDate('25/03/2026 14:05:00'))).toBe('2026-03-25');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('hello')).toBeNull();
  });
});

describe('CsvStatementAnalyzer', () => {
  it('analyses a salaried 6-month statement', () => {
    const r = a.analyze(csv(...salaryRows()));
    expect(r.periodMonths).toBe(6);
    expect(r.avgMonthlyInflowKobo).toBe(25_000_000);
    expect(r.inflowStability).toBe(100);
    expect(r.salaryDetected).toBe(true);
    expect(r.salaryDay).toBe(25);
    expect(r.gamblingFlag).toBe(false);
    expect(r.overdraftFlag).toBe(false);
    expect(r.monthly).toHaveLength(6);
    expect(r.monthly[0]).toMatchObject({ month: '2026-01', inflowKobo: 25_000_000, outflowKobo: 9_000_000 });
    expect(r.avgBalanceKobo).toBeGreaterThan(0);
  });

  it('flags gambling by narration keyword', () => {
    const r = a.analyze(csv('01/01/2026,Transfer to BET9JA wallet,"5,000.00",,"95,000.00"', '02/01/2026,Deposit,,"100,000.00","195,000.00"'));
    expect(r.gamblingFlag).toBe(true);
    for (const k of ['sportybet', 'nairabet', '1xbet', 'betking', 'bet365', 'merrybet', 'betway', 'supabets', 'lottery']) {
      expect(a.analyze(csv(`01/01/2026,POS ${k.toUpperCase()},"1,000.00",,"9,000.00"`)).gamblingFlag).toBe(true);
    }
  });

  it('flags overdraft from a negative running balance', () => {
    const r = a.analyze(csv('01/01/2026,Credit,,"10,000.00","10,000.00"', '02/01/2026,ATM,"25,000.00",,"-15,000.00"'));
    expect(r.overdraftFlag).toBe(true);
    expect(a.analyze(csv('01/01/2026,Credit,,"10,000.00","(2,000.00)"')).overdraftFlag).toBe(true);
  });

  it('excludes reversals and self-transfers from inflow', () => {
    const r = a.analyze(csv(
      '01/01/2026,Transfer from John,,"50,000.00","50,000.00"',
      '02/01/2026,REVERSAL of failed txn,,"20,000.00","70,000.00"',
      '03/01/2026,Transfer from own account,,"30,000.00","100,000.00"',
      '04/01/2026,Refund POS,,"10,000.00","110,000.00"',
    ));
    expect(r.avgMonthlyInflowKobo).toBe(5_000_000);
  });

  it('inflow stability falls with volatile inflows', () => {
    const rows = [1, 2, 3, 4].map((m, i) => `10/0${m}/2026,Transfer,,"${[300_000, 20_000, 400_000, 10_000][i]}.00","1.00"`);
    const r = a.analyze(csv(...rows));
    expect(r.inflowStability).toBeLessThan(40);
    expect(r.salaryDetected).toBe(false);
  });

  it('detects salary without narration: similar amount on a stable day over >= 3 months', () => {
    const rows = ['27/01/2026', '28/02/2026', '26/03/2026', '27/04/2026'].map((d, i) => `${d},NIP Transfer from ACME,,"${[180_000, 182_000, 179_500, 181_000][i]}.00","1.00"`);
    const r = a.analyze(csv(...rows, '05/02/2026,NIP from friend,,"7,000.00","1.00"'));
    expect(r.salaryDetected).toBe(true);
    expect(r.salaryDay).toBe(27);
    // only two similar credits → not salary
    expect(a.analyze(csv(...rows.slice(0, 2))).salaryDetected).toBe(false);
  });

  it('accepts header variants, quoted commas, CRLF, a BOM, a preamble and mixed date formats', () => {
    const text = '﻿First Bank Statement\r\nAccount: 0123\r\nTrans. Date,Narration,Withdrawals,Deposits,Running Balance\r\n01-Jan-2026,"POS, LAGOS","₦1,000.00",,"₦9,000.00"\r\n2026-02-05,SALARY JAN,,"₦200,000.00","₦209,000.00"\r\n05/03/2026,Payroll Feb,,"₦200,000.00","₦409,000.00"\r\n';
    const r = a.analyze(text);
    expect(r.periodMonths).toBe(3);
    expect(r.salaryDetected).toBe(true); // SALARY + Payroll narration in 2 months
    expect(r.monthly[0].outflowKobo).toBe(100_000);
  });

  it('handles newest-first statements', () => {
    const rows = salaryRows().reverse();
    const r = a.analyze(csv(...rows));
    expect(r.periodMonths).toBe(6);
    expect(r.monthly[0].month).toBe('2026-01');
  });

  it('works without a balance column', () => {
    const r = a.analyze('date,description,debit,credit\n01/01/2026,Salary,,"100,000.00"\n01/02/2026,Salary,,"100,000.00"');
    expect(r.avgBalanceKobo).toBe(0);
    expect(r.avgMonthlyInflowKobo).toBe(10_000_000);
  });

  it.each([
    ['no header', '01/01/2026,x,1,2,3'],
    ['bad date', csv('99/99/2026,x,,"1.00","1.00"')],
    ['bad amount', csv('01/01/2026,x,,"abc","1.00"')],
    ['debit and credit on one row', csv('01/01/2026,x,"1.00","1.00","1.00"')],
    ['no transactions', HEAD],
    ['unterminated quote', `${HEAD}\n01/01/2026,"oops,,5,6`],
    ['empty', ''],
  ])('rejects malformed input: %s', (_n, text) => {
    expect(() => a.analyze(text)).toThrow(StatementParseError);
  });
  it('rejects binary content', () => expect(() => a.analyze(Buffer.from([0x25, 0x50, 0, 1, 2]))).toThrow(StatementParseError));
  it('reports the failing row number', () => {
    expect(() => a.analyze(csv('01/01/2026,ok,,"1.00","1.00"', 'zz,bad,,"1.00","1.00"'))).toThrow(/row 3/);
  });
});
