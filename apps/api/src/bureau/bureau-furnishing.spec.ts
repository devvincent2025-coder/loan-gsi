import { PerformanceRecord } from '../contracts/ports';
import { BureauAggregator } from './bureau-aggregator';
import { BureauProviderError } from './bureau.types';
import { DEFAULT_BUREAU_SETTINGS } from './bureau-settings';
import {
  BureauFurnishingService, BureauSubmissionAdapter, BureauSubmissionAdapters, FurnishingFile, SubmissionResult, formatCreditRegistry, formatCrc, formatFirstCentral, previousPeriod, validateRecord,
} from './bureau-furnishing';
import { BureauProviders } from './providers';

/** Test-only double for the submission transport: accepts everything except BVNs ending in 99, so the service's
 *  retry/quarantine/notify orchestration can be exercised without a real bureau connection. */
class FakeSubmissionAdapter implements BureauSubmissionAdapter {
  constructor(public failFirst = 0) {}
  async submit(file: FurnishingFile): Promise<SubmissionResult> {
    if (this.failFirst > 0) { this.failFirst--; throw new BureauProviderError(`${file.bureau} gateway timeout`, file.bureau, true, 'UNAVAILABLE'); }
    const rejected = file.records.filter((r) => r.bvn.endsWith('99')).map((r) => ({ record: r.id, message: 'Subject could not be matched to a registered BVN' }));
    return { accepted: file.records.length - rejected.length, rejected };
  }
}

const rec = (o: Partial<PerformanceRecord> = {}): PerformanceRecord => ({
  customerId: 'c1', bvn: '22000000010', fullName: 'Chinedu Okafor, Jr', phone: '08031234567', facilityRef: 'LN-0001', productType: 'Personal loan', openedAt: new Date(Date.UTC(2026, 0, 15)),
  amountGrantedKobo: 50_000_000, outstandingKobo: 12_345_650, monthlyPaymentKobo: 4_500_000, tenorMonths: 12, dpd: 0, status: 'PERFORMING', lastPaymentAt: new Date(Date.UTC(2026, 8, 5)), closedAt: null, writtenOffAt: null, ...o,
});

describe('validation', () => {
  it('accepts a good record', () => expect(validateRecord(rec())).toEqual([]));
  it('rejects bad BVN, negative amounts, bad dates, unknown status and missing close/write-off dates', () => {
    expect(validateRecord(rec({ bvn: '1234' }))[0]).toMatch(/BVN/);
    expect(validateRecord(rec({ outstandingKobo: -1 })).join()).toMatch(/Outstanding/);
    expect(validateRecord(rec({ openedAt: new Date('nope') })).join()).toMatch(/Opening date/);
    expect(validateRecord(rec({ status: 'WEIRD' as never })).join()).toMatch(/status/);
    expect(validateRecord(rec({ status: 'CLOSED' })).join()).toMatch(/closing date/);
    expect(validateRecord(rec({ status: 'WRITTEN_OFF' })).join()).toMatch(/write-off date/);
    expect(validateRecord(rec({ dpd: -3 })).join()).toMatch(/Days past due/);
  });
});

describe('formatters', () => {
  it('CRC pipe-delimited', () => {
    const f = formatCrc('2026-09', [rec(), rec({ facilityRef: 'LN-2', status: 'DEFAULTED', dpd: 120 })]);
    const lines = f.content.trim().split('\n');
    expect(lines[0]).toBe('H|DAMEZ|202609|2');
    expect(lines[1]).toContain('BVN|SURNAME');
    const cols = lines[2].split('|');
    expect(cols[0]).toBe('22000000010');
    expect(cols[1]).toBe('Jr'); // last token is the surname; commas are plain text
    expect(cols[3]).toBe('2348031234567');
    expect(cols).toContain('PERF');
    expect(cols).toContain('20260115');
    expect(cols).toContain('123456.50');
    expect(lines[3].split('|')).toContain('DFLT');
    expect(lines[lines.length - 1]).toBe('T|2');
    expect(f.fileName).toBe('DAMEZ_CRC_CF_202609.txt');
  });
  it('FirstCentral CSV quotes fields that need it', () => {
    const f = formatFirstCentral('2026-09', [rec({ productType: 'Loan, personal' })]);
    const [head, row] = f.content.trim().split('\r\n');
    expect(head.startsWith('BVN,Surname,FirstName')).toBe(true);
    expect(row).toContain('"Loan, personal"');
    expect(row).toContain('15/01/2026');
    expect(row).toContain('Performing');
    expect(f.format).toBe('CSV');
  });
  it('CreditRegistry XML escapes and maps status codes', () => {
    const f = formatCreditRegistry('2026-09', [rec({ fullName: 'A & B <Test>', status: 'WRITTEN_OFF', writtenOffAt: new Date(Date.UTC(2026, 7, 1)) })], new Date(Date.UTC(2026, 9, 1)));
    expect(f.content).toContain('<?xml version="1.0"');
    expect(f.content).toContain('&amp;');
    expect(f.content).not.toContain('<Test>');
    expect(f.content).toContain('<Status>W</Status>');
    expect(f.content).toContain('<WrittenOffDate>2026-08-01</WrittenOffDate>');
  });
  it('previousPeriod', () => {
    expect(previousPeriod(new Date(Date.UTC(2026, 0, 3)))).toBe('2025-12');
    expect(previousPeriod(new Date(Date.UTC(2026, 9, 3)))).toBe('2026-09');
  });
});

function build(records: PerformanceRecord[], failFirst = 0) {
  const rows: Record<string, unknown>[] = [];
  const prisma = {
    bureauSubmission: { count: async () => 0, create: async ({ data }: { data: Record<string, unknown> }) => { const r = { ...data, id: `s${rows.length}`, submittedAt: new Date() }; rows.push(r); return r; } },
    staffUser: { findMany: async () => [{ id: 'u1' }] },
  };
  const audit = { record: jest.fn(async () => undefined) };
  const notifications = { notifyUsers: jest.fn(async () => undefined) };
  const settings = { get: async () => ({ ...DEFAULT_BUREAU_SETTINGS, retry: { maxAttempts: 3, baseDelayMs: 0 } }) };
  const adapters = new BureauSubmissionAdapters({} as never);
  for (const b of ['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY'] as const) adapters.override(b, new FakeSubmissionAdapter(b === 'FIRSTCENTRAL' ? failFirst : 0));
  const agg = new BureauAggregator(new BureauProviders({} as never));
  agg.wait = async () => undefined;
  const portfolio = { listPerformance: async () => records, listActiveBorrowerIds: async () => [], internalHistory: async () => ({}) };
  const svc = new BureauFurnishingService(prisma as never, audit as never, notifications as never, settings as never, adapters, agg, portfolio as never);
  return { svc, rows, audit, notifications };
}

describe('BureauFurnishingService', () => {
  it('submits valid records, quarantines invalid ones and rejected-by-bureau ones, notifies compliance', async () => {
    const { svc, rows, notifications, audit } = build([rec(), rec({ facilityRef: 'LN-BAD', bvn: '123' }), rec({ facilityRef: 'LN-99', bvn: '22000000099' })]);
    const out = await svc.run({ period: '2026-09' });
    expect(out).toHaveLength(3);
    for (const s of out) {
      expect(s).toMatchObject({ period: '2026-09', recordCount: 3, acceptedCount: 1, rejectedCount: 2, status: 'PARTIAL' });
      expect(s.errors.map((e) => e.record).sort()).toEqual(['LN-99', 'LN-BAD']);
      expect(JSON.stringify(s.errors)).not.toContain('22000000099');
    }
    expect(rows.map((r) => r.format)).toEqual(['PIPE', 'CSV', 'XML']);
    expect(notifications.notifyUsers).toHaveBeenCalledTimes(3);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'bureau.furnished' }));
  });
  it('is SUBMITTED when everything is accepted and REJECTED when nothing is', async () => {
    const ok = await build([rec()]).svc.run({ period: '2026-09' });
    expect(ok.every((s) => s.status === 'SUBMITTED')).toBe(true);
    const none = await build([rec({ bvn: 'x' })]).svc.run({ period: '2026-09' });
    expect(none.every((s) => s.status === 'REJECTED' && s.acceptedCount === 0)).toBe(true);
  });
  it('retries transient failures and marks FAILED when they persist', async () => {
    const recovered = await build([rec()], 2).svc.run({ period: '2026-09' });
    expect(recovered.find((s) => s.bureau === 'FIRSTCENTRAL')?.status).toBe('SUBMITTED');
    const failed = await build([rec()], 99).svc.run({ period: '2026-09' });
    expect(failed.find((s) => s.bureau === 'FIRSTCENTRAL')).toMatchObject({ status: 'FAILED', acceptedCount: 0 });
    expect(failed.find((s) => s.bureau === 'CRC')?.status).toBe('SUBMITTED');
  });
  it('caps stored errors at 200', async () => {
    const many = Array.from({ length: 250 }, (_, i) => rec({ facilityRef: `LN-${i}`, bvn: 'bad' }));
    const out = await build(many).svc.run({ period: '2026-09' });
    expect(out[0].errors).toHaveLength(200);
    expect(out[0].rejectedCount).toBe(250);
  });
  it('returns nothing when there is nothing to report', async () => {
    expect(await build([]).svc.run({ period: '2026-09' })).toEqual([]);
  });
});
