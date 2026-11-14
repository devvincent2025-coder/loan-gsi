import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { LoanStatus } from '@prisma/client';
import {
  BehaviourPortfolioDto,
  BehaviourSnapshotDto,
  CollectionChannel,
  CustomerSegment,
  EarlyWarningFlagDto,
  maskName,
  Page,
  pageQuerySchema,
} from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { paged, skipTake } from '../common/pagination';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class BehaviourSnapshotService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async computeSnapshot(customerId: string): Promise<BehaviourSnapshotDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const loans = await this.prisma.loan.findMany({ where: { customerId } });
    const loanIds = loans.map((l) => l.id);

    const [repayments, installments, debitAttempts, collectionCases] = loanIds.length > 0
      ? await Promise.all([
          this.prisma.repayment.findMany({ where: { loanId: { in: loanIds } }, orderBy: { createdAt: 'desc' } }),
          this.prisma.loanInstallment.findMany({ where: { loanId: { in: loanIds } } }),
          this.prisma.debitAttempt.findMany({ where: { loanId: { in: loanIds } }, orderBy: { scheduledFor: 'desc' } }),
          this.prisma.collectionCase.findMany({
            where: { loanId: { in: loanIds } },
            include: { activities: { orderBy: { contactedAt: 'desc' } } },
          }),
        ])
      : [[], [], [], []];

    const totalRepayments = repayments.length;

    // onTimeRatio: count repayments made on or before the matching installment due date
    let onTimeCount = 0;
    if (totalRepayments > 0 && installments.length > 0) {
      for (const r of repayments) {
        const loanInsts = installments
          .filter((i) => i.loanId === r.loanId)
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        const matching = loanInsts.find((i) => r.createdAt <= i.dueDate);
        if (matching) onTimeCount++;
      }
    }
    const onTimeRatio = totalRepayments > 0 ? onTimeCount / totalRepayments : 1;

    // avgDaysLate
    const UnpaidLoans = loans.filter((l) => l.dpd > 0);
    const avgDaysLate =
      UnpaidLoans.length > 0
        ? UnpaidLoans.reduce((s, l) => s + l.dpd, 0) / UnpaidLoans.length
        : 0;

    // paydaySensitivity
    let paydaySensitivity = 0;
    if (customer.salaryDay && totalRepayments > 0) {
      const paydayOnTime = repayments.filter((r) => {
        const day = new Date(r.createdAt).getDate();
        return Math.abs(day - customer.salaryDay!) <= 5;
      }).length;
      paydaySensitivity = paydayOnTime / totalRepayments;
    }

    // channelResponsiveness
    const allActivities = (collectionCases as Array<{ activities: Array<{ outcome: string; channel: string; contactedAt: Date }> }>)
      .flatMap((c) => c.activities)
      .sort((a, b) => b.contactedAt.getTime() - a.contactedAt.getTime());

    const positiveOutcomes = new Set(['SPOKE_TO_BORROWER', 'PROMISE_TO_PAY', 'PAYMENT_MADE']);
    let channelResponsiveness = 0;
    if (allActivities.length > 0) {
      let score = 1.0;
      for (const act of allActivities) {
        if (positiveOutcomes.has(act.outcome)) {
          channelResponsiveness = score;
          break;
        }
        score = Math.max(0, score - 0.1);
      }
    }

    // partialPaymentRatio
    let partialCount = 0;
    if (totalRepayments > 0 && installments.length > 0) {
      for (const r of repayments) {
        const loanInsts = installments.filter((i) => i.loanId === r.loanId);
        if (loanInsts.length > 0) {
          const avgInstAmount =
            loanInsts.reduce((s, i) => s + Number(i.principalKobo) + Number(i.interestKobo) + Number(i.feeKobo), 0) /
            loanInsts.length;
          if (Number(r.amountKobo) < avgInstAmount * 0.95) partialCount++;
        }
      }
    }
    const partialPaymentRatio = totalRepayments > 0 ? partialCount / totalRepayments : 0;

    // avgBalanceAtDebitKobo
    const completedDebits = debitAttempts.filter((d) => d.collectedKobo > 0n);
    const avgBalanceAtDebitKobo =
      completedDebits.length > 0
        ? completedDebits.reduce((s, d) => s + Number(d.collectedKobo), 0) / completedDebits.length
        : 0;

    // repeatBorrowVelocity
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    const recentLoans = loans.filter((l) => l.disbursedAt >= twelveMonthsAgo);
    const repeatBorrowVelocity = recentLoans.length / 12;

    // bureauDefaultCount
    const bureauDefaultCount = loans.filter((l) => l.dpd > 90 || l.status === LoanStatus.WRITTEN_OFF).length;

    // pdScore
    const pdScore = Math.max(
      0,
      Math.min(
        1,
        0.3 * (1 - onTimeRatio) +
          0.2 * Math.min(avgDaysLate / 90, 1) +
          0.2 * Math.min(bureauDefaultCount / 3, 1) +
          0.15 * partialPaymentRatio +
          0.15 * (1 - paydaySensitivity),
      ),
    );

    // segment
    let segment: CustomerSegment = 'UNKNOWN';
    if (pdScore < 0.2 && onTimeRatio > 0.8) {
      segment = 'RELIABLE';
    } else if (paydaySensitivity > 0.6 && onTimeRatio > 0.5) {
      segment = 'SALARY_CYCLE_PAYER';
    } else if (channelResponsiveness < 0.3) {
      segment = 'RELUCTANT';
    } else if (pdScore > 0.7 || bureauDefaultCount > 1) {
      segment = 'HIGH_RISK';
    } else if (repeatBorrowVelocity < 0.1 && onTimeRatio > 0.7) {
      segment = 'AT_RISK_OF_CHURN';
    }

    const summaryText = this.buildSummary({ onTimeRatio, avgDaysLate, pdScore, paydaySensitivity, channelResponsiveness, segment });

    // bestContactChannel
    let bestContactChannel: CollectionChannel = 'SMS';
    if (channelResponsiveness > 0.5) {
      bestContactChannel = 'PHONE_CALL';
    } else {
      const lastAct = allActivities[0];
      if (lastAct && lastAct.channel === 'WHATSAPP' && positiveOutcomes.has(lastAct.outcome)) {
        bestContactChannel = 'WHATSAPP';
      }
    }

    // bestContactTime
    let bestContactTime = 'Weekday morning';
    if (customer.salaryDay) {
      const dayOfMonth = today.getDate();
      if (Math.abs(dayOfMonth - customer.salaryDay) <= 5) {
        bestContactTime = 'Around payday';
      }
    }

    const snapshotData = {
      customerId,
      snapshotDate: today,
      onTimeRatio,
      avgDaysLate,
      paydaySensitivity,
      channelResponsiveness,
      partialPaymentRatio,
      avgBalanceAtDebitKobo: BigInt(Math.round(avgBalanceAtDebitKobo)),
      repeatBorrowVelocity,
      bureauDefaultCount,
      pdScore,
      segment,
      summaryText,
    };

    const snap = await this.prisma.behaviourSnapshot.upsert({
      where: { customerId_snapshotDate: { customerId, snapshotDate: today } },
      create: snapshotData,
      update: snapshotData,
    });

    return this.toDto(snap, { bestContactChannel, bestContactTime });
  }

  private buildSummary(facts: {
    onTimeRatio: number;
    avgDaysLate: number;
    pdScore: number;
    paydaySensitivity: number;
    channelResponsiveness: number;
    segment: CustomerSegment;
  }): string {
    const repaymentDesc =
      facts.onTimeRatio > 0.8
        ? 'an excellent on-time repayment record'
        : facts.onTimeRatio > 0.5
          ? 'a moderate repayment history with some delays'
          : 'a poor on-time repayment record with frequent late payments';
    const behaviourDesc =
      facts.paydaySensitivity > 0.6
        ? 'They tend to pay around payday, showing salary-cycle dependency.'
        : facts.channelResponsiveness > 0.5
          ? 'They are generally responsive to collection contacts.'
          : 'They show low responsiveness to collection outreach.';
    const riskNote =
      facts.pdScore < 0.2
        ? 'Overall risk is low.'
        : facts.pdScore < 0.5
          ? 'Moderate credit risk; monitor closely.'
          : 'Elevated credit risk; prioritise early intervention.';
    return `This customer has ${repaymentDesc}. ${behaviourDesc} ${riskNote}`;
  }

  async getLatestSnapshot(customerId: string): Promise<BehaviourSnapshotDto | null> {
    const snap = await this.prisma.behaviourSnapshot.findFirst({
      where: { customerId },
      orderBy: { snapshotDate: 'desc' },
    });
    return snap ? this.toDto(snap) : null;
  }

  async getSnapshotHistory(customerId: string, days: number): Promise<BehaviourSnapshotDto[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const snaps = await this.prisma.behaviourSnapshot.findMany({
      where: { customerId, snapshotDate: { gte: since } },
      orderBy: { snapshotDate: 'desc' },
    });
    return snaps.map((s) => this.toDto(s));
  }

  async runBatchSnapshots(): Promise<{ computed: number; errors: number }> {
    const activeStatuses: LoanStatus[] = [
      LoanStatus.DISBURSED, LoanStatus.ACTIVE, LoanStatus.Unpaid, LoanStatus.RESTRUCTURED,
    ];
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const customerRows = await this.prisma.loan.findMany({
      where: {
        OR: [{ status: { in: activeStatuses } }, { closedAt: { gte: ninetyDaysAgo } }],
      },
      select: { customerId: true },
      distinct: ['customerId'],
    });

    let computed = 0;
    let errors = 0;
    for (const { customerId } of customerRows) {
      try {
        await this.computeSnapshot(customerId);
        computed++;
      } catch {
        errors++;
      }
    }
    return { computed, errors };
  }

  async portfolioStats(): Promise<BehaviourPortfolioDto> {
    const snaps = await this.prisma.behaviourSnapshot.findMany({
      orderBy: [{ customerId: 'asc' }, { snapshotDate: 'desc' }],
      distinct: ['customerId'],
      select: { customerId: true, segment: true, pdScore: true },
    });

    const totalCustomers = snaps.length;
    const bySegment: Record<CustomerSegment, number> = {
      RELIABLE: 0, SALARY_CYCLE_PAYER: 0, RELUCTANT: 0, HIGH_RISK: 0, AT_RISK_OF_CHURN: 0, UNKNOWN: 0,
    };
    let pdSum = 0;
    for (const s of snaps) {
      const seg = s.segment as CustomerSegment;
      if (seg in bySegment) bySegment[seg]++;
      pdSum += s.pdScore;
    }
    const avgPdScore = totalCustomers > 0 ? pdSum / totalCustomers : 0;

    const earlyWarnings = await this.prisma.earlyWarningFlag.count({ where: { status: 'OPEN' } });

    // rollRate30d / cureRate30d: compare each loan's earliest vs latest IFRS stage snapshot
    // within the last 30 days. Roll = moved to a worse stage; Cure = moved to a better stage.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const stagingSnapshots = await this.prisma.loanStagingSnapshot.findMany({
      where: { asOfDate: { gte: thirtyDaysAgo } },
      select: { loanId: true, stage: true, asOfDate: true },
      orderBy: { asOfDate: 'asc' },
    });

    // Group by loanId — ordered asc so first entry is earliest, last is latest
    const stageByLoan = new Map<string, { first: number; last: number }>();
    for (const snap of stagingSnapshots) {
      const existing = stageByLoan.get(snap.loanId);
      if (!existing) {
        stageByLoan.set(snap.loanId, { first: snap.stage, last: snap.stage });
      } else {
        existing.last = snap.stage;
      }
    }

    let rolled = 0, cured = 0;
    for (const { first, last } of stageByLoan.values()) {
      if (last > first) rolled++;
      else if (last < first) cured++;
    }
    const loansTracked = stageByLoan.size;
    const rollRate30d = loansTracked > 0 ? rolled / loansTracked : 0;
    const cureRate30d = loansTracked > 0 ? cured / loansTracked : 0;

    // segmentTrend: last 30 days
    const trendSnaps = await this.prisma.behaviourSnapshot.findMany({
      where: { snapshotDate: { gte: thirtyDaysAgo } },
      select: { snapshotDate: true, segment: true },
      orderBy: { snapshotDate: 'asc' },
    });
    const trendMap = new Map<string, Record<CustomerSegment, number>>();
    for (const s of trendSnaps) {
      const day = s.snapshotDate.toISOString().slice(0, 10);
      if (!trendMap.has(day)) {
        trendMap.set(day, { RELIABLE: 0, SALARY_CYCLE_PAYER: 0, RELUCTANT: 0, HIGH_RISK: 0, AT_RISK_OF_CHURN: 0, UNKNOWN: 0 });
      }
      const seg = s.segment as CustomerSegment;
      trendMap.get(day)![seg]++;
    }
    const segmentTrend: { date: string; segment: CustomerSegment; count: number }[] = [];
    for (const [date, counts] of trendMap.entries()) {
      for (const [seg, count] of Object.entries(counts)) {
        if (count > 0) segmentTrend.push({ date, segment: seg as CustomerSegment, count });
      }
    }

    return { totalCustomers, bySegment, avgPdScore, earlyWarnings, rollRate30d, cureRate30d, segmentTrend };
  }

  async listEarlyWarnings(
    user: AuthUser,
    q: { page: number; pageSize: number; status?: string },
  ): Promise<Page<EarlyWarningFlagDto>> {
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(user.branchScoped && !user.allBranches && user.branchId
        ? { loan: { branchId: user.branchId } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.earlyWarningFlag.findMany({
        where,
        orderBy: { flagDate: 'desc' },
        ...skipTake(q.page, q.pageSize),
      }),
      this.prisma.earlyWarningFlag.count({ where }),
    ]);

    // Fetch customers and loans for masking
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const loanIds = [...new Set(rows.map((r) => r.loanId))];
    const [customers, loans] = await Promise.all([
      customerIds.length > 0
        ? this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, firstName: true, lastName: true } })
        : [],
      loanIds.length > 0
        ? this.prisma.loan.findMany({ where: { id: { in: loanIds } }, select: { id: true, reference: true } })
        : [],
    ]);
    const custMap = new Map(customers.map((c) => [c.id, c]));
    const loanMap = new Map(loans.map((l) => [l.id, l]));

    return paged(
      rows.map((r) => {
        const c = custMap.get(r.customerId);
        const l = loanMap.get(r.loanId);
        return {
          id: r.id,
          customerId: r.customerId,
          customerName: c ? maskName(`${c.firstName} ${c.lastName}`) : 'Unknown',
          loanId: r.loanId,
          loanReference: l?.reference ?? r.loanId,
          flagDate: r.flagDate.toISOString(),
          pdScore: r.pdScore,
          triggerReason: r.triggerReason,
          status: r.status,
          actionTakenAt: r.actionTakenAt?.toISOString() ?? null,
          actionNote: r.actionNote,
          createdAt: r.createdAt.toISOString(),
        } satisfies EarlyWarningFlagDto;
      }),
      total,
      q.page,
      q.pageSize,
    );
  }

  async computeEarlyWarnings(): Promise<{ flagged: number }> {
    const activeStatuses: LoanStatus[] = [
      LoanStatus.DISBURSED, LoanStatus.ACTIVE, LoanStatus.Unpaid, LoanStatus.RESTRUCTURED,
    ];
    const loans = await this.prisma.loan.findMany({
      where: { status: { in: activeStatuses } },
      select: { id: true, customerId: true },
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let flagged = 0;

    for (const loan of loans) {
      const snap = await this.getLatestSnapshot(loan.customerId);
      if (!snap || snap.pdScore <= 0.5) continue;
      const existing = await this.prisma.earlyWarningFlag.findFirst({
        where: { loanId: loan.id, status: 'OPEN' },
      });
      if (existing) continue;
      await this.prisma.earlyWarningFlag.create({
        data: {
          customerId: loan.customerId,
          loanId: loan.id,
          flagDate: today,
          pdScore: snap.pdScore,
          triggerReason: `PD score ${snap.pdScore.toFixed(2)} exceeds 0.5 threshold`,
          status: 'OPEN',
        },
      });
      flagged++;
    }
    return { flagged };
  }

  async acknowledgeWarning(user: AuthUser, flagId: string, note: string): Promise<void> {
    const flag = await this.prisma.earlyWarningFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Early warning flag not found');

    await this.prisma.earlyWarningFlag.update({
      where: { id: flagId },
      data: { status: 'ACTIONED', actionTakenAt: new Date(), actionNote: note },
    });

    await this.audit.record({
      action: 'earlyWarning.acknowledged',
      resourceType: 'EarlyWarningFlag',
      resourceId: flagId,
      metadata: { note },
    });
  }

  private toDto(
    snap: {
      id: string;
      customerId: string;
      snapshotDate: Date;
      onTimeRatio: number;
      avgDaysLate: number;
      paydaySensitivity: number;
      channelResponsiveness: number;
      partialPaymentRatio: number;
      avgBalanceAtDebitKobo: bigint;
      repeatBorrowVelocity: number;
      bureauDefaultCount: number;
      pdScore: number;
      segment: string;
      summaryText: string;
    },
    extra?: { bestContactChannel: CollectionChannel; bestContactTime: string },
  ): BehaviourSnapshotDto {
    const bestContactChannel: CollectionChannel =
      extra?.bestContactChannel ?? (snap.channelResponsiveness > 0.5 ? 'PHONE_CALL' : 'SMS');
    const bestContactTime: string = extra?.bestContactTime ?? 'Weekday morning';
    return {
      id: snap.id,
      customerId: snap.customerId,
      snapshotDate: snap.snapshotDate.toISOString(),
      onTimeRatio: snap.onTimeRatio,
      avgDaysLate: snap.avgDaysLate,
      paydaySensitivity: snap.paydaySensitivity,
      channelResponsiveness: snap.channelResponsiveness,
      partialPaymentRatio: snap.partialPaymentRatio,
      avgBalanceAtDebitKobo: Number(snap.avgBalanceAtDebitKobo),
      repeatBorrowVelocity: snap.repeatBorrowVelocity,
      bureauDefaultCount: snap.bureauDefaultCount,
      pdScore: snap.pdScore,
      segment: snap.segment as CustomerSegment,
      summaryText: snap.summaryText,
      bestContactChannel,
      bestContactTime,
    };
  }
}

// ─── Controller ───────────────────────────────────────────────────────────────

const warningQuerySchema = pageQuerySchema.extend({ status: z.string().optional() });
const acknowledgeSchema = z.object({ note: z.string().min(1).max(500) });

@Controller()
class BehaviourController {
  constructor(private svc: BehaviourSnapshotService) {}

  @Get('behaviour/portfolio')
  @RequirePermission('behavioural:read')
  portfolio() {
    return this.svc.portfolioStats();
  }

  @Get('behaviour/early-warnings')
  @RequirePermission('behavioural:read')
  listWarnings(
    @CurrentUser() u: AuthUser,
    @Query(new ZodPipe(warningQuerySchema)) q: z.infer<typeof warningQuerySchema>,
  ) {
    return this.svc.listEarlyWarnings(u, q);
  }

  @Post('behaviour/early-warnings/:id/acknowledge')
  @RequirePermission('collections:update')
  acknowledge(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(acknowledgeSchema)) body: z.infer<typeof acknowledgeSchema>,
  ) {
    return this.svc.acknowledgeWarning(u, id, body.note);
  }

  @Get('behaviour/customers/:customerId/snapshot')
  @RequirePermission('behavioural:read')
  getSnapshot(@Param('customerId') customerId: string) {
    return this.svc.getLatestSnapshot(customerId);
  }

  @Post('behaviour/customers/:customerId/snapshot')
  @RequirePermission('behavioural:read')
  computeSnapshot(@Param('customerId') customerId: string) {
    return this.svc.computeSnapshot(customerId);
  }
}

// ─── Module ───────────────────────────────────────────────────────────────────

@Module({
  providers: [BehaviourSnapshotService],
  controllers: [BehaviourController],
  exports: [BehaviourSnapshotService],
})
export class BehaviourModule {}
