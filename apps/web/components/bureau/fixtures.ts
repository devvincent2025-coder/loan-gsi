import type { BureauFacilityDto, BureauReportDto } from '@damez/shared';

export const facility = (over: Partial<BureauFacilityDto> = {}): BureauFacilityDto => ({
  id: 'f1', sources: ['CRC'], lender: 'Acme MFB', productType: 'PERSONAL_LOAN', amountGrantedKobo: 50_000_000, outstandingKobo: 20_000_000, status: 'PERFORMING',
  tenorMonths: 12, monthlyPaymentKobo: 4_500_000, openedAt: '2025-01-10T00:00:00.000Z', closedAt: null, lastPaymentAt: '2026-09-01T00:00:00.000Z', worstDpd: 0,
  isActive: true, legalAction: false, soldToCollections: false, isGuarantor: false, conflict: false,
  history: [{ month: '2026-07', dpd: 0 }, { month: '2026-08', dpd: 12 }, { month: '2026-09', dpd: 45 }], ...over,
});

export const report = (over: Partial<BureauReportDto> = {}): BureauReportDto => ({
  id: 'r1', customerId: 'c1', pulledAt: '2026-10-01T09:00:00.000Z', expiresAt: '2026-11-01T09:00:00.000Z', ageDays: 8, stale: false, reason: 'ON_DEMAND',
  bureausQueried: ['CRC', 'FIRSTCENTRAL'], bureausFailed: [],
  scores: [{ bureau: 'CRC', score: 640, band: 'GOOD', minScore: 300, maxScore: 850 }, { bureau: 'FIRSTCENTRAL', score: 610, band: 'GOOD', minScore: 300, maxScore: 850 }],
  summary: {
    bestScore: 640, lowestScore: 610, averageScore: 625, scoreBand: 'GOOD', worstDpdEver: 45, activeFacilityCount: 2, totalOutstandingKobo: 30_000_000, totalMonthlyObligationKobo: 9_000_000,
    enquiries30d: 1, enquiries90d: 2, enquiries180d: 3, defaultCount: 0, writeOffCount: 0, hasWriteOff24m: false, lastWriteOffMonthsAgo: null, hasDpd90In12m: false,
    elsewhereDefault: false, fraudFlag: false, legalActionCount: 0, soldToCollectionsCount: 0, guarantorExposureKobo: 0, thinFile: false,
  },
  facilities: [facility()], enquiries: [], flags: [], ...over,
});
