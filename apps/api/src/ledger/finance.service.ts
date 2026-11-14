import { Injectable } from '@nestjs/common';
import { DisbursementStatus } from '@prisma/client';
import type { SettlementReconciliationSummaryDto, TreasuryCashPositionDto } from '@damez/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ACCOUNT_CODES } from './chart-of-accounts';
import { LedgerService } from './ledger.service';

const PENDING_DISBURSEMENT_STATUSES: DisbursementStatus[] = [DisbursementStatus.PENDING, DisbursementStatus.NAME_ENQUIRY_DONE, DisbursementStatus.PROCESSING];

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Treasury cash position and settlement reconciliation summaries, read from the ledger + disbursement/settlement tables. */
@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService, private ledger: LedgerService) {}

  async cashPosition(): Promise<TreasuryCashPositionDto> {
    const today = startOfTodayUtc();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const cashAccount = await this.prisma.ledgerAccount.findUnique({ where: { code: ACCOUNT_CODES.CASH } });

    const [cashKobo, disbursedToday, collectedToday, pendingDisbursements, unreconciled] = await Promise.all([
      this.ledger.accountBalance(ACCOUNT_CODES.CASH),
      cashAccount
        ? this.prisma.posting.aggregate({
            where: { accountId: cashAccount.id, side: 'CREDIT', createdAt: { gte: today, lt: tomorrow }, journalEntry: { sourceType: 'DISBURSEMENT' } },
            _sum: { amountKobo: true },
          })
        : Promise.resolve({ _sum: { amountKobo: 0n } }),
      cashAccount
        ? this.prisma.posting.aggregate({
            where: { accountId: cashAccount.id, side: 'DEBIT', createdAt: { gte: today, lt: tomorrow }, journalEntry: { sourceType: 'REPAYMENT' } },
            _sum: { amountKobo: true },
          })
        : Promise.resolve({ _sum: { amountKobo: 0n } }),
      this.prisma.disbursementRequest.aggregate({ where: { status: { in: PENDING_DISBURSEMENT_STATUSES } }, _sum: { amountKobo: true } }),
      this.prisma.settlementRecord.aggregate({ where: { status: 'UNMATCHED' }, _sum: { amountKobo: true } }),
    ]);

    return {
      asOfDate: today.toISOString().slice(0, 10),
      cashKobo,
      disbursedTodayKobo: Number(disbursedToday._sum.amountKobo ?? 0n),
      collectedTodayKobo: Number(collectedToday._sum.amountKobo ?? 0n),
      pendingDisbursementsKobo: Number(pendingDisbursements._sum.amountKobo ?? 0n),
      unreconciledKobo: Number(unreconciled._sum.amountKobo ?? 0n),
    };
  }

  async reconciliationSummary(period: string): Promise<SettlementReconciliationSummaryDto> {
    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const records = await this.prisma.settlementRecord.findMany({ where: { valueDate: { gte: from, lt: to } }, select: { status: true, amountKobo: true } });
    const matchedRows = records.filter((r) => r.status !== 'UNMATCHED');
    const unmatchedRows = records.filter((r) => r.status === 'UNMATCHED');
    const exceptions = await this.prisma.reconciliationException.count({ where: { status: 'OPEN', settlementRecord: { valueDate: { gte: from, lt: to } } } });
    const sum = (rows: { amountKobo: bigint }[]) => rows.reduce((s, r) => s + Number(r.amountKobo), 0);

    return {
      period,
      matched: matchedRows.length,
      unmatched: unmatchedRows.length,
      exceptions,
      matchedKobo: sum(matchedRows),
      unmatchedKobo: sum(unmatchedRows),
    };
  }
}
