import type { BureauSummaryDto } from '@damez/shared';

export interface MonthlyPoint {
  /** yyyy-mm */
  month: string;
  inflowKobo: number;
  outflowKobo: number;
  /** last known running balance of the month (null when the statement has no balance column) */
  closingBalanceKobo: number | null;
}

export interface StatementAnalysis {
  /** calendar months spanned by the statement (inclusive) */
  periodMonths: number;
  avgMonthlyInflowKobo: number;
  /** 0-100 (1 − coefficient of variation of monthly inflow, clamped) */
  inflowStability: number;
  avgBalanceKobo: number;
  gamblingFlag: boolean;
  overdraftFlag: boolean;
  salaryDetected: boolean;
  /** typical day of month the salary lands */
  salaryDay: number | null;
  monthly: MonthlyPoint[];
}

/** Offline analyser over an uploaded statement (CSV). Throws StatementParseError on malformed input. */
export interface BankStatementAnalyzer {
  analyze(content: Buffer | string): StatementAnalysis;
}

/** What a provider may use to build/fetch an analysis (no PII beyond the raw statement bytes it was given to analyse). */
export interface StatementContext {
  customerId: string;
  declaredMonthlyIncomeKobo: number;
  employmentStatus: string | null;
  bureau: BureauSummaryDto | null;
  /** The customer's uploaded (PDF) bank statement, when one exists — Dojah's analysis API requires it. */
  statementPdf?: { bytes: Buffer; bankCode: string } | null;
}

/** Provider of statement analyses when the customer has not uploaded a parsable (CSV) statement (Mono | Dojah). */
export interface StatementProvider {
  readonly name: 'MONO' | 'DOJAH';
  analyze(ctx: StatementContext): Promise<StatementAnalysis>;
}
export const STATEMENT_PROVIDER = Symbol('STATEMENT_PROVIDER');

export class StatementParseError extends Error {
  constructor(message: string, public readonly row?: number) {
    super(row ? `${message} (row ${row})` : message);
    this.name = 'StatementParseError';
  }
}
