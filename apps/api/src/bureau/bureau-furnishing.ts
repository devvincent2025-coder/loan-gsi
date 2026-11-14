/**
 * Data furnishing: reporting OUR borrowers' repayment performance to each bureau every month (CBN credit reporting
 * obligation). Each bureau has its own file format; every record is validated before submission and bad ones are
 * quarantined with a reason instead of poisoning the whole file. Clear BVN/phone/name only ever live in the generated
 * file content in memory; logs, errors and audit rows carry facility references and counts only.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { BureauName, BureauSubmissionDto, FacilityStatus } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { APP_ENV, AppEnv } from '../config/config.module';
import { LOAN_PORTFOLIO_PORT, LoanPortfolioPort, PerformanceRecord } from '../contracts/ports';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { BureauAggregator, scrubError, withRetry } from './bureau-aggregator';
import { toSubmissionDto } from './bureau-analytics';
import { BureauSettingsService } from './bureau-settings';
import { BureauNotConfiguredError, BureauProviderError } from './bureau.types';

/**
 * The monthly CBN credit-reporting obligation runs to the actual bureaus, never to a reseller/aggregator like
 * Interswitch (there is nothing to "furnish" to a product that only reads reports on our behalf). This list is
 * therefore fixed and deliberately independent of `enabledBureaus` (which picks who we QUERY for credit checks).
 */
type FurnishableBureau = 'CRC' | 'FIRSTCENTRAL' | 'CREDITREGISTRY';
const FURNISHING_BUREAUS: FurnishableBureau[] = ['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY'];

const STATUSES: FacilityStatus[] = ['PERFORMING', 'Unpaid', 'DEFAULTED', 'WRITTEN_OFF', 'CLOSED'];
export type RecordError = { record: string; message: string };

/* ── validation ── */
const validDate = (d: Date | null | undefined): d is Date => d instanceof Date && !Number.isNaN(d.getTime());
export function validateRecord(r: PerformanceRecord, now: Date = new Date()): string[] {
  const e: string[] = [];
  if (!/^\d{11}$/.test(r.bvn ?? '')) e.push('BVN must be exactly 11 digits');
  if (!r.fullName?.trim()) e.push('Customer name is missing');
  if (!r.phone?.trim()) e.push('Phone number is missing');
  if (!r.facilityRef?.trim()) e.push('Facility reference is missing');
  if (!validDate(r.openedAt)) e.push('Opening date is invalid');
  else if (r.openedAt.getTime() > now.getTime() + 86_400_000) e.push('Opening date is in the future');
  for (const [k, v] of [['Amount granted', r.amountGrantedKobo], ['Outstanding balance', r.outstandingKobo], ['Monthly payment', r.monthlyPaymentKobo]] as const) {
    if (!Number.isInteger(v) || v < 0) e.push(`${k} must be a non-negative amount`);
  }
  if (!Number.isInteger(r.dpd) || r.dpd < 0) e.push('Days past due must be a non-negative whole number');
  if (!Number.isInteger(r.tenorMonths) || r.tenorMonths < 0) e.push('Tenor must be a non-negative whole number');
  if (!STATUSES.includes(r.status)) e.push('Facility status is not recognised');
  if (r.status === 'CLOSED' && !validDate(r.closedAt)) e.push('Closed facilities need a closing date');
  if (r.status === 'WRITTEN_OFF' && !validDate(r.writtenOffAt)) e.push('Written-off facilities need a write-off date');
  if (r.lastPaymentAt && !validDate(r.lastPaymentAt)) e.push('Last payment date is invalid');
  return e;
}

/* ── formatters ── */
const naira = (kobo: number): string => `${Math.floor(kobo / 100)}.${String(kobo % 100).padStart(2, '0')}`;
const ymd = (d: Date | null): string => (d && validDate(d) ? d.toISOString().slice(0, 10) : '');
const compact = (d: Date | null): string => ymd(d).replace(/-/g, '');
const dmy = (d: Date | null): string => (d && validDate(d) ? `${ymd(d).slice(8, 10)}/${ymd(d).slice(5, 7)}/${ymd(d).slice(0, 4)}` : '');
export function splitName(full: string): { first: string; last: string } {
  const p = full.trim().split(/\s+/);
  return p.length === 1 ? { first: p[0], last: p[0] } : { first: p.slice(0, -1).join(' '), last: p[p.length - 1] };
}
const phone234 = (p: string): string => { const d = p.replace(/\D/g, ''); return d.startsWith('234') ? d : `234${d.replace(/^0/, '')}`; };

export const CRC_STATUS: Record<FacilityStatus, string> = { PERFORMING: 'PERF', Unpaid: 'DELQ', DEFAULTED: 'DFLT', WRITTEN_OFF: 'WOFF', CLOSED: 'CLSD' };
export const FIRSTCENTRAL_STATUS: Record<FacilityStatus, string> = { PERFORMING: 'Performing', Unpaid: 'Unpaid', DEFAULTED: 'Lost', WRITTEN_OFF: 'Written off', CLOSED: 'Closed' };
export const CREDITREGISTRY_STATUS: Record<FacilityStatus, string> = { PERFORMING: 'A', Unpaid: 'D', DEFAULTED: 'X', WRITTEN_OFF: 'W', CLOSED: 'C' };

export interface FurnishingFile { bureau: BureauName; fileName: string; format: 'PIPE' | 'CSV' | 'XML'; content: string; records: { id: string; bvn: string }[] }
const INSTITUTION = 'DAMEZ';

const pipeSafe = (v: string): string => v.replace(/[|\r\n]/g, ' ').trim();
/** CRC: pipe-delimited credit-facility upload. */
export function formatCrc(period: string, recs: PerformanceRecord[]): FurnishingFile {
  const head = ['BVN', 'SURNAME', 'FIRSTNAME', 'PHONE', 'FACILITY_REF', 'FACILITY_TYPE', 'DATE_OPENED', 'AMOUNT_GRANTED', 'OUTSTANDING', 'INSTALMENT', 'TENOR', 'DPD', 'STATUS', 'LAST_PAYMENT_DATE', 'DATE_CLOSED', 'DATE_WRITTEN_OFF'];
  const lines = recs.map((r) => {
    const n = splitName(r.fullName);
    return [r.bvn, n.last, n.first, phone234(r.phone), r.facilityRef, r.productType, compact(r.openedAt), naira(r.amountGrantedKobo), naira(r.outstandingKobo), naira(r.monthlyPaymentKobo), r.tenorMonths, r.dpd,
      CRC_STATUS[r.status], compact(r.lastPaymentAt), compact(r.closedAt), compact(r.writtenOffAt)].map((x) => pipeSafe(String(x))).join('|');
  });
  const content = [`H|${INSTITUTION}|${period.replace('-', '')}|${recs.length}`, head.join('|'), ...lines, `T|${recs.length}`].join('\n') + '\n';
  return { bureau: 'CRC', fileName: `${INSTITUTION}_CRC_CF_${period.replace('-', '')}.txt`, format: 'PIPE', content, records: recs.map((r) => ({ id: r.facilityRef, bvn: r.bvn })) };
}

const csv = (v: string | number): string => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** FirstCentral: CSV with their header set. */
export function formatFirstCentral(period: string, recs: PerformanceRecord[]): FurnishingFile {
  const head = ['BVN', 'Surname', 'FirstName', 'PhoneNumber', 'AccountNumber', 'FacilityType', 'DateAccountOpened', 'LoanAmount', 'OutstandingBalance', 'InstalmentAmount', 'LoanDuration', 'DaysInArrears', 'AccountStatus', 'LastPaymentDate', 'ClosedDate', 'WrittenOffDate'];
  const lines = recs.map((r) => {
    const n = splitName(r.fullName);
    return [r.bvn, n.last, n.first, phone234(r.phone), r.facilityRef, r.productType, dmy(r.openedAt), naira(r.amountGrantedKobo), naira(r.outstandingKobo), naira(r.monthlyPaymentKobo), r.tenorMonths, r.dpd,
      FIRSTCENTRAL_STATUS[r.status], dmy(r.lastPaymentAt), dmy(r.closedAt), dmy(r.writtenOffAt)].map(csv).join(',');
  });
  return { bureau: 'FIRSTCENTRAL', fileName: `${INSTITUTION}_FIRSTCENTRAL_${period.replace('-', '')}.csv`, format: 'CSV', content: [head.join(','), ...lines].join('\r\n') + '\r\n', records: recs.map((r) => ({ id: r.facilityRef, bvn: r.bvn })) };
}

const xml = (v: string | number): string => String(v).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
/** CreditRegistry: XML. */
export function formatCreditRegistry(period: string, recs: PerformanceRecord[], now: Date = new Date()): FurnishingFile {
  const items = recs.map((r) => {
    const n = splitName(r.fullName);
    return [
      '  <Facility>',
      `    <Subject><BVN>${xml(r.bvn)}</BVN><Surname>${xml(n.last)}</Surname><FirstName>${xml(n.first)}</FirstName><Phone>${xml(phone234(r.phone))}</Phone></Subject>`,
      `    <Account><Reference>${xml(r.facilityRef)}</Reference><Type>${xml(r.productType)}</Type><OpenedDate>${ymd(r.openedAt)}</OpenedDate><TenorMonths>${r.tenorMonths}</TenorMonths></Account>`,
      `    <Amounts currency="NGN"><Granted>${naira(r.amountGrantedKobo)}</Granted><Outstanding>${naira(r.outstandingKobo)}</Outstanding><Instalment>${naira(r.monthlyPaymentKobo)}</Instalment></Amounts>`,
      `    <Performance><DaysPastDue>${r.dpd}</DaysPastDue><Status>${CREDITREGISTRY_STATUS[r.status]}</Status><LastPaymentDate>${ymd(r.lastPaymentAt)}</LastPaymentDate><ClosedDate>${ymd(r.closedAt)}</ClosedDate><WrittenOffDate>${ymd(r.writtenOffAt)}</WrittenOffDate></Performance>`,
      '  </Facility>',
    ].join('\n');
  });
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<CreditFacilityUpload institution="${INSTITUTION}" period="${period}" generated="${now.toISOString()}" count="${recs.length}">\n${items.join('\n')}\n</CreditFacilityUpload>\n`;
  return { bureau: 'CREDITREGISTRY', fileName: `${INSTITUTION}_CREDITREGISTRY_${period.replace('-', '')}.xml`, format: 'XML', content, records: recs.map((r) => ({ id: r.facilityRef, bvn: r.bvn })) };
}
export function formatFor(bureau: FurnishableBureau, period: string, recs: PerformanceRecord[], now?: Date): FurnishingFile {
  return bureau === 'CRC' ? formatCrc(period, recs) : bureau === 'FIRSTCENTRAL' ? formatFirstCentral(period, recs) : formatCreditRegistry(period, recs, now);
}

/* ── submission adapters ── */
export interface SubmissionResult { accepted: number; rejected: RecordError[] }
export interface BureauSubmissionAdapter {
  submit(_file: FurnishingFile): Promise<SubmissionResult>;
}
/** Live submission stub (credit-facility upload via SFTP or HTTPS depending on the bureau). No mock fallback — this
 *  has never had real credentials, so it has always thrown NOT_IMPLEMENTED; that is unchanged. */
export class LiveSubmissionAdapter implements BureauSubmissionAdapter {
  constructor(private bureau: BureauName, private env: AppEnv) {}
  async submit(_file: FurnishingFile): Promise<SubmissionResult> {
    const e = this.env as unknown as Record<string, string | undefined>;
    const p = this.bureau;
    const missing = ['BASE_URL', 'USERNAME', 'PASSWORD'].filter((k) => !e[`${p}_${k}`]).map((k) => `${p}_${k}`);
    if (missing.length) throw new BureauNotConfiguredError(this.bureau, missing);
    // TODO(CRC/FirstCentral/CreditRegistry): confirm the monthly upload channel (SFTP drop folder vs HTTPS endpoint), file naming, acknowledgement/rejection-report format and credentials with each vendor's data-submission spec
    throw new BureauProviderError(`${this.bureau} live furnishing is not implemented yet`, this.bureau, false, 'NOT_IMPLEMENTED');
  }
}
@Injectable()
export class BureauSubmissionAdapters {
  private cache = new Map<BureauName, BureauSubmissionAdapter>();
  constructor(@Inject(APP_ENV) private env: AppEnv) {}
  get(bureau: BureauName): BureauSubmissionAdapter {
    let a = this.cache.get(bureau);
    if (!a) { a = new LiveSubmissionAdapter(bureau, this.env); this.cache.set(bureau, a); }
    return a;
  }
  override(bureau: BureauName, a: BureauSubmissionAdapter): void { this.cache.set(bureau, a); }
}

export const previousPeriod = (now: Date = new Date()): string => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const MAX_ERRORS = 200;

@Injectable()
export class BureauFurnishingService {
  private log = new Logger('BureauFurnishing');
  constructor(
    private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService, private settings: BureauSettingsService,
    private adapters: BureauSubmissionAdapters, private aggregator: BureauAggregator,
    @Optional() @Inject(LOAN_PORTFOLIO_PORT) private portfolio?: LoanPortfolioPort,
  ) {}

  /** Scheduled runs respect bureau.furnishing_enabled and never re-submit a period already submitted. */
  async run(opts: { period?: string; scheduled?: boolean } = {}): Promise<BureauSubmissionDto[]> {
    const cfg = await this.settings.get();
    if (opts.scheduled && !cfg.furnishingEnabled) return [];
    if (!this.portfolio) { this.log.warn('LOAN_PORTFOLIO_PORT not available; nothing to furnish'); return []; }
    const period = opts.period ?? previousPeriod();
    const all = await this.portfolio.listPerformance(period);
    if (!all.length) return [];
    const valid: PerformanceRecord[] = []; const invalid: RecordError[] = [];
    for (const r of all) {
      const errs = validateRecord(r);
      if (errs.length) invalid.push({ record: r.facilityRef || '(no reference)', message: errs.join('; ') });
      else valid.push(r);
    }
    const out: BureauSubmissionDto[] = [];
    for (const bureau of FURNISHING_BUREAUS) {
      if (opts.scheduled && (await this.prisma.bureauSubmission.count({ where: { bureau, period, status: { in: ['SUBMITTED', 'PARTIAL'] } } }))) continue;
      out.push(await this.submitOne(bureau, period, valid, invalid, all.length, cfg.retry));
    }
    return out;
  }

  private async submitOne(bureau: FurnishableBureau, period: string, valid: PerformanceRecord[], invalid: RecordError[], total: number, retry: { maxAttempts: number; baseDelayMs: number }): Promise<BureauSubmissionDto> {
    const file = formatFor(bureau, period, valid);
    let accepted = 0; let rejected: RecordError[] = [...invalid]; let failed = false;
    if (valid.length) {
      try {
        const { value } = await withRetry(() => this.adapters.get(bureau).submit(file), retry, (ms) => this.aggregator.wait(ms));
        accepted = value.accepted; rejected = [...rejected, ...value.rejected];
      } catch (e) {
        failed = true;
        rejected = [...rejected, { record: '*', message: `Submission failed: ${scrubError(e)}` }];
      }
    }
    const rejectedCount = failed ? total : rejected.length;
    const status = failed ? 'FAILED' : accepted === 0 ? 'REJECTED' : rejected.length ? 'PARTIAL' : 'SUBMITTED';
    const row = await this.prisma.bureauSubmission.create({
      data: { bureau, period, fileName: file.fileName, format: file.format, recordCount: total, acceptedCount: failed ? 0 : accepted, rejectedCount, status, errors: rejected.slice(0, MAX_ERRORS) },
    });
    await this.audit.record({ action: 'bureau.furnished', resourceType: 'BureauSubmission', resourceId: row.id, outcome: failed ? 'FAILURE' : 'SUCCESS', metadata: { bureau, period, fileName: file.fileName, records: total, accepted: row.acceptedCount, rejected: rejectedCount, status } });
    if (rejectedCount > 0) await this.notifyCompliance(bureau, period, row.acceptedCount, rejectedCount, status);
    return toSubmissionDto(row);
  }

  private async notifyCompliance(bureau: BureauName, period: string, accepted: number, rejected: number, status: string): Promise<void> {
    const users = await this.prisma.staffUser.findMany({ where: { status: 'ACTIVE', role: { permissions: { some: { permission: { key: 'bureau:usage' } } } } }, select: { id: true } });
    await this.notifications.notifyUsers(users.map((u) => u.id), `Bureau furnishing ${status.toLowerCase()}: ${bureau} ${period}`, `${rejected} record(s) were rejected or not submitted (${accepted} accepted). Review the submission errors under Credit Bureau.`, '/bureau');
  }
}
