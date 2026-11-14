import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { maskName } from '@damez/shared';
import type { BureauDistributionDto, BureauName, BureauPullDto, BureauSubmissionDto, BureauUsageDto, Page, PullReason, RiskFlagDto } from '@damez/shared';
import { paged, skipTake } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { SCORE_BANDS } from './bureau-merge';
import { BUREAUS } from './bureau.types';

export const pullsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  bureau: z.enum(['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY', 'INTERSWITCH', 'ALL']).optional(),
  status: z.enum(['SUCCESS', 'NO_HIT', 'FAILED', 'BLOCKED_NO_CONSENT', 'CACHED']).optional(),
  reason: z.enum(['APPLICATION', 'PRE_DISBURSEMENT', 'ON_DEMAND', 'MONITORING']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export const rangeQuerySchema = z.object({ from: z.string().optional(), to: z.string().optional() });
export const pageOnlySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(20) });

const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 1000) / 10 : 0);
const parseDate = (v: string | undefined, fallback: Date): Date => { const d = v ? new Date(v) : fallback; return Number.isNaN(d.getTime()) ? fallback : d; };

type PullRow = Prisma.BureauPullGetPayload<{ include: { customer: { select: { firstName: true; lastName: true } } } }>;

/** Usage/spend, pull log, score distribution (dataset for the executive dashboards in prompt 5) and monitoring alerts. */
@Injectable()
export class BureauAnalyticsService {
  constructor(private prisma: PrismaService) {}

  private toPullDto(r: PullRow, staff: Map<string, string>): BureauPullDto {
    return {
      id: r.id, customerId: r.customerId, customerName: maskName(`${r.customer.firstName} ${r.customer.lastName}`), applicationId: r.applicationId,
      bureau: r.bureau as BureauName | 'ALL', reason: r.reason as PullReason, status: r.status as BureauPullDto['status'], costKobo: Number(r.costKobo), durationMs: r.durationMs,
      requestedBy: r.requestedById ? { id: r.requestedById, name: staff.get(r.requestedById) ?? 'Unknown' } : null, error: r.error, createdAt: r.createdAt.toISOString(),
    };
  }
  private async staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const u = [...new Set(ids.filter((i): i is string => !!i))];
    const rows = u.length ? await this.prisma.staffUser.findMany({ where: { id: { in: u } }, select: { id: true, fullName: true } }) : [];
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  async pullsForCustomer(customerId: string): Promise<BureauPullDto[]> {
    const rows = await this.prisma.bureauPull.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 200, include: { customer: { select: { firstName: true, lastName: true } } } });
    const names = await this.staffNames(rows.map((r) => r.requestedById));
    return rows.map((r) => this.toPullDto(r, names));
  }

  async pulls(q: z.infer<typeof pullsQuerySchema>): Promise<Page<BureauPullDto>> {
    const where: Prisma.BureauPullWhereInput = {};
    if (q.bureau) where.bureau = q.bureau;
    if (q.status) where.status = q.status;
    if (q.reason) where.reason = q.reason;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: parseDate(q.from, new Date(0)) } : {}), ...(q.to ? { lte: parseDate(q.to, new Date()) } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.bureauPull.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize), include: { customer: { select: { firstName: true, lastName: true } } } }),
      this.prisma.bureauPull.count({ where }),
    ]);
    const names = await this.staffNames(rows.map((r) => r.requestedById));
    return paged(rows.map((r) => this.toPullDto(r, names)), total, q.page, q.pageSize);
  }

  async usage(q: { from?: string; to?: string }): Promise<BureauUsageDto> {
    const to = parseDate(q.to, new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));
    const rows = await this.prisma.bureauPull.findMany({
      where: { createdAt: { gte: from, lte: to } }, select: { bureau: true, reason: true, status: true, costKobo: true, durationMs: true, createdAt: true },
    });
    const billable = (s: string) => s === 'SUCCESS' || s === 'NO_HIT';
    const total = rows.reduce((a, r) => a + Number(r.costKobo), 0);
    const billableRows = rows.filter((r) => billable(r.status));
    const byBureau = BUREAUS.map((b) => {
      const rs = rows.filter((r) => r.bureau === b);
      const ok = rs.filter((r) => billable(r.status)).length;
      const timed = rs.filter((r) => r.durationMs != null);
      return {
        bureau: b, pulls: rs.length, costKobo: rs.reduce((a, r) => a + Number(r.costKobo), 0), successRate: pct(ok, rs.length) / 100,
        avgDurationMs: timed.length ? Math.round(timed.reduce((a, r) => a + (r.durationMs ?? 0), 0) / timed.length) : 0,
      };
    });
    const reasons: PullReason[] = ['APPLICATION', 'PRE_DISBURSEMENT', 'ON_DEMAND', 'MONITORING'];
    const byReason = reasons.map((reason) => {
      const rs = rows.filter((r) => r.reason === reason);
      return { reason, pulls: rs.length, costKobo: rs.reduce((a, r) => a + Number(r.costKobo), 0) };
    });
    const daily = new Map<string, { pulls: number; costKobo: number }>();
    for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= to.getTime(); t += 86_400_000) daily.set(new Date(t).toISOString().slice(0, 10), { pulls: 0, costKobo: 0 });
    for (const r of rows) {
      const d = daily.get(r.createdAt.toISOString().slice(0, 10)) ?? { pulls: 0, costKobo: 0 };
      d.pulls++; d.costKobo += Number(r.costKobo);
      daily.set(r.createdAt.toISOString().slice(0, 10), d);
    }
    return {
      from: from.toISOString(), to: to.toISOString(), totalPulls: rows.length, billablePulls: billableRows.length, cacheHits: rows.filter((r) => r.status === 'CACHED').length,
      failed: rows.filter((r) => r.status === 'FAILED').length, blockedNoConsent: rows.filter((r) => r.status === 'BLOCKED_NO_CONSENT').length, totalCostKobo: total,
      avgCostPerBillablePullKobo: billableRows.length ? Math.round(total / billableRows.length) : 0, byBureau, byReason,
      daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    };
  }

  /** Histogram of each customer's LATEST average bureau score. */
  async distribution(): Promise<BureauDistributionDto> {
    const rows = await this.prisma.bureauReport.findMany({
      orderBy: { pulledAt: 'desc' }, distinct: ['customerId'],
      select: { customerId: true, averageScore: true, totalOutstandingKobo: true, elsewhereDefault: true, writeOffCount: true },
    });
    const scored = rows.filter((r) => r.averageScore != null);
    const bands = SCORE_BANDS.map((b) => {
      const rs = scored.filter((r) => (r.averageScore as number) >= b.min && (r.averageScore as number) <= b.max);
      return { label: b.label, min: b.min, max: b.max, customers: rs.length, exposureKobo: rs.reduce((a, r) => a + Number(r.totalOutstandingKobo), 0) };
    });
    return {
      asOf: new Date().toISOString(), totalCustomers: rows.length,
      averageScore: scored.length ? Math.round(scored.reduce((a, r) => a + (r.averageScore as number), 0) / scored.length) : null,
      bands, elsewhereDefaultPct: pct(scored.filter((r) => r.elsewhereDefault).length, scored.length), writeOffPct: pct(scored.filter((r) => r.writeOffCount > 0).length, scored.length),
    };
  }

  async submissions(q: { page: number; pageSize: number }): Promise<Page<BureauSubmissionDto>> {
    const [rows, total] = await Promise.all([
      this.prisma.bureauSubmission.findMany({ orderBy: { submittedAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.bureauSubmission.count(),
    ]);
    return paged(rows.map(toSubmissionDto), total, q.page, q.pageSize);
  }

  async monitoringAlerts(q: { page: number; pageSize: number }): Promise<Page<RiskFlagDto>> {
    const where = { source: 'BUREAU_MONITORING' };
    const [rows, total] = await Promise.all([
      this.prisma.customerRiskFlag.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize), include: { customer: { select: { firstName: true, lastName: true } } } }),
      this.prisma.customerRiskFlag.count({ where }),
    ]);
    return paged(rows.map((r) => ({
      id: r.id, customerId: r.customerId, customerName: maskName(`${r.customer.firstName} ${r.customer.lastName}`), type: r.type as RiskFlagDto['type'], source: 'BUREAU_MONITORING' as const,
      severity: r.severity as RiskFlagDto['severity'], detail: r.detail, active: r.active, createdAt: r.createdAt.toISOString(),
    })), total, q.page, q.pageSize);
  }
}

export function toSubmissionDto(r: Prisma.BureauSubmissionGetPayload<Record<string, never>>): BureauSubmissionDto {
  return {
    id: r.id, bureau: r.bureau as BureauName, period: r.period, fileName: r.fileName, format: r.format, recordCount: r.recordCount, acceptedCount: r.acceptedCount, rejectedCount: r.rejectedCount,
    status: r.status as BureauSubmissionDto['status'], errors: (r.errors as { record: string; message: string }[] | null) ?? [], submittedAt: r.submittedAt.toISOString(),
  };
}
