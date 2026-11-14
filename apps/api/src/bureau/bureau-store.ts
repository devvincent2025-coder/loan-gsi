import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type { BureauFacilityDto, BureauName, BureauReportDto, BureauSummaryDto, FacilityStatus, PullReason, ScoreBand } from '@damez/shared';
import { MergedReport } from './bureau.types';

export interface PersistMeta {
  reason: PullReason;
  /** report expires after this many days (setting bureau.cache_ttl_days) */
  cacheTtlDays: number;
  pulledAt?: Date;
}

/**
 * Persist one immutable snapshot (report + scores + facilities + monthly history + enquiries + flags).
 * Exported so seeds can write bureau data through the exact same path. Pass a transaction client to make it atomic.
 */
export async function persistBureauReport(
  db: Prisma.TransactionClient, customerId: string, merged: MergedReport, meta: PersistMeta,
): Promise<{ id: string; pulledAt: Date; expiresAt: Date }> {
  const pulledAt = meta.pulledAt ?? new Date();
  const expiresAt = new Date(pulledAt.getTime() + meta.cacheTtlDays * 86_400_000);
  const s = merged.summary;
  const report = await db.bureauReport.create({
    data: {
      customerId, pullReason: meta.reason, pulledAt, expiresAt,
      bureausQueried: merged.bureausQueried, bureausFailed: merged.bureausFailed,
      bestScore: s.bestScore, lowestScore: s.lowestScore, averageScore: s.averageScore, scoreBand: s.scoreBand,
      worstDpdEver: s.worstDpdEver, activeFacilityCount: s.activeFacilityCount, totalOutstandingKobo: BigInt(s.totalOutstandingKobo), totalMonthlyObligationKobo: BigInt(s.totalMonthlyObligationKobo),
      enquiries30d: s.enquiries30d, enquiries90d: s.enquiries90d, enquiries180d: s.enquiries180d, defaultCount: s.defaultCount, writeOffCount: s.writeOffCount,
      hasWriteOff24m: s.hasWriteOff24m, lastWriteOffMonthsAgo: s.lastWriteOffMonthsAgo, hasDpd90In12m: s.hasDpd90In12m, elsewhereDefault: s.elsewhereDefault, fraudFlag: s.fraudFlag,
      legalActionCount: s.legalActionCount, soldToCollectionsCount: s.soldToCollectionsCount, guarantorExposureKobo: BigInt(s.guarantorExposureKobo), thinFile: s.thinFile,
    },
  });
  if (merged.scores.length) {
    await db.bureauScore.createMany({ data: merged.scores.map((x) => ({ reportId: report.id, bureau: x.bureau, score: x.score, band: x.band, minScore: x.minScore, maxScore: x.maxScore })) });
  }
  const facilityIds = merged.facilities.map(() => randomUUID());
  if (merged.facilities.length) {
    await db.bureauFacility.createMany({
      data: merged.facilities.map((f, i) => ({
        id: facilityIds[i], reportId: report.id, sources: f.sources, lender: f.lender, productType: f.productType, amountGrantedKobo: BigInt(f.amountGrantedKobo), outstandingKobo: BigInt(f.outstandingKobo),
        status: f.status, tenorMonths: f.tenorMonths, monthlyPaymentKobo: BigInt(f.monthlyPaymentKobo), openedAt: f.openedAt, closedAt: f.closedAt, lastPaymentAt: f.lastPaymentAt, worstDpd: f.worstDpd,
        isActive: f.isActive, legalAction: f.legalAction, soldToCollections: f.soldToCollections, isGuarantor: f.isGuarantor, conflict: f.conflict, dedupeKey: f.dedupeKey,
      })),
    });
    const months = merged.facilities.flatMap((f, i) => f.history.map((h) => ({ facilityId: facilityIds[i], month: h.month, dpd: h.dpd })));
    if (months.length) await db.bureauFacilityMonth.createMany({ data: months });
  }
  if (merged.enquiries.length) await db.bureauEnquiry.createMany({ data: merged.enquiries.map((e) => ({ reportId: report.id, lender: e.lender, date: e.date, purpose: e.purpose, sources: e.sources })) });
  if (merged.flags.length) await db.bureauFlag.createMany({ data: merged.flags.map((f) => ({ reportId: report.id, type: f.type, source: f.source, detail: f.detail, date: f.date })) });
  return { id: report.id, pulledAt, expiresAt };
}

export const reportInclude = {
  scores: true,
  facilities: { include: { months: { orderBy: { month: 'asc' as const } } }, orderBy: { openedAt: 'desc' as const } },
  enquiries: { orderBy: { date: 'desc' as const } },
  flags: { orderBy: { date: 'desc' as const } },
} satisfies Prisma.BureauReportInclude;
export type ReportRow = Prisma.BureauReportGetPayload<{ include: typeof reportInclude }>;
export type ReportHeadRow = Prisma.BureauReportGetPayload<Record<string, never>>;

export function summaryFromRow(r: ReportHeadRow): BureauSummaryDto {
  return {
    bestScore: r.bestScore, lowestScore: r.lowestScore, averageScore: r.averageScore, scoreBand: r.scoreBand as ScoreBand | null,
    worstDpdEver: r.worstDpdEver, activeFacilityCount: r.activeFacilityCount, totalOutstandingKobo: Number(r.totalOutstandingKobo), totalMonthlyObligationKobo: Number(r.totalMonthlyObligationKobo),
    enquiries30d: r.enquiries30d, enquiries90d: r.enquiries90d, enquiries180d: r.enquiries180d, defaultCount: r.defaultCount, writeOffCount: r.writeOffCount,
    hasWriteOff24m: r.hasWriteOff24m, lastWriteOffMonthsAgo: r.lastWriteOffMonthsAgo, hasDpd90In12m: r.hasDpd90In12m, elsewhereDefault: r.elsewhereDefault, fraudFlag: r.fraudFlag,
    legalActionCount: r.legalActionCount, soldToCollectionsCount: r.soldToCollectionsCount, guarantorExposureKobo: Number(r.guarantorExposureKobo), thinFile: r.thinFile,
  };
}

export function toReportDto(r: ReportRow, preDisbursementMaxAgeDays: number, now: Date = new Date()): BureauReportDto {
  const ageDays = Math.max(0, Math.floor((now.getTime() - r.pulledAt.getTime()) / 86_400_000));
  const facilities: BureauFacilityDto[] = r.facilities.map((f) => ({
    id: f.id, sources: f.sources as BureauName[], lender: f.lender, productType: f.productType, amountGrantedKobo: Number(f.amountGrantedKobo), outstandingKobo: Number(f.outstandingKobo),
    status: f.status as FacilityStatus, tenorMonths: f.tenorMonths, monthlyPaymentKobo: Number(f.monthlyPaymentKobo), openedAt: f.openedAt.toISOString(),
    closedAt: f.closedAt?.toISOString() ?? null, lastPaymentAt: f.lastPaymentAt?.toISOString() ?? null, worstDpd: f.worstDpd, isActive: f.isActive, legalAction: f.legalAction,
    soldToCollections: f.soldToCollections, isGuarantor: f.isGuarantor, conflict: f.conflict, history: f.months.map((m) => ({ month: m.month, dpd: m.dpd })),
  }));
  return {
    id: r.id, customerId: r.customerId, pulledAt: r.pulledAt.toISOString(), expiresAt: r.expiresAt.toISOString(), ageDays, stale: ageDays > preDisbursementMaxAgeDays,
    reason: r.pullReason as PullReason, bureausQueried: r.bureausQueried as BureauName[], bureausFailed: r.bureausFailed as { bureau: BureauName; error: string }[],
    scores: r.scores.map((x) => ({ bureau: x.bureau as BureauName, score: x.score, band: x.band as ScoreBand | null, minScore: x.minScore, maxScore: x.maxScore })),
    summary: summaryFromRow(r), facilities,
    enquiries: r.enquiries.map((e) => ({ lender: e.lender, date: e.date.toISOString(), purpose: e.purpose, sources: e.sources as BureauName[] })),
    flags: r.flags.map((f) => ({ type: f.type as 'FRAUD' | 'WATCHLIST' | 'GUARANTOR_DEFAULT', source: f.source as BureauName, detail: f.detail, date: f.date.toISOString() })),
  };
}
