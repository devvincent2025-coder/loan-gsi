import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allocateRepayment } from '../common/repayment-allocation';
import { APP_ENV, AppEnv } from '../config/config.module';
import { GSI_PORT, LEDGER_PORT, MANDATE_PORT, type GsiPort, type LedgerPort, type MandatePort } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import { outstandingTarget, totalOutstandingKobo } from './installment-outstanding';
import { computeRetryStage, daysPastDue, isGsiStage, lagosHourOf, lagosToday, parseRetryLadder } from './retry-ladder';

export interface AttemptDebitJob { loanId: string; installmentId: string; retryStage: string }

const DUE_TEMPLATES = [
  { key: 'autodebit_due', channel: 'SMS' as const, name: 'Autodebit due today', subject: null, body: 'Damez: your repayment of {{amount}} on loan {{reference}} is due today and will be auto-debited. Ensure your account is funded.', variables: ['amount', 'reference'] },
  { key: 'autodebit_success', channel: 'SMS' as const, name: 'Autodebit collected', subject: null, body: 'Damez: we collected {{amount}} from your linked account for loan {{reference}}. Thank you.', variables: ['amount', 'reference'] },
  { key: 'autodebit_failed', channel: 'SMS' as const, name: 'Autodebit failed', subject: null, body: 'Damez: we could not collect {{amount}} for loan {{reference}} ({{reason}}). Please fund your account; we will retry.', variables: ['amount', 'reference', 'reason'] },
];

/**
 * BullMQ-driven debit engine. A daily scheduler enqueues one `attemptDebit` job per instalment that has a retry
 * ladder stage due "today"; the processor collects via the mandate/GSI port, allocates the result, and updates
 * the loan/instalment/repayment/ledger. Idempotency key `debit:<loanId>:<installmentId>:<retryStage>` plus the
 * `DebitAttempt.idempotencyKey` unique constraint guarantee we never double-charge the same stage.
 */
@Injectable()
export class DebitEngineService implements OnModuleInit {
  private log = new Logger('DebitEngine');

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
    private notifications: NotificationsService,
    private cipher: FieldCipher,
    @Inject(APP_ENV) private env: AppEnv,
    @Inject(MANDATE_PORT) private mandatePort: MandatePort,
    @Inject(GSI_PORT) private gsiPort: GsiPort,
    @Inject(LEDGER_PORT) private ledgerPort: LedgerPort,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const t of DUE_TEMPLATES) {
      try {
        const exists = await this.prisma.notificationTemplate.findUnique({ where: { key_channel: { key: t.key, channel: t.channel } } });
        if (!exists) await this.prisma.notificationTemplate.create({ data: t });
      } catch (e) { this.log.warn(`template seed ${t.key} failed: ${(e as Error).message}`); }
    }
    this.queue.register(QUEUES.autodebit, (name, data) => {
      if (name === 'plan') return this.planToday();
      if (name === 'attemptDebit') return this.attemptDebit(data as AttemptDebitJob);
      return Promise.resolve();
    });
    const t = setTimeout(() => {
      // 06:00 Africa/Lagos: plan the day's debits (one BullMQ job per due instalment; the job itself runs at any hour after).
      void this.queue.schedule(QUEUES.autodebit, 'autodebit-daily-plan', { pattern: '0 6 * * *', tz: 'Africa/Lagos' }, 'plan').catch((e: Error) => this.log.warn(e.message));
    }, 4000);
    t.unref();
  }

  private ladder(): string[] { return parseRetryLadder(this.env.AUTODEBIT_RETRY_LADDER); }

  /** Finds every ACTIVE/Unpaid loan's next unpaid instalment that is due for a retry-ladder stage today, and enqueues it. */
  async planToday(): Promise<{ planned: number }> {
    const today = lagosToday();
    const hour = lagosHourOf();
    const ladder = this.ladder();
    const instalments = await this.prisma.loanInstallment.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, loan: { status: { in: ['ACTIVE', 'Unpaid'] } } },
      include: { loan: { select: { id: true, reference: true, status: true } } },
    });
    let planned = 0;
    for (const inst of instalments) {
      const dpd = daysPastDue(inst.dueDate, today);
      const stage = computeRetryStage(dpd, ladder, hour);
      if (!stage) continue;
      const idempotencyKey = `debit:${inst.loanId}:${inst.id}:${stage}`;
      const already = await this.prisma.debitAttempt.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (already) continue;
      if (dpd === 0) await this.sendDueNotice(inst.loanId, inst.totalKobo - inst.paidKobo + inst.penaltyAccruedKobo);
      await this.queue.enqueue(QUEUES.autodebit, 'attemptDebit', { loanId: inst.loanId, installmentId: inst.id, retryStage: stage } satisfies AttemptDebitJob);
      planned++;
    }
    return { planned };
  }

  /** Idempotent: a repeat call with the same (loanId, installmentId, retryStage) is a no-op (returns the existing attempt). */
  async attemptDebit(job: AttemptDebitJob): Promise<{ id: string; status: string } | null> {
    const idempotencyKey = `debit:${job.loanId}:${job.installmentId}:${job.retryStage}`;
    const existing = await this.prisma.debitAttempt.findUnique({ where: { idempotencyKey } });
    if (existing) return { id: existing.id, status: existing.status };

    const [loan, installment] = await Promise.all([
      this.prisma.loan.findUnique({ where: { id: job.loanId } }),
      this.prisma.loanInstallment.findUnique({ where: { id: job.installmentId } }),
    ]);
    if (!loan || !installment) return null;
    if (installment.status === 'PAID') return null;

    const target = outstandingTarget(installment);
    const amountKobo = totalOutstandingKobo(installment);
    if (amountKobo <= 0) return null;

    const attemptNumber = (await this.prisma.debitAttempt.count({ where: { loanId: job.loanId, installmentId: job.installmentId } })) + 1;
    const gsiStage = isGsiStage(job.retryStage);

    let outcome: { status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; collectedKobo: number; failureReason?: string; providerRef?: string | null; mandateId?: string | null; linkedAccountId?: string | null; method: 'NIBSS_EMANDATE' | 'CARD_TOKEN' | 'GSI' };

    try {
      if (!gsiStage) {
        const mandate = await this.prisma.mandate.findFirst({
          where: { customerId: loan.customerId, status: 'ACTIVE', type: { in: ['NIBSS_EMANDATE', 'CARD_TOKEN'] } }, orderBy: { priority: 'asc' },
        });
        if (!mandate?.providerRef) {
          outcome = { status: 'FAILED', collectedKobo: 0, failureReason: 'No active mandate on file', method: 'NIBSS_EMANDATE', mandateId: mandate?.id ?? null };
        } else {
          const r = await this.mandatePort.debit({ providerRef: mandate.providerRef, amountKobo, idempotencyKey });
          outcome = { ...r, providerRef: mandate.providerRef, mandateId: mandate.id, linkedAccountId: mandate.linkedAccountId, method: mandate.type as 'NIBSS_EMANDATE' | 'CARD_TOKEN' };
        }
      } else {
        const customer = await this.prisma.customer.findUnique({ where: { id: loan.customerId }, select: { bvnEnc: true } });
        const accounts = await this.prisma.linkedAccount.findMany({ where: { customerId: loan.customerId, status: 'VERIFIED' }, orderBy: { priority: 'asc' } });
        if (!customer?.bvnEnc || !accounts.length) {
          outcome = { status: 'FAILED', collectedKobo: 0, failureReason: 'No BVN or verified linked accounts for GSI', method: 'GSI' };
        } else {
          const bvn = this.cipher.decrypt(customer.bvnEnc, `customer:${loan.customerId}:bvn`);
          const accountArgs = accounts.map((a) => ({ accountNumber: this.cipher.decrypt(a.accountNumberEnc, `linkedaccount:${loan.customerId}:accountNumber`), bankCode: a.bankCode, priority: a.priority }));
          const r = await this.gsiPort.trigger({ customerId: loan.customerId, bvn, amountKobo, idempotencyKey, accounts: accountArgs });
          outcome = { status: r.status, collectedKobo: r.collectedKobo, method: 'GSI', linkedAccountId: accounts[0]?.id ?? null };
        }
      }
    } catch (e) {
      outcome = { status: 'FAILED', collectedKobo: 0, failureReason: (e as Error).message.slice(0, 300), method: gsiStage ? 'GSI' : 'NIBSS_EMANDATE' };
    }

    let attemptId: string;
    try {
      const created = await this.prisma.debitAttempt.create({
        data: {
          loanId: job.loanId, installmentId: job.installmentId, mandateId: outcome.mandateId ?? null, linkedAccountId: outcome.linkedAccountId ?? null,
          method: outcome.method, retryStage: job.retryStage, attemptNumber, amountKobo: BigInt(amountKobo), collectedKobo: BigInt(outcome.collectedKobo), status: outcome.status,
          providerRef: outcome.providerRef ?? null, failureReason: outcome.failureReason ?? null, idempotencyKey, scheduledFor: new Date(), executedAt: new Date(),
        },
      });
      attemptId = created.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.debitAttempt.findUnique({ where: { idempotencyKey } });
        return raced ? { id: raced.id, status: raced.status } : null;
      }
      throw e;
    }

    if (outcome.status === 'SUCCESS' || outcome.status === 'PARTIAL') {
      await this.applyCollection({ loan, installment, target, collectedKobo: outcome.collectedKobo, attemptId, method: outcome.method });
      await this.sendOutcomeNotice(loan.id, true, outcome.collectedKobo, null);
    } else {
      // dpd/delinquency staging is owned by the (separate) loan-monitoring job; we only record the failed attempt here.
      await this.sendOutcomeNotice(loan.id, false, amountKobo, outcome.failureReason ?? 'Unknown reason');
    }

    return { id: attemptId, status: outcome.status };
  }

  private async nextReceiptNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `RCP-${year}-`;
    const last = await tx.repayment.findFirst({ where: { receiptNumber: { startsWith: prefix } }, orderBy: { receiptNumber: 'desc' }, select: { receiptNumber: true } });
    const seq = last ? parseInt(last.receiptNumber.slice(prefix.length), 10) + 1 : 1;
    return `${prefix}${String(seq).padStart(8, '0')}`;
  }

  private async applyCollection(args: {
    loan: { id: string; outstandingPrincipalKobo: bigint };
    installment: { id: string; totalKobo: bigint; paidKobo: bigint; penaltyAccruedKobo: bigint };
    target: ReturnType<typeof outstandingTarget>;
    collectedKobo: number;
    attemptId: string;
    method: 'NIBSS_EMANDATE' | 'CARD_TOKEN' | 'GSI';
  }): Promise<void> {
    const alloc = allocateRepayment(args.collectedKobo, args.target);
    const appliedToTotal = alloc.feeKobo + alloc.interestKobo + alloc.principalKobo;
    const fullyCovered = alloc.penaltyKobo >= args.target.penaltyOutstandingKobo && appliedToTotal >= (args.target.feeOutstandingKobo + args.target.interestOutstandingKobo + args.target.principalOutstandingKobo);

    await this.prisma.$transaction(async (tx) => {
      await tx.loanInstallment.update({
        where: { id: args.installment.id },
        data: {
          paidKobo: { increment: BigInt(appliedToTotal) }, penaltyAccruedKobo: { decrement: BigInt(alloc.penaltyKobo) },
          status: fullyCovered ? 'PAID' : 'PARTIAL', paidAt: fullyCovered ? new Date() : undefined,
        },
      });
      await tx.loan.update({
        where: { id: args.loan.id },
        data: { outstandingPrincipalKobo: { decrement: BigInt(alloc.principalKobo) }, ...(fullyCovered ? { dpd: 0 } : {}) },
      });
      const receiptNumber = await this.nextReceiptNumber(tx);
      const repayment = await tx.repayment.create({
        data: {
          loanId: args.loan.id, receiptNumber, kind: 'SCHEDULED', method: args.method === 'GSI' ? 'AUTODEBIT_GSI' : 'AUTODEBIT_MANDATE',
          amountKobo: BigInt(args.collectedKobo), allocatedPenaltyKobo: BigInt(alloc.penaltyKobo), allocatedFeeKobo: BigInt(alloc.feeKobo), allocatedInterestKobo: BigInt(alloc.interestKobo),
          allocatedPrincipalKobo: BigInt(alloc.principalKobo), debitAttemptId: args.attemptId,
        },
      });
      await tx.debitAttempt.update({ where: { id: args.attemptId }, data: { repaymentId: repayment.id } });

      // Ledger: Dr Cash/Bank (1000) the collected amount; Cr the receivable control accounts matching the allocation.
      // ASSUMPTION (for the ledger agent to reconcile): this credits RECEIVABLE accounts (1100 principal / 1200
      // interest / 1300 fee / 1400 penalty), on the basis that interest/fees were already recognised as
      // receivable at schedule creation for this flat-rate, pre-amortised product. If schedule creation instead
      // books interest/fees straight to income, the interest/fee legs below should credit 4100/4200 income
      // accounts instead of 1200/1300.
      const postings: { accountCode: string; side: 'DEBIT' | 'CREDIT'; amountKobo: number }[] = [{ accountCode: '1000', side: 'DEBIT', amountKobo: args.collectedKobo }];
      if (alloc.principalKobo > 0) postings.push({ accountCode: '1100', side: 'CREDIT', amountKobo: alloc.principalKobo });
      if (alloc.interestKobo > 0) postings.push({ accountCode: '1200', side: 'CREDIT', amountKobo: alloc.interestKobo });
      if (alloc.feeKobo > 0) postings.push({ accountCode: '1300', side: 'CREDIT', amountKobo: alloc.feeKobo });
      if (alloc.penaltyKobo > 0) postings.push({ accountCode: '1400', side: 'CREDIT', amountKobo: alloc.penaltyKobo });
      try {
        const je = await this.ledgerPort.post({ memo: `Autodebit collection — ${args.method}`, sourceType: 'REPAYMENT', sourceId: repayment.id, loanId: args.loan.id, postings }, tx);
        await tx.repayment.update({ where: { id: repayment.id }, data: { journalEntryId: je.id } });
      } catch (e) {
        this.log.warn(`ledger post failed for repayment ${repayment.id}: ${(e as Error).message}`);
      }
    });
  }

  private async sendDueNotice(loanId: string, amountKobo: bigint | number): Promise<void> {
    try {
      const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, select: { reference: true, customer: { select: { id: true, phoneEnc: true, phoneVerifiedAt: true } } } });
      if (!loan?.customer.phoneVerifiedAt || !loan.customer.phoneEnc) return;
      const phone = this.cipher.decrypt(loan.customer.phoneEnc, `customer:${loan.customer.id}:phone`);
      await this.notifications.send({ channel: 'SMS', to: phone, templateKey: 'autodebit_due', variables: { amount: koboToNaira(amountKobo), reference: loan.reference } });
    } catch (e) { this.log.warn(`due notice failed for loan ${loanId}: ${(e as Error).message}`); }
  }

  private async sendOutcomeNotice(loanId: string, success: boolean, amountKobo: bigint | number, reason: string | null): Promise<void> {
    try {
      const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, select: { reference: true, customer: { select: { id: true, phoneEnc: true, phoneVerifiedAt: true } } } });
      if (!loan?.customer.phoneVerifiedAt || !loan.customer.phoneEnc) return;
      const phone = this.cipher.decrypt(loan.customer.phoneEnc, `customer:${loan.customer.id}:phone`);
      await this.notifications.send({
        channel: 'SMS', to: phone, templateKey: success ? 'autodebit_success' : 'autodebit_failed',
        variables: { amount: koboToNaira(amountKobo), reference: loan.reference, ...(reason ? { reason } : {}) },
      });
    } catch (e) { this.log.warn(`outcome notice failed for loan ${loanId}: ${(e as Error).message}`); }
  }
}

function koboToNaira(kobo: bigint | number): string {
  const n = typeof kobo === 'bigint' ? Number(kobo) : kobo;
  return `₦${(n / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}
