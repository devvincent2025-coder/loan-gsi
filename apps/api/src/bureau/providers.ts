/**
 * Interswitch is the sole credit-bureau integration (see packages/shared `BureauName` for why CRC/FirstCentral/
 * CreditRegistry remain as historical values only — this app no longer queries them directly). There is
 * deliberately no mock/offline fallback here: every pull is a real call to the Interswitch API Marketplace.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { BureauName } from '@damez/shared';
import { APP_ENV, AppEnv } from '../config/config.module';
import { dateOnly, monthKey } from './bureau-merge';
import { BureauNotConfiguredError, BureauProviderError, BureauRequest, CreditBureauProvider, RawBureauResult, RawEnquiry, RawFacility, RawFlag, SCORE_RANGES } from './bureau.types';

async function httpJson(url: string, init: RequestInit, timeoutMs = 20_000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (res.status === 404) return { __notFound: true };
    if (res.status === 401 || res.status === 403) throw new BureauProviderError(`Interswitch rejected our credentials (${res.status})`, 'INTERSWITCH', false, 'AUTH');
    if (res.status === 429 || res.status >= 500) throw new BureauProviderError(`Interswitch temporarily unavailable (${res.status})`, 'INTERSWITCH', true, 'UNAVAILABLE');
    if (!res.ok) throw new BureauProviderError(`Interswitch returned ${res.status}`, 'INTERSWITCH', false, 'BAD_REQUEST');
    return (await res.json()) as unknown;
  } catch (e) {
    if (e instanceof BureauProviderError) throw e;
    throw new BureauProviderError(`Interswitch request failed: ${(e as Error).name === 'AbortError' ? 'timeout' : 'network error'}`, 'INTERSWITCH', true, 'NETWORK');
  } finally { clearTimeout(t); }
}
/** dd-mm-yyyy, as returned by the Credit History Lookup sample response (e.g. "30-06-2022"). */
const dmyDate = (v: unknown): Date | null => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(v ?? ''));
  return m ? dateOnly(new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))) : null;
};
const nairaToKobo = (v: unknown): number => Math.max(0, Math.round(Number(v) * 100) || 0);
function mapLoanStatus(loanStatus: unknown, performanceStatus: unknown): RawFacility['status'] {
  const s = `${loanStatus ?? ''} ${performanceStatus ?? ''}`.toLowerCase();
  if (/written|charge.?off|loss/.test(s)) return 'WRITTEN_OFF';
  if (/default|non.?perform|lost|doubtful/.test(s)) return 'DEFAULTED';
  if (/delinq|past.?due|watch|substandard|overdue/.test(s)) return 'Unpaid';
  if (/clos|settled|paid|liquidat/.test(s)) return 'CLOSED';
  return 'PERFORMING';
}

/**
 * Interswitch Credit History Lookup. Sources CRC + FirstCentral (and reportedly CreditRegistry on the "premium"
 * tier) — our only credit-bureau integration. OAuth2 client-credentials auth.
 *
 * TODO(Interswitch): this mapping is based on a single example response seen in the API Marketplace docs
 * (`data.credit_history[]` grouped by `institution`, each with a `history[]` of loan records). It does not include
 * a numeric score, amount-granted, outstanding balance, DPD, legal-action or guarantor fields — confirm against
 * the full vendor schema (and the no-hit / error response shapes) once sandbox access is available.
 */
export class InterswitchProvider implements CreditBureauProvider {
  readonly bureau = 'INTERSWITCH' as const;
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private env: AppEnv) {}

  private creds(): { baseUrl: string; clientId: string; clientSecret: string } {
    const baseUrl = this.env.INTERSWITCH_BASE_URL; const clientId = this.env.INTERSWITCH_CLIENT_ID; const clientSecret = this.env.INTERSWITCH_CLIENT_SECRET;
    const missing = [['BASE_URL', baseUrl], ['CLIENT_ID', clientId], ['CLIENT_SECRET', clientSecret]].filter(([, v]) => !v).map(([k]) => `INTERSWITCH_${k}`);
    if (missing.length) throw new BureauNotConfiguredError('INTERSWITCH', missing);
    return { baseUrl: baseUrl!.replace(/\/$/, ''), clientId: clientId!, clientSecret: clientSecret! };
  }

  private async authenticate(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5_000) return this.token.value;
    // TODO(Interswitch): confirm the OAuth2 token endpoint path and grant type against the API Marketplace docs — not shown in the endpoint reference we scraped.
    const json = (await httpJson(`${baseUrl}/passport/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
      body: 'grant_type=client_credentials',
    })) as Record<string, unknown>;
    const accessToken = String(json.access_token ?? '');
    if (!accessToken) throw new BureauProviderError('Interswitch returned no access token', 'INTERSWITCH', false, 'AUTH');
    this.token = { value: accessToken, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
    return accessToken;
  }

  async pull(req: BureauRequest): Promise<RawBureauResult> {
    if (!req.bvn) throw new BureauProviderError('Interswitch Credit History Lookup requires a BVN (no name/DOB/phone fallback)', 'INTERSWITCH', false, 'BAD_REQUEST');
    const { baseUrl, clientId, clientSecret } = this.creds();
    const token = await this.authenticate(baseUrl, clientId, clientSecret);
    const json = (await httpJson(`${baseUrl}/v1/verify/identity/credit-history-lookup`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ bvn: req.bvn }),
    })) as Record<string, unknown>;
    return mapInterswitchCreditHistory(json);
  }
}

export function mapInterswitchCreditHistory(j: Record<string, unknown>): RawBureauResult {
  const range = SCORE_RANGES.INTERSWITCH;
  const empty = (notFound: boolean): RawBureauResult => ({ bureau: 'INTERSWITCH', notFound, score: null, minScore: range.min, maxScore: range.max, facilities: [], enquiries: [], flags: [], thinFile: true });
  if (j.__notFound || j.success === false) return empty(true);
  const data = (j.data ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(data.credit_history) ? (data.credit_history as Record<string, unknown>[]) : [];
  if (!groups.length) return empty(false);

  const facilities: RawFacility[] = [];
  for (const group of groups) {
    const institution = String(group.institution ?? 'Unknown lender');
    const loans = Array.isArray(group.history) ? (group.history as Record<string, unknown>[]) : [];
    for (const loan of loans) {
      const status = mapLoanStatus(loan.loan_status, loan.performance_status);
      const openedAt = dmyDate(loan.date_opened) ?? new Date();
      const closedAt = status === 'CLOSED' || status === 'WRITTEN_OFF' ? dmyDate(loan.closed_date) : null;
      const schedule = Array.isArray(loan.repayment_schedule) ? (loan.repayment_schedule as Record<string, unknown>[]) : [];
      // repayment_schedule gives {date: "MM-YYYY", status} with no numeric DPD; approximate a coarse one from the status text.
      const history = schedule.map((s) => ({
        month: /^\d{2}-\d{4}$/.test(String(s.date)) ? `${String(s.date).slice(3)}-${String(s.date).slice(0, 2)}` : monthKey(new Date()),
        dpd: /late|miss|overdue|default/i.test(String(s.status ?? '')) ? 30 : 0,
      }));
      facilities.push({
        lender: institution, productType: 'Personal loan', amountGrantedKobo: nairaToKobo(loan.opening_balance),
        outstandingKobo: status === 'CLOSED' || status === 'WRITTEN_OFF' ? 0 : nairaToKobo(loan.opening_balance),
        status, tenorMonths: Number(loan.tenor) > 0 ? Number(loan.tenor) : null, monthlyPaymentKobo: nairaToKobo(loan.repayment_amount),
        openedAt, closedAt, lastPaymentAt: null, legalAction: false, soldToCollections: false, isGuarantor: false,
        history, worstDpd: Math.max(0, ...history.map((h) => h.dpd)),
      });
    }
  }
  const enquiries: RawEnquiry[] = [];
  const flags: RawFlag[] = [];
  // The example response has no top-level score field; leave it null (thin-file-style) rather than invent one.
  return { bureau: 'INTERSWITCH', notFound: false, score: null, minScore: range.min, maxScore: range.max, facilities, enquiries, flags, thinFile: facilities.length < 2 };
}

/* ───────────── selection ───────────── */
@Injectable()
export class BureauProviders {
  private provider: CreditBureauProvider | null = null;
  constructor(@Inject(APP_ENV) private env: AppEnv) {}

  /** There is only one bureau now; the `bureau` argument is kept so call sites (and tests) don't need to change. */
  get(_bureau?: BureauName): CreditBureauProvider {
    if (!this.provider) this.provider = new InterswitchProvider(this.env);
    return this.provider;
  }
  /** tests / seeds */
  override(provider: CreditBureauProvider): void { this.provider = provider; }
}
