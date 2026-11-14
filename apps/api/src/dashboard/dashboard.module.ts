import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { DashboardSummary, KpiDto } from '@damez/shared';
import { RequirePermission } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { Inject } from '@nestjs/common';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (cur: number, prev: number) => (prev === 0 ? 0 : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);

/**
 * Dashboard summary. Portfolio series come from PortfolioSnapshot + DemoDataset (seeded demo data) until the loan
 * ledger exists (prompt 3); operational tiles are live. The response shape is the stable contract.
 */
@Injectable()
class DashboardService {
  constructor(private prisma: PrismaService, @Inject(QueueService) private queue: QueueService) {}

  async summary(): Promise<DashboardSummary> {
    const [snaps, sets] = await Promise.all([
      this.prisma.portfolioSnapshot.findMany({ orderBy: { date: 'asc' }, take: 180 }),
      this.prisma.demoDataset.findMany(),
    ]);
    const ds = (k: string) => sets.find((s) => s.key === k)?.json as never;
    const recent = snaps.slice(-90);
    const last30 = snaps.slice(-30);
    const prev30 = snaps.slice(-60, -30);
    const num = (f: (s: (typeof snaps)[number]) => bigint | number) => (xs: typeof snaps) => xs.map((s) => Number(f(s)));
    const disb = num((s) => s.disbursedKobo);
    const coll = num((s) => s.collectedKobo);
    const due = num((s) => s.dueKobo);
    const out = num((s) => s.outstandingKobo);
    const par30 = num((s) => s.par30Bps);
    const borrowers = num((s) => s.activeBorrowers);
    const apps = num((s) => s.applications);
    const appr = num((s) => s.approvedCount);
    const eff = (xs: typeof snaps) => (sum(due(xs)) ? Math.round((sum(coll(xs)) / sum(due(xs))) * 1000) / 10 : 0);
    const rate = (xs: typeof snaps) => (sum(apps(xs)) ? Math.round((sum(appr(xs)) / sum(apps(xs))) * 1000) / 10 : 0);

    const kpis: KpiDto[] = [
      { key: 'outstanding', label: 'Unpaid loans', value: out(snaps).at(-1) ?? 0, format: 'naira', delta: pct(out(last30).at(-1) ?? 0, out(prev30).at(-1) ?? 0), sparkline: out(last30) },
      { key: 'disbursed', label: 'Lent out (30d)', value: sum(disb(last30)), format: 'naira', delta: pct(sum(disb(last30)), sum(disb(prev30))), sparkline: disb(last30) },
      { key: 'collected', label: 'Collected (30d)', value: sum(coll(last30)), format: 'naira', delta: pct(sum(coll(last30)), sum(coll(prev30))), sparkline: coll(last30) },
      { key: 'efficiency', label: 'Collection rate', value: eff(last30), format: 'percent', delta: pct(eff(last30), eff(prev30)), sparkline: last30.map((s) => (Number(s.dueKobo) ? Math.round((Number(s.collectedKobo) / Number(s.dueKobo)) * 1000) / 10 : 0)) },
      { key: 'par30', label: 'Loans 30+ days late', value: (par30(snaps).at(-1) ?? 0) / 100, format: 'percent', delta: pct(par30(last30).at(-1) ?? 0, par30(prev30).at(-1) ?? 0), invertDelta: true, sparkline: par30(last30).map((v) => v / 100) },
      { key: 'borrowers', label: 'Active borrowers', value: borrowers(snaps).at(-1) ?? 0, format: 'number', delta: pct(borrowers(last30).at(-1) ?? 0, borrowers(prev30).at(-1) ?? 0), sparkline: borrowers(last30) },
      { key: 'approval_rate', label: 'Approval rate (30d)', value: rate(last30), format: 'percent', delta: pct(rate(last30), rate(prev30)), sparkline: last30.map((s) => (s.applications ? Math.round((s.approvedCount / s.applications) * 1000) / 10 : 0)) },
    ];

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400_000);
    const [pendingApprovals, auditEvents24h, activeSessions, failedLogins24h] = await Promise.all([
      this.prisma.approvalRequest.count({ where: { status: { in: ['PENDING', 'ESCALATED'] } } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: now }, lastActiveAt: { gt: new Date(now.getTime() - 30 * 60_000) } } }),
      this.prisma.loginEvent.count({ where: { createdAt: { gte: dayAgo }, outcome: { in: ['BAD_PASSWORD', 'BAD_TOTP', 'LOCKED', 'UNKNOWN_USER'] } } }),
    ]);

    return {
      kpis,
      disbursementSeries: recent.map((s) => ({ date: iso(s.date), disbursedKobo: Number(s.disbursedKobo), collectedKobo: Number(s.collectedKobo) })),
      outstandingSeries: recent.map((s) => ({ date: iso(s.date), outstandingKobo: Number(s.outstandingKobo) })),
      parSeries: recent.map((s) => ({ date: iso(s.date), par1: s.par1Bps / 100, par30: s.par30Bps / 100, par90: s.par90Bps / 100 })),
      funnel: ds('funnel') ?? [],
      heatmap: ds('heatmap') ?? { rows: [], cols: [], values: [] },
      cohorts: ds('cohorts') ?? [],
      productMix: ds('productMix') ?? [],
      stateDistribution: ds('stateDistribution') ?? [],
      operational: { pendingApprovals, auditEvents24h, activeSessions, failedLogins24h, queuesHealthy: this.queue.isReady },
    };
  }
}

@Controller('dashboard')
class DashboardController {
  constructor(private svc: DashboardService) {}
  @Get('summary') @RequirePermission('dashboard:read')
  summary() { return this.svc.summary(); }
}

@Module({ providers: [DashboardService], controllers: [DashboardController] })
export class DashboardModule {}
