import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  buildSchedule, type ApprovalDto, type InterestMethod, type LoanDetailDto, type LoanDto, type LoanInstallmentDto,
  type LoanStatus, type MakeRepaymentDto, type Page, type RepaymentDto, type RestructureRequestDto,
} from '@damez/shared';
import { ApprovalHandler, ApprovalRegistry } from '../approvals/approval-registry';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActorRef, ApplicationTransitions, SYSTEM_ACTOR } from '../applications/application-transitions';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { branchWhere } from '../common/auth-user';
import { paged, skipTake } from '../common/pagination';
import { LEDGER_PORT, LedgerPort, PostingInput } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../storage/object-storage';
import { installmentDto, loanDto, mandateDto, repaymentDto, toPlainInstallment } from './mappers';
import { generateReceiptPdf, generateStatementPdf } from './pdf';
import {
  allocateAcrossInstallments, computeDailyPenaltyIncrementKobo, computeDpd, installmentOutstanding, totalOutstandingKobo, type InstallmentLike,
} from './servicing-logic';

type LoanRow = Prisma.LoanGetPayload<{ include: { customer: true; product: true } }>;

const restructurePayloadSchema = z.object({
  loanId: z.string().min(1), newTenorMonths: z.number().int().min(1).max(120), newMonthlyRateBps: z.number().int().min(1).max(2500), reason: z.string().min(1),
}).passthrough();
const writeOffPayloadSchema = z.object({ loanId: z.string().min(1), reason: z.string().min(1) }).passthrough();

function parse<T extends z.ZodTypeAny>(schema: T, v: unknown): z.infer<T> {
  const r = schema.safeParse(v);
  if (!r.success) throw new BadRequestException({ message: 'Invalid payload', code: 'VALIDATION_FAILED', errors: { payload: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } });
  return r.data;
}

/** Ledger accounts used by this module (see the ledger module's chart of accounts: 1000 cash, 11xx receivables by bucket, 4300 recovery income, 5000 write-off expense). */
const ACC = { CASH: '1000', PRINCIPAL_RECEIVABLE: '1100', INTEREST_RECEIVABLE: '1200', FEE_RECEIVABLE: '1300', PENALTY_RECEIVABLE: '1400', RECOVERY_INCOME: '4300', WRITE_OFF_EXPENSE: '5000' } as const;

@Injectable()
export class LoanServicingService implements OnModuleInit {
  private log = new Logger('LoanServicing');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private registry: ApprovalRegistry,
    private approvals: ApprovalsService,
    private transitions: ApplicationTransitions,
    private cipher: FieldCipher,
    @Inject(LEDGER_PORT) private ledger: LedgerPort,
    @Inject(OBJECT_STORAGE) private storage: ObjectStorage,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.restructureHandler());
    this.registry.register(this.writeOffHandler());
  }

  /* ───────────────────────── reads ───────────────────────── */

  private async loadLoan(loanId: string): Promise<LoanRow> {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, include: { customer: true, product: true } });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  private async toDetail(loan: LoanRow): Promise<LoanDetailDto> {
    const [installments, repayments, mandates] = await Promise.all([
      this.prisma.loanInstallment.findMany({ where: { loanId: loan.id }, orderBy: { seq: 'asc' } }),
      this.prisma.repayment.findMany({ where: { loanId: loan.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.mandate.findMany({ where: { loanId: loan.id } }),
    ]);
    return {
      ...loanDto(loan, installments),
      installments: installments.map(installmentDto),
      repayments: repayments.map(repaymentDto),
      mandates: mandates.map(mandateDto),
    };
  }

  async getLoan(loanId: string): Promise<LoanDto> {
    const loan = await this.loadLoan(loanId);
    const installments = await this.prisma.loanInstallment.findMany({ where: { loanId } });
    return loanDto(loan, installments);
  }

  async getLoanDetail(loanId: string): Promise<LoanDetailDto> {
    return this.toDetail(await this.loadLoan(loanId));
  }

  async getLoanDetailForCustomer(customerId: string, loanId: string): Promise<LoanDetailDto> {
    const loan = await this.loadLoan(loanId);
    if (loan.customerId !== customerId) throw new NotFoundException('Loan not found');
    return this.toDetail(loan);
  }

  async repaymentCalendarForCustomer(customerId: string, loanId: string): Promise<LoanInstallmentDto[]> {
    const loan = await this.loadLoan(loanId);
    if (loan.customerId !== customerId) throw new NotFoundException('Loan not found');
    const installments = await this.prisma.loanInstallment.findMany({ where: { loanId }, orderBy: { seq: 'asc' } });
    return installments.map(installmentDto);
  }

  async listForCustomer(customerId: string): Promise<LoanDto[]> {
    const loans = await this.prisma.loan.findMany({ where: { customerId }, include: { customer: true, product: true }, orderBy: { disbursedAt: 'desc' } });
    const out: LoanDto[] = [];
    for (const loan of loans) out.push(loanDto(loan, await this.prisma.loanInstallment.findMany({ where: { loanId: loan.id } })));
    return out;
  }

  async list(user: AuthUser, q: { page: number; pageSize: number; status?: LoanStatus; branchId?: string; customerId?: string }): Promise<Page<LoanDto>> {
    const where: Prisma.LoanWhereInput = { ...branchWhere(user), ...(q.status ? { status: q.status } : {}), ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.customerId ? { customerId: q.customerId } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.loan.count({ where }),
      this.prisma.loan.findMany({ where, include: { customer: true, product: true }, orderBy: { disbursedAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
    ]);
    const out: LoanDto[] = [];
    for (const loan of rows) out.push(loanDto(loan, await this.prisma.loanInstallment.findMany({ where: { loanId: loan.id } })));
    return paged(out, total, q.page, q.pageSize);
  }

  /* ───────────────────────── repayments ───────────────────────── */

  private generateReceiptNumber(): string {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `RCT-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  async makeRepayment(loanId: string, input: MakeRepaymentDto, actorId: string | null): Promise<RepaymentDto> {
    const loan = await this.loadLoan(loanId);
    if (!['ACTIVE', 'Unpaid'].includes(loan.status)) {
      throw new BadRequestException({ message: `Loan is ${loan.status.toLowerCase()}; repayments are not accepted`, code: 'LOAN_NOT_SERVICEABLE' });
    }
    if (!Number.isInteger(input.amountKobo) || input.amountKobo <= 0) {
      throw new BadRequestException({ message: 'amountKobo must be a positive integer', code: 'VALIDATION_FAILED', errors: { amountKobo: ['Required'] } });
    }

    const installmentRows = await this.prisma.loanInstallment.findMany({ where: { loanId }, orderBy: { seq: 'asc' } });
    const plain: InstallmentLike[] = installmentRows.map(toPlainInstallment);
    const result = allocateAcrossInstallments(plain, input.amountKobo);
    const applied = result.totalPenaltyKobo + result.totalFeeKobo + result.totalInterestKobo + result.totalPrincipalKobo;
    if (applied <= 0) throw new BadRequestException({ message: 'Loan has no outstanding balance to apply this payment to', code: 'NO_OUTSTANDING_BALANCE' });

    const receiptNumber = this.generateReceiptNumber();
    const postings: PostingInput[] = [{ accountCode: ACC.CASH, side: 'DEBIT', amountKobo: applied }];
    if (result.totalPenaltyKobo > 0) postings.push({ accountCode: ACC.PENALTY_RECEIVABLE, side: 'CREDIT', amountKobo: result.totalPenaltyKobo });
    if (result.totalFeeKobo > 0) postings.push({ accountCode: ACC.FEE_RECEIVABLE, side: 'CREDIT', amountKobo: result.totalFeeKobo });
    if (result.totalInterestKobo > 0) postings.push({ accountCode: ACC.INTEREST_RECEIVABLE, side: 'CREDIT', amountKobo: result.totalInterestKobo });
    if (result.totalPrincipalKobo > 0) postings.push({ accountCode: ACC.PRINCIPAL_RECEIVABLE, side: 'CREDIT', amountKobo: result.totalPrincipalKobo });

    const { repayment, newOutstandingTotal } = await this.prisma.$transaction(async (tx) => {
      for (const u of result.updates) {
        await tx.loanInstallment.update({ where: { id: u.id }, data: { paidKobo: BigInt(u.newPaidKobo), penaltyAccruedKobo: BigInt(u.newPenaltyAccruedKobo), status: u.newStatus, ...(u.newStatus === 'PAID' ? { paidAt: new Date() } : {}) } });
      }
      const journal = await this.ledger.post({ memo: `Repayment ${receiptNumber} on loan ${loan.reference}`, sourceType: 'REPAYMENT', sourceId: receiptNumber, loanId, createdById: actorId, postings }, tx);
      const r = await tx.repayment.create({
        data: {
          loanId, receiptNumber, kind: input.kind, method: input.method, amountKobo: BigInt(applied),
          allocatedPenaltyKobo: BigInt(result.totalPenaltyKobo), allocatedFeeKobo: BigInt(result.totalFeeKobo), allocatedInterestKobo: BigInt(result.totalInterestKobo), allocatedPrincipalKobo: BigInt(result.totalPrincipalKobo),
          journalEntryId: journal.id, createdById: actorId,
        },
      });
      const newOutstandingPrincipal = Math.max(0, Number(loan.outstandingPrincipalKobo) - result.totalPrincipalKobo);
      const merged = plain.map((p) => { const u = result.updates.find((x) => x.id === p.id); return u ? { ...p, paidKobo: u.newPaidKobo, penaltyAccruedKobo: u.newPenaltyAccruedKobo, status: u.newStatus } : p; });
      const outstandingTotal = totalOutstandingKobo(merged);
      await tx.loan.update({ where: { id: loanId }, data: { outstandingPrincipalKobo: BigInt(newOutstandingPrincipal), ...(outstandingTotal === 0 ? { dpd: 0 } : {}) } });
      await this.audit.record({
        action: 'loan.repayment_recorded', resourceType: 'Loan', resourceId: loanId, branchId: loan.branchId,
        after: { receiptNumber, amountKobo: applied, kind: input.kind, method: input.method, allocation: { penalty: result.totalPenaltyKobo, fee: result.totalFeeKobo, interest: result.totalInterestKobo, principal: result.totalPrincipalKobo }, unallocatedKobo: result.unallocatedKobo },
      }, tx);
      return { repayment: r, newOutstandingTotal: outstandingTotal };
    });

    if (newOutstandingTotal === 0 && loan.status !== 'CLOSED') {
      try {
        await this.transitions.apply(loan.applicationId, 'CLOSED', SYSTEM_ACTOR, { reason: 'Fully repaid' });
        await this.prisma.loan.update({ where: { id: loanId }, data: { status: 'CLOSED', closedAt: new Date() } });
      } catch (e) {
        this.log.warn(`closure transition failed for loan ${loanId}: ${(e as Error).message}`);
      }
    }

    try {
      const pdf = await generateReceiptPdf({ receiptNumber, loan, repayment, allocation: result });
      const payload = this.cipher.encrypt(pdf.toString('base64'), `repayment:${repayment.id}:receipt`);
      await this.storage.put(`receipts/${loanId}/${repayment.id}.pdf.enc`, Buffer.from(payload, 'utf8'));
      await this.audit.record({ action: 'loan.receipt_generated', resourceType: 'Repayment', resourceId: repayment.id, branchId: loan.branchId, metadata: { loanId, receiptNumber } });
    } catch (e) {
      this.log.warn(`receipt generation/storage failed for repayment ${repayment.id}: ${(e as Error).message}`);
    }

    return repaymentDto(repayment);
  }

  /* ───────────────────────── restructure (maker-checker) ───────────────────────── */

  async requestRestructure(loanId: string, input: RestructureRequestDto, user: AuthUser): Promise<ApprovalDto> {
    const loan = await this.loadLoan(loanId);
    if (!['ACTIVE', 'Unpaid'].includes(loan.status)) throw new BadRequestException({ message: 'Only active or Unpaid loans can be restructured', code: 'LOAN_NOT_RESTRUCTURABLE' });
    const installments = await this.prisma.loanInstallment.findMany({ where: { loanId } });
    const outstanding = totalOutstandingKobo(installments.map(toPlainInstallment));
    if (outstanding <= 0) throw new BadRequestException({ message: 'Loan has no outstanding balance to restructure', code: 'NO_OUTSTANDING_BALANCE' });
    const newMonthlyRateBps = input.newMonthlyRateBps ?? loan.monthlyRateBps;
    return this.approvals.submit(user, {
      type: 'RESTRUCTURE', summary: `Restructure loan ${loan.reference} to ${input.newTenorMonths} months`, reason: input.reason, amountKobo: outstanding,
      payload: { loanId, newTenorMonths: input.newTenorMonths, newMonthlyRateBps, reason: input.reason },
    });
  }

  private restructureHandler(): ApprovalHandler {
    return {
      type: 'RESTRUCTURE',
      submitPermission: 'loan:restructure',
      validate: (p) => parse(restructurePayloadSchema, p),
      execute: async (req, tx) => {
        const p = parse(restructurePayloadSchema, req.payload);
        const loan = await tx.loan.findUnique({ where: { id: p.loanId } });
        if (!loan) throw new Error('Loan no longer exists');
        if (!['ACTIVE', 'Unpaid'].includes(loan.status)) throw new Error(`Loan is ${loan.status}, cannot restructure`);
        const remainingPrincipal = Number(loan.outstandingPrincipalKobo);
        if (remainingPrincipal <= 0) throw new Error('Loan has no outstanding principal to restructure');

        const oldInstallments = await tx.loanInstallment.findMany({ where: { loanId: loan.id }, orderBy: { seq: 'asc' } });
        const lastPaidSeq = oldInstallments.filter((i) => i.status === 'PAID').reduce((m, i) => Math.max(m, i.seq), 0);
        const { schedule } = buildSchedule({ principalKobo: remainingPrincipal, monthlyRateBps: p.newMonthlyRateBps, tenorMonths: p.newTenorMonths, method: loan.interestMethod as InterestMethod, startDate: new Date() });

        await tx.loanInstallment.deleteMany({ where: { loanId: loan.id, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } } });
        await tx.loanInstallment.createMany({
          data: schedule.map((line, idx) => ({
            loanId: loan.id, seq: lastPaidSeq + idx + 1, dueDate: new Date(`${line.dueDate}T00:00:00Z`),
            principalKobo: BigInt(line.principalKobo), interestKobo: BigInt(line.interestKobo), feeKobo: 0n, totalKobo: BigInt(line.totalKobo),
            paidKobo: 0n, penaltyAccruedKobo: 0n, status: 'PENDING' as const,
          })),
        });
        const newMaturity = new Date(`${schedule[schedule.length - 1].dueDate}T00:00:00Z`);
        await tx.loan.update({ where: { id: loan.id }, data: { monthlyRateBps: p.newMonthlyRateBps, tenorMonths: lastPaidSeq + p.newTenorMonths, maturityDate: newMaturity, restructureCount: { increment: 1 } } });
        await tx.loanRestructure.create({
          data: {
            loanId: loan.id, approvalRequestId: req.id, reason: p.reason,
            oldSchedule: oldInstallments as unknown as Prisma.InputJsonValue, newSchedule: schedule as unknown as Prisma.InputJsonValue,
            newTenorMonths: p.newTenorMonths, newMonthlyRateBps: p.newMonthlyRateBps, requestedById: req.makerId,
          },
        });
        await this.audit.record({
          action: 'loan.restructured', resourceType: 'Loan', resourceId: loan.id, branchId: loan.branchId,
          before: { tenorMonths: loan.tenorMonths, monthlyRateBps: loan.monthlyRateBps }, after: { newTenorMonths: p.newTenorMonths, newMonthlyRateBps: p.newMonthlyRateBps },
          metadata: { approvalId: req.id, reason: p.reason },
        }, tx);

        const maker = await tx.staffUser.findUnique({ where: { id: req.makerId }, select: { fullName: true } });
        const makerActor: ActorRef = { type: 'STAFF', id: req.makerId, name: maker?.fullName ?? 'Staff', permissions: new Set(['loan:restructure']) };
        // Note: ApplicationTransitions.apply runs in its OWN transaction (separate from `tx`); this mirrors the
        // existing best-effort pattern used elsewhere (e.g. notifyCustomer) and is spec'd by the prompt.
        await this.transitions.apply(loan.applicationId, 'RESTRUCTURED', makerActor, { reason: p.reason });
        await this.transitions.apply(loan.applicationId, 'ACTIVE', SYSTEM_ACTOR);
        await tx.loan.update({ where: { id: loan.id }, data: { status: 'ACTIVE' } });
        return { loanId: loan.id, newTenorMonths: p.newTenorMonths, newMonthlyRateBps: p.newMonthlyRateBps };
      },
    };
  }

  /* ───────────────────────── write-off (maker-checker) ───────────────────────── */

  async requestWriteOff(loanId: string, reason: string, user: AuthUser): Promise<ApprovalDto> {
    const loan = await this.loadLoan(loanId);
    if (loan.status !== 'Unpaid') throw new BadRequestException({ message: 'Only Unpaid loans can be written off', code: 'LOAN_NOT_WRITEOFFABLE' });
    const installments = await this.prisma.loanInstallment.findMany({ where: { loanId } });
    const outstanding = totalOutstandingKobo(installments.map(toPlainInstallment));
    if (outstanding <= 0) throw new BadRequestException({ message: 'Loan has no outstanding balance', code: 'NO_OUTSTANDING_BALANCE' });
    return this.approvals.submit(user, { type: 'WRITE_OFF', summary: `Write off loan ${loan.reference}`, reason, amountKobo: outstanding, payload: { loanId, reason } });
  }

  private writeOffHandler(): ApprovalHandler {
    return {
      type: 'WRITE_OFF',
      submitPermission: 'loan:writeoff',
      validate: (p) => parse(writeOffPayloadSchema, p),
      execute: async (req, tx, approver) => {
        const p = parse(writeOffPayloadSchema, req.payload);
        const loan = await tx.loan.findUnique({ where: { id: p.loanId } });
        if (!loan) throw new Error('Loan no longer exists');
        if (loan.status !== 'Unpaid') throw new Error(`Loan is ${loan.status}, cannot write off`);

        const installments = await tx.loanInstallment.findMany({ where: { loanId: loan.id } });
        const plain = installments.map(toPlainInstallment);
        let penalty = 0; let fee = 0; let interest = 0; let principal = 0;
        for (const i of plain) {
          const t = installmentOutstanding(i);
          penalty += t.penaltyOutstandingKobo; fee += t.feeOutstandingKobo; interest += t.interestOutstandingKobo; principal += t.principalOutstandingKobo;
        }
        const total = penalty + fee + interest + principal;
        if (total <= 0) throw new Error('Loan has no outstanding balance');

        const postings: PostingInput[] = [{ accountCode: ACC.WRITE_OFF_EXPENSE, side: 'DEBIT', amountKobo: total }];
        if (penalty > 0) postings.push({ accountCode: ACC.PENALTY_RECEIVABLE, side: 'CREDIT', amountKobo: penalty });
        if (fee > 0) postings.push({ accountCode: ACC.FEE_RECEIVABLE, side: 'CREDIT', amountKobo: fee });
        if (interest > 0) postings.push({ accountCode: ACC.INTEREST_RECEIVABLE, side: 'CREDIT', amountKobo: interest });
        if (principal > 0) postings.push({ accountCode: ACC.PRINCIPAL_RECEIVABLE, side: 'CREDIT', amountKobo: principal });
        const journal = await this.ledger.post({ memo: `Write-off of loan ${loan.reference}`, sourceType: 'WRITE_OFF', sourceId: loan.id, loanId: loan.id, createdById: approver.id, postings }, tx);

        await tx.loan.update({ where: { id: loan.id }, data: { status: 'WRITTEN_OFF', writtenOffAt: new Date(), writtenOffAmountKobo: BigInt(total) } });
        await this.audit.record({
          action: 'loan.written_off', resourceType: 'Loan', resourceId: loan.id, branchId: loan.branchId,
          before: { status: loan.status }, after: { status: 'WRITTEN_OFF', amountKobo: total }, metadata: { approvalId: req.id, journalEntryId: journal.id },
        }, tx);

        const maker = await tx.staffUser.findUnique({ where: { id: req.makerId }, select: { fullName: true } });
        const makerActor: ActorRef = { type: 'STAFF', id: req.makerId, name: maker?.fullName ?? 'Staff', permissions: new Set(['loan:writeoff']) };
        await this.transitions.apply(loan.applicationId, 'WRITTEN_OFF', makerActor, { reason: p.reason });
        return { loanId: loan.id, amountKobo: total, journalEntryId: journal.id };
      },
    };
  }

  /* ───────────────────────── recovery (post write-off) ───────────────────────── */

  async recordRecovery(loanId: string, amountKobo: number, method: 'MANUAL' | 'CASH' | 'TRANSFER', actorId: string | null): Promise<RepaymentDto> {
    const loan = await this.loadLoan(loanId);
    if (loan.status !== 'WRITTEN_OFF') throw new BadRequestException({ message: 'Recovery can only be recorded for written-off loans', code: 'LOAN_NOT_WRITTEN_OFF' });
    if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new BadRequestException({ message: 'amountKobo must be a positive integer', code: 'VALIDATION_FAILED' });
    const receiptNumber = this.generateReceiptNumber();
    const repayment = await this.prisma.$transaction(async (tx) => {
      const journal = await this.ledger.post({
        memo: `Recovery on written-off loan ${loan.reference}`, sourceType: 'RECOVERY', sourceId: receiptNumber, loanId, createdById: actorId,
        postings: [{ accountCode: ACC.CASH, side: 'DEBIT', amountKobo }, { accountCode: ACC.RECOVERY_INCOME, side: 'CREDIT', amountKobo }],
      }, tx);
      const r = await tx.repayment.create({ data: { loanId, receiptNumber, kind: 'RECOVERY', method, amountKobo: BigInt(amountKobo), journalEntryId: journal.id, createdById: actorId } });
      await this.audit.record({ action: 'loan.recovery_recorded', resourceType: 'Loan', resourceId: loanId, branchId: loan.branchId, after: { receiptNumber, amountKobo, method } }, tx);
      return r;
    });
    return repaymentDto(repayment);
  }

  /* ───────────────────────── statements & receipts ───────────────────────── */

  async statementPdf(loanId: string, from?: string, to?: string): Promise<Buffer> {
    const loan = await this.loadLoan(loanId);
    const installments = await this.prisma.loanInstallment.findMany({ where: { loanId }, orderBy: { seq: 'asc' } });
    const fromDate = from ? new Date(from) : loan.disbursedAt;
    const toDate = to ? new Date(to) : new Date();
    const repayments = await this.prisma.repayment.findMany({ where: { loanId, createdAt: { gte: fromDate, lte: toDate } }, orderBy: { createdAt: 'asc' } });
    return generateStatementPdf({ loan, installments, repayments, fromDate, toDate });
  }

  async statementPdfForCustomer(customerId: string, loanId: string, from?: string, to?: string): Promise<Buffer> {
    const loan = await this.loadLoan(loanId);
    if (loan.customerId !== customerId) throw new NotFoundException('Loan not found');
    return this.statementPdf(loanId, from, to);
  }

  async receiptPdf(repaymentId: string): Promise<Buffer> {
    const r = await this.prisma.repayment.findUnique({ where: { id: repaymentId } });
    if (!r) throw new NotFoundException('Repayment not found');
    const storageKey = `receipts/${r.loanId}/${r.id}.pdf.enc`;
    try {
      const raw = await this.storage.get(storageKey);
      const b64 = this.cipher.decrypt(raw.toString('utf8'), `repayment:${r.id}:receipt`);
      return Buffer.from(b64, 'base64');
    } catch {
      // Fallback: regenerate on the fly (e.g. a SCHEDULED repayment recorded by the autodebit module, which does not
      // store a receipt through this service).
      const loan = await this.loadLoan(r.loanId);
      return generateReceiptPdf({
        receiptNumber: r.receiptNumber, loan, repayment: r,
        allocation: { totalPenaltyKobo: Number(r.allocatedPenaltyKobo), totalFeeKobo: Number(r.allocatedFeeKobo), totalInterestKobo: Number(r.allocatedInterestKobo), totalPrincipalKobo: Number(r.allocatedPrincipalKobo) },
      });
    }
  }

  /* ───────────────────────── delinquency cron (QUEUES.maintenance) ───────────────────────── */

  async runDelinquencyCheck(): Promise<{ loansChecked: number; transitioned: number }> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const loans = await this.prisma.loan.findMany({ where: { status: { in: ['ACTIVE', 'Unpaid'] } }, include: { product: true } });
    let transitioned = 0;

    for (const loan of loans) {
      const unpaid = await this.prisma.loanInstallment.findMany({ where: { loanId: loan.id, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } }, orderBy: { dueDate: 'asc' } });
      const overdue = unpaid.filter((i) => i.dueDate < today);
      const dpd = computeDpd(overdue[0]?.dueDate ?? null, today);

      for (const i of overdue) {
        const outstandingForInstalment = Math.max(0, Number(i.totalKobo) - Number(i.paidKobo));
        const increment = computeDailyPenaltyIncrementKobo(outstandingForInstalment, loan.product.penaltyBpsPerDay, dpd, loan.product.penaltyGraceDays);
        if (increment > 0 || i.status !== 'OVERDUE') {
          await this.prisma.loanInstallment.update({ where: { id: i.id }, data: { status: 'OVERDUE', ...(increment > 0 ? { penaltyAccruedKobo: { increment: BigInt(increment) } } : {}) } });
        }
      }
      if (loan.dpd !== dpd) await this.prisma.loan.update({ where: { id: loan.id }, data: { dpd } });

      try {
        if (dpd > 0 && loan.status === 'ACTIVE') {
          await this.transitions.apply(loan.applicationId, 'Unpaid', SYSTEM_ACTOR);
          await this.prisma.loan.update({ where: { id: loan.id }, data: { status: 'Unpaid' } });
          transitioned++;
        } else if (dpd === 0 && loan.status === 'Unpaid') {
          await this.transitions.apply(loan.applicationId, 'ACTIVE', SYSTEM_ACTOR);
          await this.prisma.loan.update({ where: { id: loan.id }, data: { status: 'ACTIVE' } });
          transitioned++;
        }
      } catch (e) {
        // Another process may already have moved this application (race); never let the daily job crash for one loan.
        this.log.warn(`delinquency transition skipped for loan ${loan.id}: ${(e as Error).message}`);
      }
    }
    await this.audit.record({ action: 'loan.delinquency_cron_run', resourceType: 'Loan', metadata: { loansChecked: loans.length, transitioned } });
    return { loansChecked: loans.length, transitioned };
  }
}
