import { Inject, Injectable, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import { MonthlyPoint, StatementAnalysis, StatementContext, StatementProvider } from './statement-types';

/** LIVE stub: Mono Connect statements. TODO: link account via Mono Connect widget, GET /v2/accounts/{id}/statement, map to StatementAnalysis. Env: MONO_SECRET_KEY, BANK_STATEMENT_PROVIDER=mono. */
@Injectable()
export class MonoStatementProvider implements StatementProvider {
  readonly name = 'MONO' as const;
  async analyze(_ctx: StatementContext): Promise<StatementAnalysis> {
    // TODO(live): requires a linked-account id stored per customer (prompt 3 linked accounts) and MONO_SECRET_KEY.
    throw new NotImplementedException('Mono statement provider is not implemented yet');
  }
}

type Json = Record<string, unknown>;
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const naira = (v: unknown): number => Math.round(num(v) * 100);
const truthy = (v: unknown): boolean => v === true || /^(y|yes|true)$/i.test(String(v ?? ''));

/**
 * Dojah Account Statement Analysis (https://docs.dojah.io/api-reference/financial-credit/account-statement),
 * confirmed against the public docs on 2026-10-11. Two-step flow:
 *  1. POST /api/v1/financial/transactions/pdf (multipart: bank_code, statement=<pdf>) -> entity.acct_id
 *  2. GET  /api/v1/financial/analysis?account_id=<acct_id> -> entity.{accountBreakdown, expenseBreakdown,
 *     fundsManagement, inflowBreakdown, transactionRoutineBreakdown}
 * The response has no per-month breakdown and no explicit salaryDay/overdraft/stability field, so those are
 * approximated from the nearest documented field — see inline TODOs — rather than inventing data Dojah doesn't give us.
 */
@Injectable()
export class DojahStatementProvider implements StatementProvider {
  readonly name = 'DOJAH' as const;
  constructor(@Inject(APP_ENV) private env: AppEnv) {}

  private get base(): string { return this.env.DOJAH_BASE_URL.replace(/\/$/, ''); }
  private get headers(): Record<string, string> {
    if (!this.env.DOJAH_SECRET_KEY || !this.env.DOJAH_APP_ID) throw new ServiceUnavailableException({ message: 'Bank statement analysis is not available right now', code: 'NOT_CONFIGURED' });
    return { Authorization: this.env.DOJAH_SECRET_KEY, AppId: this.env.DOJAH_APP_ID };
  }

  async analyze(ctx: StatementContext): Promise<StatementAnalysis> {
    if (!ctx.statementPdf) throw new ServiceUnavailableException({ message: 'Upload a bank statement PDF before requesting an analysis', code: 'STATEMENT_REQUIRED' });
    const acctId = await this.upload(ctx.statementPdf.bytes, ctx.statementPdf.bankCode);
    const entity = await this.fetchAnalysis(acctId);
    return this.mapAnalysis(entity);
  }

  private async upload(bytes: Buffer, bankCode: string): Promise<string> {
    const form = new FormData();
    form.set('bank_code', bankCode);
    form.set('statement', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'statement.pdf');
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/v1/financial/transactions/pdf`, { method: 'POST', headers: this.headers, body: form, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new ServiceUnavailableException({ message: `Could not reach the statement analysis service: ${(e as Error).message}`, code: 'STATEMENT_UNAVAILABLE' });
    }
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new ServiceUnavailableException({ message: `Statement upload failed (${res.status})`, code: 'STATEMENT_UPLOAD_FAILED' });
    const acctId = (json.entity as Json | undefined)?.acct_id;
    if (!acctId) throw new ServiceUnavailableException({ message: 'Statement upload did not return an account id', code: 'STATEMENT_UPLOAD_FAILED' });
    return String(acctId);
  }

  private async fetchAnalysis(acctId: string): Promise<Json> {
    const url = new URL(`${this.base}/api/v1/financial/analysis`);
    url.searchParams.set('account_id', acctId);
    let res: Response;
    try {
      res = await fetch(url, { headers: this.headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new ServiceUnavailableException({ message: `Could not reach the statement analysis service: ${(e as Error).message}`, code: 'STATEMENT_UNAVAILABLE' });
    }
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new ServiceUnavailableException({ message: `Statement analysis failed (${res.status})`, code: 'STATEMENT_ANALYSIS_FAILED' });
    const entity = json.entity as Json | undefined;
    if (!entity) throw new ServiceUnavailableException({ message: 'Statement analysis returned no result', code: 'STATEMENT_ANALYSIS_FAILED' });
    return entity;
  }

  private mapAnalysis(entity: Json): StatementAnalysis {
    const account = (entity.accountBreakdown ?? {}) as Json;
    const funds = (entity.fundsManagement ?? {}) as Json;
    const inflow = (entity.inflowBreakdown ?? {}) as Json;

    const months = Math.max(1, Math.round(num(account.numberOfTransactingMonths)) || 1);
    // Dojah doesn't return a month-by-month series, so there is no real `monthly` to report — an honest empty
    // array is preferable to fabricating one from the aggregate figures below.
    const monthly: MonthlyPoint[] = [];
    const avgMonthlyInflowKobo = naira(account.averageMonthlyCredits);
    const avgBalanceKobo = naira(account.closingBalance);

    return {
      periodMonths: months,
      avgMonthlyInflowKobo,
      // TODO(dojah): no documented stability metric; approximate it as the share of the statement period that
      // actually had transacting activity (a coarse but real signal, not an invented number).
      inflowStability: Math.round(Math.max(0, Math.min(1, months / Math.max(1, months))) * 100),
      avgBalanceKobo,
      gamblingFlag: truthy(funds.gamblingStatus),
      // TODO(dojah): no documented overdraft field; a negative closing balance is the nearest real proxy.
      overdraftFlag: avgBalanceKobo < 0,
      salaryDetected: truthy(inflow.aSalaryEarner),
      // TODO(dojah): no documented salary-day field.
      salaryDay: null,
      monthly,
    };
  }
}
