import type { BureauFacilityDto, BureauReportDto } from '@damez/shared';
import { detectChanges } from './bureau-monitoring';

const fac = (o: Partial<BureauFacilityDto> = {}): BureauFacilityDto => ({
  id: 'f', sources: ['CRC'], lender: 'Access Bank', productType: 'Personal loan', amountGrantedKobo: 100_000_000, outstandingKobo: 5_000_000, status: 'PERFORMING', tenorMonths: 12, monthlyPaymentKobo: 1,
  openedAt: '2026-01-10T00:00:00.000Z', closedAt: null, lastPaymentAt: null, worstDpd: 0, isActive: true, legalAction: false, soldToCollections: false, isGuarantor: false, conflict: false, history: [], ...o,
});
const rep = (s: Partial<BureauReportDto['summary']> = {}, facilities: BureauFacilityDto[] = []): BureauReportDto => ({
  id: 'r', customerId: 'c', pulledAt: '', expiresAt: '', ageDays: 0, stale: false, reason: 'MONITORING', bureausQueried: [], bureausFailed: [], scores: [], facilities, enquiries: [], flags: [],
  summary: {
    bestScore: 650, lowestScore: 650, averageScore: 650, scoreBand: 'GOOD', worstDpdEver: 0, activeFacilityCount: 1, totalOutstandingKobo: 0, totalMonthlyObligationKobo: 0, enquiries30d: 0, enquiries90d: 0, enquiries180d: 0,
    defaultCount: 0, writeOffCount: 0, hasWriteOff24m: false, lastWriteOffMonthsAgo: null, hasDpd90In12m: false, elsewhereDefault: false, fraudFlag: false, legalActionCount: 0, soldToCollectionsCount: 0, guarantorExposureKobo: 0, thinFile: false, ...s,
  },
});

describe('detectChanges', () => {
  it('flags nothing without a baseline or without change', () => {
    expect(detectChanges(null, rep({ fraudFlag: true }))).toEqual([]);
    expect(detectChanges(rep(), rep())).toEqual([]);
  });
  it('new fraud flag', () => {
    expect(detectChanges(rep(), rep({ fraudFlag: true }))).toEqual([expect.objectContaining({ type: 'FRAUD_WATCHLIST', severity: 'HIGH' })]);
    expect(detectChanges(rep({ fraudFlag: true }), rep({ fraudFlag: true }))).toEqual([]);
  });
  it('new write-off and new elsewhere default', () => {
    const a = detectChanges(rep(), rep({ writeOffCount: 1, elsewhereDefault: true }));
    expect(a.filter((x) => x.type === 'ELSEWHERE_DEFAULT')).toHaveLength(2);
  });
  it('score drop only at >= 40 points', () => {
    expect(detectChanges(rep({ averageScore: 700 }), rep({ averageScore: 661 }))).toEqual([]);
    const a = detectChanges(rep({ averageScore: 700 }), rep({ averageScore: 660 }));
    expect(a).toEqual([expect.objectContaining({ type: 'SCORE_DROP', severity: 'MEDIUM' })]);
    expect(detectChanges(rep({ averageScore: 700 }), rep({ averageScore: 600 }))[0].severity).toBe('HIGH');
    expect(detectChanges(rep({ averageScore: 600 }), rep({ averageScore: 700 }))).toEqual([]);
  });
  it('new delinquency on a facility that was fine (matched across reports by lender + month + amount)', () => {
    const prev = rep({}, [fac()]);
    const next = rep({}, [fac({ lender: 'Access Bank Plc', status: 'Unpaid', worstDpd: 15 })]);
    expect(detectChanges(prev, next)).toEqual([expect.objectContaining({ type: 'NEW_DELINQUENCY' })]);
    // already Unpaid before: not new
    expect(detectChanges(next, next)).toEqual([]);
  });
});
