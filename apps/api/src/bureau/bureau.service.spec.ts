import { ForbiddenException } from '@nestjs/common';
import { BureauAggregator } from './bureau-aggregator';
import { BureauSettingsService, DEFAULT_BUREAU_SETTINGS } from './bureau-settings';
import { BureauService } from './bureau.service';
import type { CreditBureauProvider, RawBureauResult } from './bureau.types';
import { BureauProviders } from './providers';
import { FieldCipher } from '../crypto/field-cipher';

const NOW = new Date(Date.UTC(2026, 9, 9));
/** Test-only double standing in for the real Interswitch call, so BureauService's caching/billing/audit/flag logic
 *  can be tested without a network connection. */
function fakeInterswitch(result: RawBureauResult): CreditBureauProvider {
  return { bureau: 'INTERSWITCH', pull: async () => result };
}
const CLEAN_RESULT: RawBureauResult = { bureau: 'INTERSWITCH', notFound: false, score: 640, minScore: 300, maxScore: 850, facilities: [], enquiries: [], flags: [], thinFile: true };
const FRAUD_RESULT: RawBureauResult = { ...CLEAN_RESULT, flags: [{ type: 'FRAUD', detail: 'Identity misuse reported', date: NOW }] };
const DEFAULT_RESULT: RawBureauResult = {
  ...CLEAN_RESULT,
  facilities: [{
    lender: 'GTBank', productType: 'Personal loan', amountGrantedKobo: 50_000_00, outstandingKobo: 40_000_00, status: 'DEFAULTED',
    tenorMonths: 12, monthlyPaymentKobo: 5_000_00, openedAt: NOW, closedAt: null, lastPaymentAt: null, legalAction: false,
    soldToCollections: false, isGuarantor: false, history: [{ month: '2026-09', dpd: 90 }], worstDpd: 90,
  }],
};

/** Minimal in-memory prisma fake: just the calls BureauService makes. */
function fakePrisma() {
  const pulls: Record<string, unknown>[] = [];
  const reports: Record<string, unknown>[] = [];
  const flags: Record<string, unknown>[] = [];
  const empty = { createMany: async () => ({ count: 0 }) };
  const p = {
    pulls, reports, flags,
    bureauPull: { create: async ({ data }: { data: Record<string, unknown> }) => { pulls.push(data); return data; }, createMany: async ({ data }: { data: Record<string, unknown>[] }) => { pulls.push(...data); return { count: data.length }; } },
    bureauReport: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const r = { ...data, id: `rep${reports.length + 1}`, scores: [], facilities: [], enquiries: [], flags: [] }; reports.push(r); return r; },
      findFirst: async ({ where }: { where: { customerId: string; pulledAt?: { gt: Date } } }) => [...reports].reverse().find((r) => r.customerId === where.customerId && (!where.pulledAt || (r.pulledAt as Date) > where.pulledAt.gt)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => reports.find((r) => r.id === where.id) ?? null,
    },
    bureauScore: empty, bureauFacility: empty, bureauFacilityMonth: empty, bureauEnquiry: empty, bureauFlag: empty,
    customer: { findUnique: async () => ({ id: 'c1', firstName: 'Ada', lastName: 'Obi', branchId: null, erasedAt: null, phoneEnc: 'p', bvnEnc: 'b', dobEnc: null }) },
    consent: { findFirst: async () => ({ id: 'consent1' }) },
    customerRiskFlag: {
      findFirst: async ({ where }: { where: { type: string } }) => flags.find((f) => f.type === where.type && f.active) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { flags.push({ ...data, active: true }); return data; },
      updateMany: async ({ where }: { where: { type: string } }) => { flags.filter((f) => f.type === where.type).forEach((f) => { f.active = false; }); return { count: 1 }; },
    },
  };
  return p;
}

function build(opts: { consent: boolean; bvn?: string; result?: RawBureauResult }) {
  const prisma = fakePrisma();
  const audit = { record: jest.fn(async () => undefined) };
  const consent = { hasValidConsent: jest.fn(async () => opts.consent) };
  const cipher = { decrypt: (v: string) => (v === 'b' ? (opts.bvn ?? '22000000050') : '08031234567') } as unknown as FieldCipher;
  const settings = { get: async () => ({ ...DEFAULT_BUREAU_SETTINGS, retry: { maxAttempts: 1, baseDelayMs: 0 } }) } as BureauSettingsService;
  const providers = new BureauProviders({} as never);
  providers.override(fakeInterswitch(opts.result ?? CLEAN_RESULT));
  const agg = new BureauAggregator(providers);
  const svc = new BureauService(prisma as never, cipher, consent as never, audit as never, agg, settings);
  return { svc, prisma, audit, consent };
}

describe('BureauService', () => {
  it('blocks without consent: logs BLOCKED_NO_CONSENT, audits, and never reaches a bureau', async () => {
    const { svc, prisma, audit } = build({ consent: false });
    await expect(svc.ensureReport('c1', { reason: 'ON_DEMAND' })).rejects.toMatchObject({ response: { code: 'CONSENT_REQUIRED', purpose: 'BUREAU_PULL' } });
    await expect(svc.ensureReport('c1', { reason: 'ON_DEMAND' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.pulls).toHaveLength(2);
    expect(prisma.pulls[0]).toMatchObject({ bureau: 'ALL', status: 'BLOCKED_NO_CONSENT', costKobo: 0n });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'bureau.pull_blocked' }));
    expect(prisma.reports).toHaveLength(0);
  });

  it('pulls per bureau with costs, then serves the second request from cache for free', async () => {
    const { svc, prisma, audit } = build({ consent: true });
    const r1 = await svc.ensureReport('c1', { reason: 'APPLICATION', requestedById: 'u1' });
    expect(r1.bureausQueried).toEqual(['INTERSWITCH']);
    const rows = prisma.pulls as { bureau: string; status: string; costKobo: bigint; requestedById: string }[];
    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.status)).toEqual(['SUCCESS']);
    expect(rows.map((r) => Number(r.costKobo))).toEqual([20000]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'bureau.pulled' }));
    // audit never carries the data itself
    expect(JSON.stringify((audit.record.mock.calls as unknown[][]).map((c) => c[0]))).not.toContain('22000000050');

    const r2 = await svc.ensureReport('c1', { reason: 'APPLICATION' });
    expect(r2.id).toBe(r1.id);
    expect(prisma.pulls).toHaveLength(2);
    expect(prisma.pulls[1]).toMatchObject({ bureau: 'ALL', status: 'CACHED', costKobo: 0n });
  });

  it('force bypasses the cache and bills again; maxAgeDays=0 never uses cache', async () => {
    const { svc, prisma } = build({ consent: true });
    const a = await svc.ensureReport('c1', { reason: 'ON_DEMAND' });
    const b = await svc.ensureReport('c1', { reason: 'ON_DEMAND', force: true });
    expect(b.id).not.toBe(a.id);
    const c = await svc.ensureReport('c1', { reason: 'PRE_DISBURSEMENT', maxAgeDays: 0 });
    expect(c.id).not.toBe(b.id);
    expect(prisma.pulls.filter((p) => (p as { status: string }).status === 'SUCCESS')).toHaveLength(3);
  });

  it('raises FRAUD_WATCHLIST and ELSEWHERE_DEFAULT flags (source BUREAU_PULL)', async () => {
    const fraud = build({ consent: true, result: FRAUD_RESULT });
    await fraud.svc.ensureReport('c1', { reason: 'ON_DEMAND' });
    expect(fraud.prisma.flags.map((f) => f.type)).toContain('FRAUD_WATCHLIST');
    const def = build({ consent: true, result: DEFAULT_RESULT });
    await def.svc.ensureReport('c1', { reason: 'ON_DEMAND' });
    expect(def.prisma.flags.map((f) => f.type)).toContain('ELSEWHERE_DEFAULT');
    expect(def.prisma.flags[0]).toMatchObject({ source: 'BUREAU_PULL' });
  });
});
