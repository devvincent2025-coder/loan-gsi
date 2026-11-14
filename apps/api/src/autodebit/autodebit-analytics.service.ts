import { Inject, Injectable } from '@nestjs/common';
import type {
  AutodebitDashboardDto, DebitSuccessRateByBankDto, FailedDebitReasonDto, GsiRecoverySummaryDto, LinkedAccountHealthDto, MandateStatusSummaryDto,
} from '@damez/shared';
import { APP_ENV, AppEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { LinkedAccountsService } from './linked-accounts.service';

const SUCCESS_LIKE = ['SUCCESS', 'PARTIAL'] as const;

/** Clean query service for the autodebit dashboard (prompt 5 builds UI on top of this). */
@Injectable()
export class AutodebitAnalyticsService {
  constructor(private prisma: PrismaService, private linkedAccounts: LinkedAccountsService, @Inject(APP_ENV) private env: AppEnv) {}

  private async successRateByBank(): Promise<DebitSuccessRateByBankDto[]> {
    const rows = await this.prisma.debitAttempt.findMany({
      where: { status: { in: ['SUCCESS', 'PARTIAL', 'FAILED'] } },
      select: { status: true, linkedAccount: { select: { bankName: true } }, mandate: { select: { linkedAccount: { select: { bankName: true } } } } },
    });
    const byBank = new Map<string, { attempts: number; successes: number }>();
    for (const r of rows) {
      const bankName = r.linkedAccount?.bankName ?? r.mandate?.linkedAccount?.bankName ?? 'Unknown';
      const agg = byBank.get(bankName) ?? { attempts: 0, successes: 0 };
      agg.attempts++;
      if ((SUCCESS_LIKE as readonly string[]).includes(r.status)) agg.successes++;
      byBank.set(bankName, agg);
    }
    return [...byBank.entries()].map(([bankName, a]) => ({
      bankName, attempts: a.attempts, successes: a.successes, successRateBps: a.attempts ? Math.round((a.successes / a.attempts) * 10_000) : 0,
    })).sort((a, b) => b.attempts - a.attempts);
  }

  private async mandateStatusSummary(): Promise<MandateStatusSummaryDto[]> {
    const rows = await this.prisma.mandate.groupBy({ by: ['status'], _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  private async failedReasons(): Promise<FailedDebitReasonDto[]> {
    const rows = await this.prisma.debitAttempt.groupBy({
      by: ['failureReason'], where: { status: 'FAILED', failureReason: { not: null } }, _count: { _all: true }, orderBy: { _count: { failureReason: 'desc' } }, take: 10,
    });
    return rows.map((r) => ({ reason: r.failureReason ?? 'Unknown', count: r._count._all }));
  }

  private async gsiRecovery(): Promise<GsiRecoverySummaryDto[]> {
    const since = new Date(); since.setUTCMonth(since.getUTCMonth() - 11);
    const rows = await this.prisma.debitAttempt.findMany({
      where: { method: 'GSI', executedAt: { gte: since } }, select: { status: true, collectedKobo: true, executedAt: true },
    });
    const byMonth = new Map<string, { recoveredKobo: number; attempts: number; successes: number }>();
    for (const r of rows) {
      const period = (r.executedAt ?? new Date()).toISOString().slice(0, 7);
      const agg = byMonth.get(period) ?? { recoveredKobo: 0, attempts: 0, successes: 0 };
      agg.attempts++;
      agg.recoveredKobo += Number(r.collectedKobo);
      if ((SUCCESS_LIKE as readonly string[]).includes(r.status)) agg.successes++;
      byMonth.set(period, agg);
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, a]) => ({ period, ...a }));
  }

  private async linkedAccountHealth(): Promise<{ totalCustomers: number; healthyCustomers: number; samples: LinkedAccountHealthDto[] }> {
    const customers = await this.prisma.customer.findMany({
      where: { linkedAccounts: { some: { status: { not: 'REMOVED' } } } },
      select: { id: true, firstName: true, lastName: true },
      take: 200,
    });
    let healthyCustomers = 0;
    const samples: LinkedAccountHealthDto[] = [];
    for (const c of customers) {
      const [verifiedCount, healthy] = await Promise.all([this.linkedAccounts.verifiedCount(c.id), this.linkedAccounts.meetsMinimum(c.id)]);
      if (healthy) healthyCustomers++;
      if (samples.length < 25) samples.push({ customerId: c.id, customerName: `${c.firstName} ${c.lastName}`, verifiedCount, requiredCount: 1 + this.env.AUTODEBIT_MIN_LINKED_ACCOUNTS, healthy });
    }
    return { totalCustomers: customers.length, healthyCustomers, samples };
  }

  async dashboard(): Promise<AutodebitDashboardDto> {
    const [successRateByBank, mandateStatusSummary, failedReasons, gsiRecovery, linkedAccountHealth] = await Promise.all([
      this.successRateByBank(), this.mandateStatusSummary(), this.failedReasons(), this.gsiRecovery(), this.linkedAccountHealth(),
    ]);
    return { successRateByBank, mandateStatusSummary, failedReasons, gsiRecovery, linkedAccountHealth };
  }
}
