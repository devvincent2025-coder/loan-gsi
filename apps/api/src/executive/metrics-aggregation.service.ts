import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetricsAggregationService {
  private readonly log = new Logger('MetricsAggregation');

  constructor(private readonly prisma: PrismaService) {}

  /** Aggregate portfolio-wide daily metrics. */
  async aggregatePortfolioDailyMetrics(date: Date): Promise<void> {
    const snapshotDate = startOfDay(date);
    const dayStart = snapshotDate;
    const dayEnd = new Date(dayStart.getTime() + 86400_000);

    // Active loans: status not in rejected / closed
    const activeStatuses: string[] = ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED'];
    const [activeCount, disbStats, par30Count, par90Count, repayData, disbToday] = await Promise.all([
      this.prisma.loan.count({ where: { status: { in: activeStatuses as never[] } } }),
      this.prisma.loan.aggregate({
        where: { status: { in: activeStatuses as never[] } },
        _sum: { principalKobo: true, outstandingPrincipalKobo: true },
        _count: { id: true },
      }),
      this.prisma.loan.count({ where: { status: { in: activeStatuses as never[] }, dpd: { gte: 30 } } }),
      this.prisma.loan.count({ where: { status: { in: activeStatuses as never[] }, dpd: { gte: 90 } } }),
      // Collection efficiency: repayments vs installments due in current month
      this.prisma.loanInstallment.aggregate({
        where: { dueDate: { lt: dayEnd } },
        _sum: { principalKobo: true, interestKobo: true },
      }),
      this.prisma.loan.findMany({
        where: {
          disbursedAt: { gte: dayStart, lt: dayEnd },
          status: { in: [...activeStatuses, 'WRITTEN_OFF', 'SETTLED'] as never[] },
        },
        select: { principalKobo: true },
      }),
    ]);

    const repaidData = await this.prisma.repayment.aggregate({
      where: { createdAt: { lt: dayEnd } },
      _sum: { amountKobo: true },
    });

    const totalDue = Number(repayData._sum.principalKobo ?? 0) + Number(repayData._sum.interestKobo ?? 0);
    const totalRepaid = Number(repaidData._sum.amountKobo ?? 0);
    const collectionEfficiency = totalDue > 0 ? Math.min(1, totalRepaid / totalDue) : 0;

    const disbursementsKobo = BigInt(disbToday.reduce((s, l) => s + Number(l.principalKobo), 0));

    const par30Ratio = activeCount > 0 ? par30Count / activeCount : 0;
    const par90Ratio = activeCount > 0 ? par90Count / activeCount : 0;
    const nplRatio = par90Ratio;

    // ECL: approximate as sum of outstanding for NPL loans
    const eclData = await this.prisma.loan.aggregate({
      where: { status: { in: activeStatuses as never[] }, dpd: { gte: 90 } },
      _sum: { outstandingPrincipalKobo: true },
    });
    const eclTotalKobo = (eclData._sum as { outstandingPrincipalKobo?: bigint | null }).outstandingPrincipalKobo ?? BigInt(0);

    const sumData = disbStats._sum as { outstandingPrincipalKobo?: bigint | null; principalKobo?: bigint | null };
    const totalOutstandingKobo = sumData.outstandingPrincipalKobo ?? BigInt(0);
    const totalDisbursedKobo = sumData.principalKobo ?? BigInt(0);
    const avgLoanAmountKobo = activeCount > 0
      ? BigInt(Math.round(Number(totalOutstandingKobo) / activeCount))
      : BigInt(0);

    await this.prisma.portfolioDailyMetrics.upsert({
      where: { snapshotDate },
      create: {
        snapshotDate,
        totalDisbursedKobo,
        totalOutstandingKobo,
        par30Ratio,
        par90Ratio,
        nplRatio,
        activeLoansCount: activeCount,
        disbursementsCount: disbToday.length,
        disbursementsKobo,
        collectionEfficiency,
        eclTotalKobo,
        avgLoanAmountKobo,
      },
      update: {
        totalDisbursedKobo,
        totalOutstandingKobo,
        par30Ratio,
        par90Ratio,
        nplRatio,
        activeLoansCount: activeCount,
        disbursementsCount: disbToday.length,
        disbursementsKobo,
        collectionEfficiency,
        eclTotalKobo,
        avgLoanAmountKobo,
      },
    });

    this.log.log(`Portfolio daily metrics aggregated for ${snapshotDate.toISOString().split('T')[0]}`);
  }

  /** Aggregate per-branch daily metrics. */
  async aggregateBranchDailyMetrics(date: Date): Promise<void> {
    const snapshotDate = startOfDay(date);
    const dayStart = snapshotDate;
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const activeStatuses = ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED'];

    const branches = await this.prisma.branch.findMany({ select: { id: true, name: true } });

    for (const branch of branches) {
      const [activeCount, disbToday, par30Count, par90Count, repayData, repaidData, agentsCount] = await Promise.all([
        this.prisma.loan.count({ where: { branchId: branch.id, status: { in: activeStatuses as never[] } } }),
        this.prisma.loan.findMany({
          where: { branchId: branch.id, disbursedAt: { gte: dayStart, lt: dayEnd } },
          select: { principalKobo: true },
        }),
        this.prisma.loan.count({ where: { branchId: branch.id, status: { in: activeStatuses as never[] }, dpd: { gte: 30 } } }),
        this.prisma.loan.count({ where: { branchId: branch.id, status: { in: activeStatuses as never[] }, dpd: { gte: 90 } } }),
        this.prisma.loanInstallment.aggregate({
          where: { loan: { branchId: branch.id }, dueDate: { lt: dayEnd } },
          _sum: { principalKobo: true, interestKobo: true },
        }),
        this.prisma.repayment.aggregate({
          where: { loan: { branchId: branch.id }, createdAt: { lt: dayEnd } },
          _sum: { amountKobo: true },
        }),
        this.prisma.staffUser.count({ where: { branchId: branch.id, status: 'ACTIVE' as never } }),
      ]);

      const outstandingData = await this.prisma.loan.aggregate({
        where: { branchId: branch.id, status: { in: activeStatuses as never[] } },
        _sum: { outstandingPrincipalKobo: true },
      });

      const par30Ratio = activeCount > 0 ? par30Count / activeCount : 0;
      const par90Ratio = activeCount > 0 ? par90Count / activeCount : 0;
      const nplRatio = par90Ratio;
      const repaySum = repayData._sum as { principalKobo?: bigint | null; interestKobo?: bigint | null };
      const repaidSum = repaidData._sum as { amountKobo?: bigint | null };
      const outstandingSum = outstandingData._sum as { outstandingPrincipalKobo?: bigint | null };
      const totalDue = Number(repaySum.principalKobo ?? 0) + Number(repaySum.interestKobo ?? 0);
      const totalRepaid = Number(repaidSum.amountKobo ?? 0);
      const collectionEfficiency = totalDue > 0 ? Math.min(1, totalRepaid / totalDue) : 0;
      const disbursementsKobo = BigInt(disbToday.reduce((s, l) => s + Number(l.principalKobo), 0));
      const outstandingKobo = outstandingSum.outstandingPrincipalKobo ?? BigInt(0);

      await this.prisma.branchDailyMetrics.upsert({
        where: { snapshotDate_branchId: { snapshotDate, branchId: branch.id } },
        create: {
          snapshotDate,
          branchId: branch.id,
          branchName: branch.name,
          activeLoansCount: activeCount,
          disbursementsKobo,
          disbursementsCount: disbToday.length,
          outstandingKobo,
          par30Ratio,
          par90Ratio,
          nplRatio,
          collectionEfficiency,
          agentsCount,
        },
        update: {
          branchName: branch.name,
          activeLoansCount: activeCount,
          disbursementsKobo,
          disbursementsCount: disbToday.length,
          outstandingKobo,
          par30Ratio,
          par90Ratio,
          nplRatio,
          collectionEfficiency,
          agentsCount,
        },
      });
    }

    this.log.log(`Branch daily metrics aggregated for ${snapshotDate.toISOString().split('T')[0]} (${branches.length} branches)`);
  }

  /** Aggregate per-agent daily metrics. */
  async aggregateAgentDailyMetrics(date: Date): Promise<void> {
    const snapshotDate = startOfDay(date);
    const dayStart = snapshotDate;
    const dayEnd = new Date(dayStart.getTime() + 86400_000);

    // Group CollectionActivity by agentId for the day
    const activities = await this.prisma.collectionActivity.findMany({
      where: { contactedAt: { gte: dayStart, lt: dayEnd }, agentId: { not: null } },
      select: { agentId: true, agentName: true, caseId: true, outcome: true },
    });

    const ptpsCreated = await this.prisma.promiseToPay.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      select: { caseId: true },
    });

    const ptpCaseSet = new Set(ptpsCreated.map((p) => p.caseId));

    const agentMap = new Map<string, {
      agentId: string;
      agentName: string;
      cases: Set<string>;
      ptpCreated: number;
      ptpKept: number;
      calls: number;
      amountRecoveredKobo: number;
    }>();

    for (const act of activities) {
      if (!act.agentId) continue;
      if (!agentMap.has(act.agentId)) {
        agentMap.set(act.agentId, {
          agentId: act.agentId,
          agentName: act.agentName,
          cases: new Set(),
          ptpCreated: 0,
          ptpKept: 0,
          calls: 0,
          amountRecoveredKobo: 0,
        });
      }
      const entry = agentMap.get(act.agentId)!;
      entry.cases.add(act.caseId);
      entry.calls++;
      if (ptpCaseSet.has(act.caseId)) entry.ptpCreated++;
      if (act.outcome === 'PAYMENT_MADE' || act.outcome === 'PARTIAL_PAYMENT') entry.ptpKept++;
    }

    // Get agent branch associations
    const agentIds = [...agentMap.keys()];
    const staffUsers = await this.prisma.staffUser.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, branchId: true },
    });
    const branchByAgent = new Map(staffUsers.map((s) => [s.id, s.branchId ?? '']));

    for (const [agentId, data] of agentMap.entries()) {
      const branchId = branchByAgent.get(agentId) ?? '';

      await this.prisma.agentDailyMetrics.upsert({
        where: { snapshotDate_agentId: { snapshotDate, agentId } },
        create: {
          snapshotDate,
          agentId,
          agentName: data.agentName,
          branchId,
          casesHandled: data.cases.size,
          ptpCreated: data.ptpCreated,
          ptpKept: data.ptpKept,
          amountRecoveredKobo: BigInt(data.amountRecoveredKobo),
          callsMade: data.calls,
        },
        update: {
          agentName: data.agentName,
          branchId,
          casesHandled: data.cases.size,
          ptpCreated: data.ptpCreated,
          ptpKept: data.ptpKept,
          amountRecoveredKobo: BigInt(data.amountRecoveredKobo),
          callsMade: data.calls,
        },
      });
    }

    this.log.log(`Agent daily metrics aggregated for ${snapshotDate.toISOString().split('T')[0]} (${agentMap.size} agents)`);
  }

  /** Aggregate per-product daily metrics. */
  async aggregateProductDailyMetrics(date: Date): Promise<void> {
    const snapshotDate = startOfDay(date);
    const dayStart = snapshotDate;
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const activeStatuses: string[] = ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED'];

    const products = await this.prisma.loanProduct.findMany({ select: { id: true, name: true } });

    for (const product of products) {
      const [activeCount, par30Count, nplCount, aggData, disbToday] = await Promise.all([
        this.prisma.loan.count({ where: { productId: product.id, status: { in: activeStatuses as never[] } } }),
        this.prisma.loan.count({ where: { productId: product.id, status: { in: activeStatuses as never[] }, dpd: { gte: 30 } } }),
        this.prisma.loan.count({ where: { productId: product.id, status: { in: activeStatuses as never[] }, dpd: { gte: 90 } } }),
        this.prisma.loan.aggregate({
          where: { productId: product.id, status: { in: activeStatuses as never[] } },
          _sum: { outstandingPrincipalKobo: true, principalKobo: true },
        }),
        this.prisma.loan.findMany({
          where: { productId: product.id, disbursedAt: { gte: dayStart, lt: dayEnd } },
          select: { principalKobo: true },
        }),
      ]);

      const par30Ratio = activeCount > 0 ? par30Count / activeCount : 0;
      const nplRatio = activeCount > 0 ? nplCount / activeCount : 0;
      const aggSum = aggData._sum as { outstandingPrincipalKobo?: bigint | null; principalKobo?: bigint | null };
      const outstandingKobo = aggSum.outstandingPrincipalKobo ?? BigInt(0);
      const disbursedKobo = BigInt(disbToday.reduce((s, l) => s + Number(l.principalKobo), 0));
      const avgTicketKobo = activeCount > 0
        ? BigInt(Math.round(Number(outstandingKobo) / activeCount))
        : BigInt(0);

      await this.prisma.productDailyMetrics.upsert({
        where: { snapshotDate_productId: { snapshotDate, productId: product.id } },
        create: {
          snapshotDate,
          productId: product.id,
          productName: product.name,
          activeLoansCount: activeCount,
          disbursedKobo,
          outstandingKobo,
          par30Ratio,
          nplRatio,
          avgTicketKobo,
        },
        update: {
          productName: product.name,
          activeLoansCount: activeCount,
          disbursedKobo,
          outstandingKobo,
          par30Ratio,
          nplRatio,
          avgTicketKobo,
        },
      });
    }

    this.log.log(`Product daily metrics aggregated for ${snapshotDate.toISOString().split('T')[0]} (${products.length} products)`);
  }

  /** Aggregate collections daily metrics. */
  async aggregateCollectionsDaily(date: Date): Promise<void> {
    const snapshotDate = startOfDay(date);
    const dayStart = snapshotDate;
    const dayEnd = new Date(dayStart.getTime() + 86400_000);

    const [openCount, resolvedCount, ptps, recovered, agencyCount] = await Promise.all([
      this.prisma.collectionCase.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'PROMISE_TO_PAY', 'LEGAL', 'AGENCY'] } } }),
      this.prisma.collectionCase.count({ where: { closedAt: { gte: dayStart, lt: dayEnd }, status: { in: ['CLOSED', 'SETTLED'] } } }),
      this.prisma.promiseToPay.findMany({
        where: { promisedDate: { lt: dayEnd } },
        select: { status: true },
      }),
      this.prisma.collectionActivity.aggregate({
        where: { contactedAt: { gte: dayStart, lt: dayEnd }, outcome: { in: ['PAYMENT_MADE', 'PARTIAL_PAYMENT'] } },
        _count: { id: true },
      }),
      this.prisma.collectionCase.count({ where: { status: 'AGENCY', updatedAt: { gte: dayStart, lt: dayEnd } } }),
    ]);

    const ptpTotal = ptps.length;
    const ptpKept = ptps.filter((p) => p.status === 'KEPT').length;
    const ptpBroken = ptps.filter((p) => p.status === 'BROKEN').length;
    const ptpKeptRate = ptpTotal > 0 ? ptpKept / ptpTotal : 0;
    const ptpBrokenRate = ptpTotal > 0 ? ptpBroken / ptpTotal : 0;

    // branchId is nullable; upsert via find-then-update/create to avoid null key issues in MySQL
    const existingColl = await this.prisma.collectionsDaily.findFirst({
      where: { snapshotDate, branchId: null },
    });
    if (existingColl) {
      await this.prisma.collectionsDaily.update({
        where: { id: existingColl.id },
        data: {
          openCasesCount: openCount,
          resolvedCasesCount: resolvedCount,
          ptpKeptRate,
          ptpBrokenRate,
          agencyAssignedCount: agencyCount,
        },
      });
    } else {
      await this.prisma.collectionsDaily.create({
        data: {
          snapshotDate,
          branchId: null,
          openCasesCount: openCount,
          resolvedCasesCount: resolvedCount,
          ptpKeptRate,
          ptpBrokenRate,
          amountRecoveredKobo: BigInt(0),
          agencyAssignedCount: agencyCount,
        },
      });
    }

    this.log.log(`Collections daily aggregated for ${snapshotDate.toISOString().split('T')[0]}`);
  }

  /** Aggregate debit attempt daily metrics grouped by bankCode (via linkedAccount). */
  async aggregateDebitDaily(date: Date): Promise<void> {
    const snapshotDate = startOfDay(date);
    const dayStart = snapshotDate;
    const dayEnd = new Date(dayStart.getTime() + 86400_000);

    const attempts = await this.prisma.debitAttempt.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      select: {
        status: true,
        amountKobo: true,
        method: true,
        linkedAccount: { select: { bankCode: true } },
      },
    });

    const bankMap = new Map<string, {
      total: number;
      success: number;
      failure: number;
      successKobo: number;
      failureKobo: number;
      gsi: number;
    }>();

    for (const a of attempts) {
      const key = a.linkedAccount?.bankCode ?? '__unknown__';
      if (!bankMap.has(key)) {
        bankMap.set(key, { total: 0, success: 0, failure: 0, successKobo: 0, failureKobo: 0, gsi: 0 });
      }
      const entry = bankMap.get(key)!;
      entry.total++;
      if (a.status === 'SUCCESS' || a.status === 'PARTIAL') {
        entry.success++;
        entry.successKobo += Number(a.amountKobo);
      } else if (a.status === 'FAILED' || a.status === 'CANCELLED') {
        entry.failure++;
        entry.failureKobo += Number(a.amountKobo);
      }
      if (a.method === 'GSI') entry.gsi++;
    }

    for (const [bankCode, data] of bankMap.entries()) {
      const rawBankCode = bankCode === '__unknown__' ? null : bankCode;

      if (rawBankCode === null) {
        // Handle null bankCode: find-then-update/create
        const existing = await this.prisma.debitDaily.findFirst({ where: { snapshotDate, bankCode: null } });
        if (existing) {
          await this.prisma.debitDaily.update({
            where: { id: existing.id },
            data: { totalAttempts: data.total, successCount: data.success, failureCount: data.failure, successAmountKobo: BigInt(data.successKobo), failureAmountKobo: BigInt(data.failureKobo), gsiTriggeredCount: data.gsi },
          });
        } else {
          await this.prisma.debitDaily.create({
            data: { snapshotDate, bankCode: null, totalAttempts: data.total, successCount: data.success, failureCount: data.failure, successAmountKobo: BigInt(data.successKobo), failureAmountKobo: BigInt(data.failureKobo), gsiTriggeredCount: data.gsi },
          });
        }
      } else {
        await this.prisma.debitDaily.upsert({
          where: { snapshotDate_bankCode: { snapshotDate, bankCode: rawBankCode } },
          create: {
            snapshotDate,
            bankCode: rawBankCode,
            totalAttempts: data.total,
            successCount: data.success,
            failureCount: data.failure,
            successAmountKobo: BigInt(data.successKobo),
            failureAmountKobo: BigInt(data.failureKobo),
            gsiTriggeredCount: data.gsi,
          },
          update: {
            totalAttempts: data.total,
            successCount: data.success,
            failureCount: data.failure,
            successAmountKobo: BigInt(data.successKobo),
            failureAmountKobo: BigInt(data.failureKobo),
            gsiTriggeredCount: data.gsi,
          },
        });
      }
    }

    this.log.log(`Debit daily metrics aggregated for ${snapshotDate.toISOString().split('T')[0]} (${bankMap.size} banks)`);
  }

  /** Aggregate bureau score distribution into buckets. */
  async aggregateBureauDistribution(date: Date): Promise<void> {
    const snapshotDate = startOfDay(date);
    const activeStatuses: string[] = ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED'];

    // Score buckets: 300-399, 400-499, 500-599, 600-699, 700-799, 800-850
    const buckets = [
      { label: '300-399', min: 300, max: 399 },
      { label: '400-499', min: 400, max: 499 },
      { label: '500-599', min: 500, max: 599 },
      { label: '600-699', min: 600, max: 699 },
      { label: '700-799', min: 700, max: 799 },
      { label: '800-850', min: 800, max: 850 },
    ];

    for (const bucket of buckets) {
      // BureauScore doesn't have customerId; join via BureauReport
      const reports = await this.prisma.bureauReport.findMany({
        where: { scores: { some: { score: { gte: bucket.min, lte: bucket.max } } } },
        select: { customerId: true, bestScore: true },
        distinct: ['customerId'],
      });

      const customerIds = reports.map((r) => r.customerId);
      const [nplCount, activeCount] = await Promise.all([
        this.prisma.loan.count({ where: { customerId: { in: customerIds }, status: { in: activeStatuses as never[] }, dpd: { gte: 30 } } }),
        this.prisma.loan.count({ where: { customerId: { in: customerIds }, status: { in: activeStatuses as never[] } } }),
      ]);

      const par30Ratio = activeCount > 0 ? nplCount / activeCount : 0;
      const scores = reports.filter((r) => r.bestScore !== null);
      const avgScore = scores.length > 0
        ? scores.reduce((s, r) => s + (r.bestScore ?? 0), 0) / scores.length
        : 0;

      await this.prisma.bureauDistributionDaily.upsert({
        where: { snapshotDate_scoreBucket: { snapshotDate, scoreBucket: bucket.label } },
        create: {
          snapshotDate,
          scoreBucket: bucket.label,
          customerCount: reports.length,
          avgScore,
          par30Ratio,
        },
        update: {
          customerCount: reports.length,
          avgScore,
          par30Ratio,
        },
      });
    }

    this.log.log(`Bureau distribution aggregated for ${snapshotDate.toISOString().split('T')[0]}`);
  }

  /** Run all aggregations for the given date (default: yesterday). */
  async runAll(date?: Date): Promise<{ date: string; completed: string[]; errors: string[] }> {
    const target = date ?? yesterday();
    const label = target.toISOString().split('T')[0];
    const completed: string[] = [];
    const errors: string[] = [];

    const steps: Array<{ name: string; fn: () => Promise<void> }> = [
      { name: 'portfolio', fn: () => this.aggregatePortfolioDailyMetrics(target) },
      { name: 'branch', fn: () => this.aggregateBranchDailyMetrics(target) },
      { name: 'agent', fn: () => this.aggregateAgentDailyMetrics(target) },
      { name: 'product', fn: () => this.aggregateProductDailyMetrics(target) },
      { name: 'collections', fn: () => this.aggregateCollectionsDaily(target) },
      { name: 'debit', fn: () => this.aggregateDebitDaily(target) },
      { name: 'bureau', fn: () => this.aggregateBureauDistribution(target) },
    ];

    for (const step of steps) {
      try {
        await step.fn();
        completed.push(step.name);
      } catch (err) {
        this.log.error(`Aggregation step '${step.name}' failed: ${(err as Error).message}`);
        errors.push(`${step.name}: ${(err as Error).message}`);
      }
    }

    return { date: label, completed, errors };
  }
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function yesterday(): Date {
  return startOfDay(new Date(Date.now() - 86400_000));
}
