import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { n } from '../common/bigint';

/* ─── Tool parameter types ───────────────────────────────────────────────────── */

export interface PortfolioSummaryParams {
  asOfDate?: string;
  periodDays?: number;
}

export interface ParByBranchParams {
  asOfDate?: string;
  sortBy?: 'par30' | 'par90' | 'npl';
}

export interface NplTrendParams {
  periodDays?: number;
  branchId?: string;
}

export interface CollectionsEfficiencyParams {
  branchId?: string;
  periodDays?: number;
}

export interface DisbursementVsTargetParams {
  periodDays?: number;
  branchId?: string;
}

export interface StaffProductivityParams {
  periodDays?: number;
  branchId?: string;
}

export interface PendingApprovalsParams {
  actionType?: string;
}

export interface GetAnomaliesParams {
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  limit?: number;
}

export interface ComparePeriodsParams {
  metric: string;
  periodA: string; // 'YYYY-MM-DD/YYYY-MM-DD'
  periodB: string;
  branchId?: string;
}

export interface BureauScoreDistributionParams {
  asOfDate?: string;
}

/* ─── Anthropic tool definition ──────────────────────────────────────────────── */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

/* ─── ExecutiveToolsService ───────────────────────────────────────────────────── */

@Injectable()
export class ExecutiveToolsService {
  constructor(private readonly prisma: PrismaService) {}

  private checkBranchScope(requestedBranch: string | undefined, scope: string | null): void {
    if (!scope || !requestedBranch) return;
    if (requestedBranch !== scope) {
      throw new ForbiddenException('Branch scope restriction: cannot query another branch');
    }
  }

  /** Tool: get_portfolio_summary */
  async getPortfolioSummary(
    params: PortfolioSummaryParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>> {
    const asOf = params.asOfDate ? new Date(params.asOfDate) : new Date();
    const periodDays = params.periodDays ?? 30;

    const latest = await this.prisma.portfolioDailyMetrics.findFirst({
      where: { snapshotDate: { lte: asOf } },
      orderBy: { snapshotDate: 'desc' },
    });

    const sinceDate = new Date(asOf.getTime() - periodDays * 86400_000);
    const disbPeriod = await this.prisma.portfolioDailyMetrics.aggregate({
      where: { snapshotDate: { gte: sinceDate, lte: asOf } },
      _sum: { disbursementsKobo: true },
    });

    return {
      asOfDate: asOf.toISOString().split('T')[0],
      totalOutstandingKobo: latest ? n(latest.totalOutstandingKobo) : null,
      par30Ratio: latest?.par30Ratio ?? null,
      par90Ratio: latest?.par90Ratio ?? null,
      nplRatio: latest?.nplRatio ?? null,
      activeLoansCount: latest?.activeLoansCount ?? null,
      disbursementsKobo30d: n(disbPeriod._sum.disbursementsKobo ?? BigInt(0)),
      collectionEfficiency: latest?.collectionEfficiency ?? null,
      eclTotalKobo: latest ? n(latest.eclTotalKobo) : null,
    };
  }

  /** Tool: get_par_by_branch */
  async getParByBranch(
    params: ParByBranchParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>[]> {
    const asOf = params.asOfDate ? new Date(params.asOfDate) : new Date();
    const sortBy = params.sortBy ?? 'par30';

    const rows = await this.prisma.branchDailyMetrics.findMany({
      where: {
        snapshotDate: { lte: asOf },
        ...(branchScope ? { branchId: branchScope } : {}),
      },
      orderBy: [{ snapshotDate: 'desc' }, { branchId: 'asc' }],
      distinct: ['branchId'],
    });

    const sortKey = sortBy === 'par30' ? 'par30Ratio' : sortBy === 'par90' ? 'par90Ratio' : 'nplRatio';
    rows.sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));

    return rows.map((r) => ({
      branchId: r.branchId,
      branchName: r.branchName,
      par30Ratio: r.par30Ratio,
      par90Ratio: r.par90Ratio,
      nplRatio: r.nplRatio,
      outstandingKobo: n(r.outstandingKobo),
    }));
  }

  /** Tool: get_npl_trend */
  async getNplTrend(
    params: NplTrendParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>[]> {
    const periodDays = params.periodDays ?? 30;
    if (params.branchId) this.checkBranchScope(params.branchId, branchScope ?? null);

    const since = new Date(Date.now() - periodDays * 86400_000);

    if (params.branchId) {
      const rows = await this.prisma.branchDailyMetrics.findMany({
        where: { branchId: params.branchId, snapshotDate: { gte: since } },
        orderBy: { snapshotDate: 'asc' },
      });
      return rows.map((r) => ({
        date: r.snapshotDate.toISOString().split('T')[0],
        nplRatio: r.nplRatio,
        par30Ratio: r.par30Ratio,
        par90Ratio: r.par90Ratio,
      }));
    }

    const rows = await this.prisma.portfolioDailyMetrics.findMany({
      where: { snapshotDate: { gte: since } },
      orderBy: { snapshotDate: 'asc' },
    });
    return rows.map((r) => ({
      date: r.snapshotDate.toISOString().split('T')[0],
      nplRatio: r.nplRatio,
      par30Ratio: r.par30Ratio,
      par90Ratio: r.par90Ratio,
    }));
  }

  /** Tool: get_collections_efficiency */
  async getCollectionsEfficiency(
    params: CollectionsEfficiencyParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>> {
    const periodDays = params.periodDays ?? 30;
    if (params.branchId) this.checkBranchScope(params.branchId, branchScope ?? null);

    const since = new Date(Date.now() - periodDays * 86400_000);

    const ptps = await this.prisma.promiseToPay.findMany({
      where: {
        promisedDate: { gte: since },
        ...(params.branchId ? { case: { branchId: params.branchId } } : {}),
      },
      select: { status: true },
    });

    const ptpTotal = ptps.length;
    const ptpKept = ptps.filter((p) => p.status === 'KEPT').length;
    const ptpBroken = ptps.filter((p) => p.status === 'BROKEN').length;

    // Get last 7 days efficiency trend
    const last7 = await this.prisma.collectionsDaily.findMany({
      where: {
        snapshotDate: { gte: new Date(Date.now() - 7 * 86400_000) },
        ...(params.branchId ? { branchId: params.branchId } : { branchId: null }),
      },
      orderBy: { snapshotDate: 'asc' },
    });

    const aggRecovered = await this.prisma.collectionsDaily.aggregate({
      where: {
        snapshotDate: { gte: since },
        ...(params.branchId ? { branchId: params.branchId } : {}),
      },
      _sum: { amountRecoveredKobo: true },
    });

    const latest = await this.prisma.collectionsDaily.findFirst({
      where: { ...(params.branchId ? { branchId: params.branchId } : { branchId: null }) },
      orderBy: { snapshotDate: 'desc' },
    });

    return {
      efficiency30d: latest?.ptpKeptRate ?? 0,
      efficiencyTrend7: last7.map((r) => ({
        date: r.snapshotDate.toISOString().split('T')[0],
        ptpKeptRate: r.ptpKeptRate,
      })),
      ptpKeptRate: ptpTotal > 0 ? ptpKept / ptpTotal : 0,
      ptpBrokenRate: ptpTotal > 0 ? ptpBroken / ptpTotal : 0,
      amountRecoveredKobo: n(aggRecovered._sum.amountRecoveredKobo ?? BigInt(0)),
    };
  }

  /** Tool: get_disbursement_vs_target */
  async getDisbursementVsTarget(
    params: DisbursementVsTargetParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>> {
    const periodDays = params.periodDays ?? 30;
    if (params.branchId) this.checkBranchScope(params.branchId, branchScope ?? null);

    const since = new Date(Date.now() - periodDays * 86400_000);

    const where = params.branchId
      ? { branchId: params.branchId, snapshotDate: { gte: since } }
      : { snapshotDate: { gte: since } };

    const agg = params.branchId
      ? await this.prisma.branchDailyMetrics.aggregate({
          where,
          _sum: { disbursementsKobo: true, disbursementsCount: true },
        })
      : await this.prisma.portfolioDailyMetrics.aggregate({
          where,
          _sum: { disbursementsKobo: true, disbursementsCount: true },
        });

    const disbursedKobo = n(agg._sum.disbursementsKobo ?? BigInt(0)) ?? 0;
    const disbursementCount = agg._sum.disbursementsCount ?? 0;
    const avgTicketKobo = disbursementCount > 0 ? Math.round(disbursedKobo / disbursementCount) : 0;

    // Prior period as target baseline
    const priorSince = new Date(since.getTime() - periodDays * 86400_000);
    const priorAgg = params.branchId
      ? await this.prisma.branchDailyMetrics.aggregate({
          where: { branchId: params.branchId, snapshotDate: { gte: priorSince, lt: since } },
          _sum: { disbursementsKobo: true },
        })
      : await this.prisma.portfolioDailyMetrics.aggregate({
          where: { snapshotDate: { gte: priorSince, lt: since } },
          _sum: { disbursementsKobo: true },
        });

    const targetKobo = n(priorAgg._sum.disbursementsKobo ?? BigInt(0)) ?? 0;
    const variance = targetKobo > 0 ? (disbursedKobo - targetKobo) / targetKobo : 0;

    return {
      disbursedKobo,
      targetKobo,
      variance,
      disbursementCount,
      avgTicketKobo,
    };
  }

  /** Tool: get_staff_productivity */
  async getStaffProductivity(
    params: StaffProductivityParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>[]> {
    const periodDays = params.periodDays ?? 30;
    if (params.branchId) this.checkBranchScope(params.branchId, branchScope ?? null);

    const since = new Date(Date.now() - periodDays * 86400_000);

    const rows = await this.prisma.agentDailyMetrics.groupBy({
      by: ['agentId', 'agentName'],
      where: {
        snapshotDate: { gte: since },
        ...(params.branchId ? { branchId: params.branchId } : {}),
      },
      _sum: { casesHandled: true, ptpKept: true, amountRecoveredKobo: true },
      orderBy: { _sum: { casesHandled: 'desc' } },
      take: 10,
    });

    return rows.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      casesHandled: r._sum.casesHandled ?? 0,
      ptpKept: r._sum.ptpKept ?? 0,
      amountRecoveredKobo: n(r._sum.amountRecoveredKobo ?? BigInt(0)),
    }));
  }

  /** Tool: get_pending_approvals */
  async getPendingApprovals(
    params: PendingApprovalsParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>[]> {
    const where = params.actionType ? { type: params.actionType as never } : {};
    const pending = await this.prisma.approvalRequest.groupBy({
      by: ['type'],
      where: { ...where, status: 'PENDING' },
      _count: { id: true },
      _min: { createdAt: true },
    });

    const escalated = await this.prisma.approvalRequest.groupBy({
      by: ['type'],
      where: { ...where, status: 'ESCALATED' },
      _count: { id: true },
    });

    const escMap = new Map(escalated.map((e) => [e.type, e._count.id]));

    return pending.map((r) => {
      const oldest = r._min.createdAt;
      const avgAgeHours = oldest
        ? (Date.now() - oldest.getTime()) / 3600_000
        : 0;

      return {
        actionType: r.type,
        pendingCount: r._count.id,
        escalatedCount: escMap.get(r.type) ?? 0,
        avgAgeHours: Math.round(avgAgeHours),
        oldestPendingAt: oldest?.toISOString() ?? null,
      };
    });
  }

  /** Tool: get_anomalies */
  async getAnomalies(
    params: GetAnomaliesParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>[]> {
    const limit = params.limit ?? 20;
    const rows = await this.prisma.anomalyRecord.findMany({
      where: {
        status: 'OPEN',
        ...(params.severity ? { severity: params.severity as never } : {}),
      },
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      metric: r.metric,
      dimension: r.dimension,
      severity: r.severity,
      zScore: r.zScore,
      baseline: r.baseline,
      actual: r.actual,
      description: r.description,
      detectedAt: r.detectedAt.toISOString(),
    }));
  }

  /** Tool: compare_periods */
  async comparePeriods(
    params: ComparePeriodsParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>> {
    if (params.branchId) this.checkBranchScope(params.branchId, branchScope ?? null);

    const parseRange = (range: string): { start: Date; end: Date } => {
      const [s, e] = range.split('/');
      return { start: new Date(s), end: new Date(e) };
    };

    const a = parseRange(params.periodA);
    const b = parseRange(params.periodB);

    const getMetric = async (start: Date, end: Date): Promise<number | null> => {
      if (params.branchId) {
        const rows = await this.prisma.branchDailyMetrics.findMany({
          where: { branchId: params.branchId, snapshotDate: { gte: start, lte: end } },
        });
        if (!rows.length) return null;
        const key = params.metric as keyof (typeof rows)[0];
        const vals = rows.map((r) => r[key] as number).filter((v) => typeof v === 'number');
        return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      } else {
        const rows = await this.prisma.portfolioDailyMetrics.findMany({
          where: { snapshotDate: { gte: start, lte: end } },
        });
        if (!rows.length) return null;
        const key = params.metric as keyof (typeof rows)[0];
        const vals = rows.map((r) => r[key] as number).filter((v) => typeof v === 'number');
        return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      }
    };

    const [valueA, valueB] = await Promise.all([getMetric(a.start, a.end), getMetric(b.start, b.end)]);
    const change = valueA !== null && valueB !== null && valueA !== 0
      ? (valueB - valueA) / Math.abs(valueA)
      : null;

    return {
      metric: params.metric,
      periodA: { range: params.periodA, avg: valueA },
      periodB: { range: params.periodB, avg: valueB },
      changeRatio: change,
      changePercent: change !== null ? change * 100 : null,
    };
  }

  /** Tool: get_bureau_score_distribution */
  async getBureauScoreDistribution(
    params: BureauScoreDistributionParams,
    branchScope?: string | null,
  ): Promise<Record<string, unknown>[]> {
    const asOf = params.asOfDate ? new Date(params.asOfDate) : new Date();

    const rows = await this.prisma.bureauDistributionDaily.findMany({
      where: { snapshotDate: { lte: asOf } },
      orderBy: { snapshotDate: 'desc' },
      distinct: ['scoreBucket'],
    });

    return rows.map((r) => ({
      scoreBucket: r.scoreBucket,
      customerCount: r.customerCount,
      avgScore: r.avgScore,
      par30Ratio: r.par30Ratio,
    }));
  }

  /** Returns the Anthropic tool definitions for the executive tools. */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_portfolio_summary',
        description: 'Get portfolio-wide key metrics: outstanding balance, PAR ratios, NPL, ECL, collection efficiency.',
        input_schema: {
          type: 'object',
          properties: {
            asOfDate: { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to today.' },
            periodDays: { type: 'number', description: 'Lookback window in days for flow metrics. Default 30.' },
          },
        },
      },
      {
        name: 'get_par_by_branch',
        description: 'Get PAR-30, PAR-90 and NPL ratios broken down by branch.',
        input_schema: {
          type: 'object',
          properties: {
            asOfDate: { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to today.' },
            sortBy: { type: 'string', description: 'Sort branches by: par30 | par90 | npl.', enum: ['par30', 'par90', 'npl'] },
          },
        },
      },
      {
        name: 'get_npl_trend',
        description: 'Get historical NPL, PAR-30 and PAR-90 trend over a period.',
        input_schema: {
          type: 'object',
          properties: {
            periodDays: { type: 'number', description: 'Number of days to look back. Default 30.' },
            branchId: { type: 'string', description: 'Filter to a specific branch.' },
          },
        },
      },
      {
        name: 'get_collections_efficiency',
        description: 'Get collection efficiency metrics: PTP kept rate, broken rate, amount recovered.',
        input_schema: {
          type: 'object',
          properties: {
            branchId: { type: 'string', description: 'Filter to a specific branch.' },
            periodDays: { type: 'number', description: 'Lookback window in days. Default 30.' },
          },
        },
      },
      {
        name: 'get_disbursement_vs_target',
        description: 'Compare disbursements in the period against the prior period as a target baseline.',
        input_schema: {
          type: 'object',
          properties: {
            periodDays: { type: 'number', description: 'Period length in days. Default 30.' },
            branchId: { type: 'string', description: 'Filter to a specific branch.' },
          },
        },
      },
      {
        name: 'get_staff_productivity',
        description: 'Get top-10 collections staff by cases handled, PTP kept and amount recovered.',
        input_schema: {
          type: 'object',
          properties: {
            periodDays: { type: 'number', description: 'Lookback window in days. Default 30.' },
            branchId: { type: 'string', description: 'Filter to a specific branch.' },
          },
        },
      },
      {
        name: 'get_pending_approvals',
        description: 'Get pending approval requests grouped by action type with age information.',
        input_schema: {
          type: 'object',
          properties: {
            actionType: { type: 'string', description: 'Filter to a specific approval action type.' },
          },
        },
      },
      {
        name: 'get_anomalies',
        description: 'Get open detected anomalies, optionally filtered by severity.',
        input_schema: {
          type: 'object',
          properties: {
            severity: { type: 'string', description: 'Filter by severity: INFO | WARNING | CRITICAL.', enum: ['INFO', 'WARNING', 'CRITICAL'] },
            limit: { type: 'number', description: 'Max records to return. Default 20.' },
          },
        },
      },
      {
        name: 'compare_periods',
        description: 'Compare a portfolio metric between two date ranges.',
        input_schema: {
          type: 'object',
          properties: {
            metric: { type: 'string', description: 'Metric key (e.g. par30Ratio, nplRatio, collectionEfficiency).' },
            periodA: { type: 'string', description: 'First date range in YYYY-MM-DD/YYYY-MM-DD format.' },
            periodB: { type: 'string', description: 'Second date range in YYYY-MM-DD/YYYY-MM-DD format.' },
            branchId: { type: 'string', description: 'Filter to a specific branch.' },
          },
          required: ['metric', 'periodA', 'periodB'],
        },
      },
      {
        name: 'get_bureau_score_distribution',
        description: 'Get customer count and PAR-30 rate by credit bureau score bucket.',
        input_schema: {
          type: 'object',
          properties: {
            asOfDate: { type: 'string', description: 'ISO date (YYYY-MM-DD). Defaults to today.' },
          },
        },
      },
    ];
  }

  /** Dispatch a tool call by name. */
  async callTool(
    name: string,
    params: Record<string, unknown>,
    branchScope: string | null,
  ): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    switch (name) {
      case 'get_portfolio_summary':
        return this.getPortfolioSummary(params as PortfolioSummaryParams, branchScope);
      case 'get_par_by_branch':
        return this.getParByBranch(params as ParByBranchParams, branchScope);
      case 'get_npl_trend':
        return this.getNplTrend(params as NplTrendParams, branchScope);
      case 'get_collections_efficiency':
        return this.getCollectionsEfficiency(params as CollectionsEfficiencyParams, branchScope);
      case 'get_disbursement_vs_target':
        return this.getDisbursementVsTarget(params as DisbursementVsTargetParams, branchScope);
      case 'get_staff_productivity':
        return this.getStaffProductivity(params as StaffProductivityParams, branchScope);
      case 'get_pending_approvals':
        return this.getPendingApprovals(params as PendingApprovalsParams, branchScope);
      case 'get_anomalies':
        return this.getAnomalies(params as GetAnomaliesParams, branchScope);
      case 'compare_periods':
        return this.comparePeriods(params as unknown as ComparePeriodsParams, branchScope);
      case 'get_bureau_score_distribution':
        return this.getBureauScoreDistribution(params as BureauScoreDistributionParams, branchScope);
      default:
        throw new Error(`Unknown executive tool: ${name}`);
    }
  }
}
