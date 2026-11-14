import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { DisbursementRequestDto, NameEnquiryResultDto } from '@damez/shared';
import { ApprovalHandler, ApprovalRegistry } from '../approvals/approval-registry';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApplicationTransitions, SYSTEM_ACTOR } from '../applications/application-transitions';
import { AuditService } from '../audit/audit.service';
import { n } from '../common/bigint';
import type { AuthUser } from '../common/auth-user';
import { APP_ENV, AppEnv } from '../config/config.module';
import { BUREAU_PORT, BureauPort, LEDGER_PORT, LedgerPort } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import { namesMatch, nameSimilarity } from './name-match';
import { PaymentProviders } from './payment-providers';

const aad = (kind: 'linkedaccount', id: string, field: string) => `${kind}:${id}:${field}`;

export interface OfferScheduleRow { seq: number; dueDate: string; principalKobo: number; interestKobo: number; feeKobo: number; totalKobo: number; balanceAfterKobo: number }

type LoanRefClient = Pick<PrismaService | Prisma.TransactionClient, 'loan'>;

/** Generates `LN-<yyyy>-<6-digit seq>`, same scheme as `applications.service.ts`'s `createWithReference`. */
async function allocateLoanReference(client: LoanRefClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `LN-${year}-`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const last = await client.loan.findFirst({ where: { reference: { startsWith: prefix } }, orderBy: { reference: 'desc' }, select: { reference: true } });
    const seq = last ? parseInt(last.reference.slice(prefix.length), 10) + 1 : 1;
    const candidate = `${prefix}${String(seq + attempt).padStart(6, '0')}`;
    const clash = await client.loan.findUnique({ where: { reference: candidate } });
    if (!clash) return candidate;
  }
  throw new ConflictException('Could not allocate a loan reference, please retry');
}

const manualDisbursementPayloadSchema = z.object({ applicationId: z.string().min(1) }).passthrough();

type DisbursementRow = Prisma.DisbursementRequestGetPayload<{ include: { loan: true } }>;

function toDto(r: DisbursementRow): DisbursementRequestDto {
  return {
    id: r.id, loanId: r.loanId, amountKobo: n(r.amountKobo)!, provider: r.provider, method: r.method,
    status: r.status, providerRef: r.providerRef, failureReason: r.failureReason, retryCount: r.retryCount,
    createdAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
  };
}

/** Backoff schedule (ms) for the failed-transfer retry job: 1h, 4h, 24h, then exhausted. */
const RETRY_BACKOFF_MS = [60 * 60_000, 4 * 60 * 60_000, 24 * 60 * 60_000];

@Injectable()
export class DisbursementService implements OnModuleInit {
  private readonly log = new Logger('Disbursement');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private cipher: FieldCipher,
    private providers: PaymentProviders,
    private transitions: ApplicationTransitions,
    private notifications: NotificationsService,
    private registry: ApprovalRegistry,
    private approvals: ApprovalsService,
    private queue: QueueService,
    @Inject(APP_ENV) private env: AppEnv,
    @Inject(BUREAU_PORT) private bureau: BureauPort,
    @Inject(LEDGER_PORT) private ledger: LedgerPort,
  ) {}

  onModuleInit(): void {
    // Overrides the generic `stubHandler('MANUAL_DISBURSEMENT', …)` registered by ApprovalsService.onModuleInit.
    // ApprovalsModule and ApplicationsModule are both @Global(), so init order only matters in that both must
    // already be constructed; Nest resolves @Global providers before non-global module init, so this is safe.
    this.registry.register(this.manualDisbursementHandler());

    this.queue.register(QUEUES.disbursement, async (name) => {
      if (name === 'reconcile-daily') return this.reconcileDaily();
      if (name === 'retry-failed-transfers') return this.retryFailedTransfers();
      if (name === 'advance-manual-bookings') return this.advancePendingManualBookings();
      return undefined;
    });
    setTimeout(() => {
      void this.queue.schedule(QUEUES.disbursement, 'reconcile-daily', { pattern: '0 2 * * *', tz: 'Africa/Lagos' }, 'reconcile-daily').catch((e: Error) => this.log.warn(e.message));
      void this.queue.schedule(QUEUES.disbursement, 'retry-failed-transfers', 15 * 60_000, 'retry-failed-transfers').catch((e: Error) => this.log.warn(e.message));
      void this.queue.schedule(QUEUES.disbursement, 'advance-manual-bookings', 2 * 60_000, 'advance-manual-bookings').catch((e: Error) => this.log.warn(e.message));
    }, 3500);
  }

  /* ───────────────────────── reads ───────────────────────── */

  async getForApplication(applicationId: string): Promise<DisbursementRequestDto> {
    const loan = await this.prisma.loan.findUnique({ where: { applicationId }, include: { disbursement: { include: { loan: true } } } });
    if (!loan?.disbursement) throw new NotFoundException('No disbursement has been initiated for this application');
    return toDto(loan.disbursement);
  }

  /* ───────────────────────── automated path ───────────────────────── */

  async initiateAutomated(applicationId: string, initiatedById: string | null): Promise<DisbursementRequestDto> {
    const app = await this.prisma.loanApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Application not found');

    // idempotent re-entry: if a disbursement already exists for this application's loan, hand it back / resume it
    const existingLoan = await this.prisma.loan.findUnique({ where: { applicationId }, include: { disbursement: { include: { loan: true } } } });
    if (existingLoan?.disbursement) {
      const d = existingLoan.disbursement;
      if (d.status === 'SUCCESS') return toDto(d);
      if (d.status === 'PENDING' || d.status === 'NAME_ENQUIRY_DONE') return this.attemptTransfer(d.id);
      return toDto(d); // PROCESSING / FAILED / REVERSED: caller should use retry or check back later
    }

    const offer = await this.prisma.loanOffer.findFirst({ where: { applicationId, status: 'ACCEPTED' }, orderBy: { createdAt: 'desc' } });
    if (!offer) throw new NotFoundException('No accepted offer found for this application');

    await this.bureau.ensureFreshForDisbursement(app.customerId, initiatedById);

    const linkedAccount = await this.prisma.linkedAccount.findFirst({ where: { customerId: app.customerId, isPrimary: true, status: 'VERIFIED' } });
    if (!linkedAccount) throw new BadRequestException({ message: 'No verified primary linked account for this customer', code: 'NO_LINKED_ACCOUNT' });

    const idempotencyKey = `disb:${applicationId}`;
    const accountNumber = this.cipher.decrypt(linkedAccount.accountNumberEnc, aad('linkedaccount', app.customerId, 'accountNumber'));
    const storedAccountName = this.cipher.decrypt(linkedAccount.accountNameEnc, aad('linkedaccount', app.customerId, 'accountName'));

    let nameEnquiry: { accountName: string; accountNumber: string; bankCode: string };
    try {
      nameEnquiry = await this.providers.get().nameEnquiry(accountNumber, linkedAccount.bankCode);
    } catch (e) {
      await this.audit.record({ action: 'disbursement.name_enquiry_failed', resourceType: 'LinkedAccount', resourceId: linkedAccount.id, outcome: 'FAILURE', metadata: { applicationId, error: (e as Error).message } });
      throw new BadRequestException({ message: `Name enquiry failed: ${(e as Error).message}`, code: 'NAME_ENQUIRY_FAILED' });
    }
    const score = nameSimilarity(nameEnquiry.accountName, storedAccountName);
    const matched = namesMatch(nameEnquiry.accountName, storedAccountName);
    const nameEnquiryResult: NameEnquiryResultDto = { accountNumber: nameEnquiry.accountNumber, bankCode: nameEnquiry.bankCode, accountName: nameEnquiry.accountName, matched, matchScore: score };
    await this.audit.record({
      action: 'disbursement.name_enquiry', resourceType: 'Customer', resourceId: app.customerId, outcome: matched ? 'SUCCESS' : 'FAILURE',
      metadata: { applicationId, linkedAccountId: linkedAccount.id, matched, matchScore: score },
    });
    if (!matched) {
      throw new ConflictException({ message: 'The name returned by the bank does not match the name on the linked account. Disbursement blocked.', code: 'NAME_ENQUIRY_MISMATCH', nameEnquiry: nameEnquiryResult });
    }

    // Schema constraint: DisbursementRequest.loanId is a required, unique FK, and Loan.disbursedAt is non-nullable —
    // so the Loan (+ installments) must exist before a DisbursementRequest row can be created at all. We book the
    // loan "shell" now (see ASSUMPTIONS.md) and only transition the application forward once completeDisbursement()
    // confirms the money actually moved.
    const schedule = offer.scheduleJson as unknown as OfferScheduleRow[];
    if (!Array.isArray(schedule) || !schedule.length) throw new ConflictException('The accepted offer has no repayment schedule');
    const reference = await allocateLoanReference(this.prisma);
    const now = new Date();
    const lastRow = schedule[schedule.length - 1];

    const created = await this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          applicationId: app.id, offerId: offer.id, customerId: app.customerId, productId: app.productId, branchId: app.branchId,
          reference, principalKobo: offer.principalKobo, disbursedAmountKobo: offer.principalKobo, tenorMonths: offer.tenorMonths,
          monthlyRateBps: offer.monthlyRateBps, interestMethod: offer.interestMethod, totalCostOfCreditKobo: offer.totalCostOfCreditKobo,
          status: 'DISBURSED', disbursedAt: now, maturityDate: new Date(lastRow.dueDate), outstandingPrincipalKobo: offer.principalKobo,
          primaryLinkedAccountId: linkedAccount.id,
        },
      });
      await tx.loanInstallment.createMany({
        data: schedule.map((r) => ({
          loanId: loan.id, seq: r.seq, dueDate: new Date(r.dueDate), principalKobo: r.principalKobo, interestKobo: r.interestKobo,
          feeKobo: r.feeKobo, totalKobo: r.totalKobo, paidKobo: 0, status: 'PENDING' as const,
        })),
      });
      const dr = await tx.disbursementRequest.create({
        data: {
          loanId: loan.id, linkedAccountId: linkedAccount.id, amountKobo: offer.principalKobo, provider: this.providers.providerName(),
          method: 'AUTOMATED', status: 'NAME_ENQUIRY_DONE', idempotencyKey, nameEnquiryResult: nameEnquiryResult as unknown as Prisma.InputJsonValue,
          initiatedById,
        },
        include: { loan: true },
      });
      await this.audit.record({
        action: 'loan.booked', resourceType: 'Loan', resourceId: loan.id, branchId: loan.branchId,
        after: { reference: loan.reference, principalKobo: n(loan.principalKobo), applicationId: app.id, offerId: offer.id },
      }, tx);
      await this.audit.record({
        action: 'disbursement.initiated', resourceType: 'DisbursementRequest', resourceId: dr.id,
        after: { loanId: loan.id, amountKobo: n(dr.amountKobo), provider: dr.provider, method: dr.method, idempotencyKey },
      }, tx);
      return dr;
    });

    return this.attemptTransfer(created.id);
  }

  /** Calls the provider for a NAME_ENQUIRY_DONE/FAILED disbursement request and reacts to the result. */
  private async attemptTransfer(disbursementRequestId: string): Promise<DisbursementRequestDto> {
    const dr = await this.prisma.disbursementRequest.findUniqueOrThrow({ where: { id: disbursementRequestId }, include: { loan: true } });
    if (dr.status === 'SUCCESS') return toDto(dr);
    const linkedAccount = dr.linkedAccountId ? await this.prisma.linkedAccount.findUnique({ where: { id: dr.linkedAccountId } }) : null;
    if (!linkedAccount) throw new ConflictException('Disbursement has no linked account on file');
    const accountNumber = this.cipher.decrypt(linkedAccount.accountNumberEnc, aad('linkedaccount', dr.loan.customerId, 'accountNumber'));

    await this.prisma.disbursementRequest.update({ where: { id: dr.id }, data: { status: 'PROCESSING' } });
    let result: { providerRef: string; status: 'PROCESSING' | 'SUCCESS' | 'FAILED' };
    try {
      result = await this.providers.get().initiateTransfer({
        idempotencyKey: dr.idempotencyKey, amountKobo: n(dr.amountKobo)!, accountNumber, bankCode: linkedAccount.bankCode,
        narration: `Loan disbursement ${dr.loan.reference}`,
      });
    } catch (e) {
      return this.markFailed(dr.id, `Provider error: ${(e as Error).message}`);
    }
    if (result.status === 'FAILED') return this.markFailed(dr.id, 'Provider declined the transfer', result.providerRef);
    if (result.status === 'SUCCESS') return this.completeDisbursementDto(dr.id, result.providerRef);
    // PROCESSING: a live provider confirms asynchronously via webhook
    const updated = await this.prisma.disbursementRequest.update({ where: { id: dr.id }, data: { providerRef: result.providerRef }, include: { loan: true } });
    await this.audit.record({ action: 'disbursement.processing', resourceType: 'DisbursementRequest', resourceId: dr.id, metadata: { providerRef: result.providerRef } });
    return toDto(updated);
  }

  private async markFailed(disbursementRequestId: string, reason: string, providerRef?: string): Promise<DisbursementRequestDto> {
    const updated = await this.prisma.disbursementRequest.update({
      where: { id: disbursementRequestId }, data: { status: 'FAILED', failureReason: reason.slice(0, 1000), ...(providerRef ? { providerRef } : {}) }, include: { loan: true },
    });
    await this.audit.record({ action: 'disbursement.failed', resourceType: 'DisbursementRequest', resourceId: disbursementRequestId, outcome: 'FAILURE', metadata: { reason } });
    return toDto(updated);
  }

  /* ───────────────────────── completion (idempotent) ───────────────────────── */

  /** Thin DTO-returning wrapper used by the automated path. */
  private async completeDisbursementDto(disbursementRequestId: string, providerRef: string): Promise<DisbursementRequestDto> {
    await this.completeDisbursement(disbursementRequestId, providerRef);
    const dr = await this.prisma.disbursementRequest.findUniqueOrThrow({ where: { id: disbursementRequestId }, include: { loan: true } });
    return toDto(dr);
  }

  /**
   * Idempotent: a second call (webhook replay, retry race) with the same id is a no-op once already SUCCESS.
   * Finalizes the disbursement: posts the ledger entry, marks SUCCESS, then (outside the DB transaction, since
   * ApplicationTransitions.apply opens its own) advances the application DISBURSED -> ACTIVE.
   */
  async completeDisbursement(disbursementRequestId: string, providerRef: string): Promise<{ loanId: string; alreadyDone: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const dr = await tx.disbursementRequest.findUnique({ where: { id: disbursementRequestId }, include: { loan: true } });
      if (!dr) throw new NotFoundException('Disbursement request not found');
      if (dr.status === 'SUCCESS') return { loanId: dr.loanId, applicationId: dr.loan.applicationId, alreadyDone: true };

      const claim = await tx.disbursementRequest.updateMany({
        where: { id: dr.id, status: { not: 'SUCCESS' } },
        data: { status: 'SUCCESS', providerRef, completedAt: new Date() },
      });
      if (claim.count === 0) return { loanId: dr.loanId, applicationId: dr.loan.applicationId, alreadyDone: true }; // lost the race to a concurrent completion

      await this.ledger.post({
        memo: `Disbursement for loan ${dr.loan.reference}`, sourceType: 'DISBURSEMENT', sourceId: dr.id, loanId: dr.loanId,
        postings: [
          { accountCode: '1100', side: 'DEBIT', amountKobo: n(dr.amountKobo)! },
          { accountCode: '1000', side: 'CREDIT', amountKobo: n(dr.amountKobo)! },
        ],
      }, tx);

      await this.audit.record({
        action: 'disbursement.completed', resourceType: 'DisbursementRequest', resourceId: dr.id,
        after: { status: 'SUCCESS', providerRef, amountKobo: n(dr.amountKobo), loanId: dr.loanId },
      }, tx);

      // Transition Loan.status from DISBURSED → ACTIVE so collections can pick it up.
      await tx.loan.update({ where: { id: dr.loanId }, data: { status: 'ACTIVE' } });

      return { loanId: dr.loanId, applicationId: dr.loan.applicationId, alreadyDone: false };
    });

    if (!result.alreadyDone) {
      try {
        await this.transitions.apply(result.applicationId, 'DISBURSED', SYSTEM_ACTOR);
        await this.transitions.apply(result.applicationId, 'ACTIVE', SYSTEM_ACTOR);
      } catch (e) {
        // the money has moved and the ledger is posted; a transition hiccup (e.g. concurrent modification) is
        // logged, not thrown, so we never retry-resend a transfer because a status update raced.
        this.log.error(`post-disbursement transition failed for application ${result.applicationId}: ${(e as Error).message}`);
      }
    }
    return { loanId: result.loanId, alreadyDone: result.alreadyDone };
  }

  /* ───────────────────────── manual path (maker-checker) ───────────────────────── */

  async initiateManual(applicationId: string, initiatedById: AuthUser, reason: string) {
    const app = await this.prisma.loanApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Application not found');
    const existingLoan = await this.prisma.loan.findUnique({ where: { applicationId } });
    if (existingLoan) throw new ConflictException({ message: 'This application already has a booked loan', code: 'ALREADY_DISBURSED' });
    const offer = await this.prisma.loanOffer.findFirst({ where: { applicationId, status: 'ACCEPTED' } });
    if (!offer) throw new NotFoundException('No accepted offer found for this application');

    return this.approvals.submit(initiatedById, {
      type: 'MANUAL_DISBURSEMENT', summary: `Manual disbursement for application ${app.reference}`, reason, amountKobo: offer.principalKobo,
      payload: { applicationId },
    });
  }

  private manualDisbursementHandler(): ApprovalHandler {
    return {
      type: 'MANUAL_DISBURSEMENT',
      submitPermission: 'loan:disburse_manual',
      validate: (p) => {
        const r = manualDisbursementPayloadSchema.safeParse(p);
        if (!r.success) throw new BadRequestException({ message: 'Invalid payload', code: 'VALIDATION_FAILED', errors: { payload: r.error.issues.map((i) => i.message) } });
        return r.data;
      },
      execute: async (req, tx) => {
        const p = manualDisbursementPayloadSchema.parse(req.payload);
        const app = await tx.loanApplication.findUniqueOrThrow({ where: { id: p.applicationId } });
        const existingLoan = await tx.loan.findUnique({ where: { applicationId: app.id } });
        if (existingLoan) throw new Error('This application already has a booked loan');
        const offer = await tx.loanOffer.findFirst({ where: { applicationId: app.id, status: 'ACCEPTED' } });
        if (!offer) throw new Error('No accepted offer found for this application');
        const schedule = offer.scheduleJson as unknown as OfferScheduleRow[];
        if (!Array.isArray(schedule) || !schedule.length) throw new Error('The accepted offer has no repayment schedule');
        const reference = await allocateLoanReference(tx);
        const now = new Date();
        const lastRow = schedule[schedule.length - 1];

        const loan = await tx.loan.create({
          data: {
            applicationId: app.id, offerId: offer.id, customerId: app.customerId, productId: app.productId, branchId: app.branchId,
            reference, principalKobo: offer.principalKobo, disbursedAmountKobo: offer.principalKobo, tenorMonths: offer.tenorMonths,
            monthlyRateBps: offer.monthlyRateBps, interestMethod: offer.interestMethod, totalCostOfCreditKobo: offer.totalCostOfCreditKobo,
            status: 'ACTIVE', disbursedAt: now, maturityDate: new Date(lastRow.dueDate), outstandingPrincipalKobo: offer.principalKobo,
          },
        });
        await tx.loanInstallment.createMany({
          data: schedule.map((r) => ({
            loanId: loan.id, seq: r.seq, dueDate: new Date(r.dueDate), principalKobo: r.principalKobo, interestKobo: r.interestKobo,
            feeKobo: r.feeKobo, totalKobo: r.totalKobo, paidKobo: 0, status: 'PENDING' as const,
          })),
        });
        const dr = await tx.disbursementRequest.create({
          data: {
            loanId: loan.id, amountKobo: offer.principalKobo, provider: 'MANUAL', method: 'MANUAL', status: 'SUCCESS',
            idempotencyKey: `disb:${app.id}`, approvalRequestId: req.id, initiatedById: req.makerId, completedAt: now,
          },
        });
        await this.ledger.post({
          memo: `Manual disbursement for loan ${loan.reference}`, sourceType: 'DISBURSEMENT', sourceId: dr.id, loanId: loan.id,
          postings: [
            { accountCode: '1100', side: 'DEBIT', amountKobo: n(offer.principalKobo)! },
            { accountCode: '1000', side: 'CREDIT', amountKobo: n(offer.principalKobo)! },
          ],
        }, tx);
        await this.audit.record({
          action: 'loan.booked', resourceType: 'Loan', resourceId: loan.id, branchId: loan.branchId,
          after: { reference: loan.reference, principalKobo: n(loan.principalKobo), applicationId: app.id, offerId: offer.id, method: 'MANUAL' }, metadata: { approvalId: req.id },
        }, tx);
        await this.audit.record({
          action: 'disbursement.completed', resourceType: 'DisbursementRequest', resourceId: dr.id,
          after: { status: 'SUCCESS', loanId: loan.id, method: 'MANUAL' }, metadata: { approvalId: req.id },
        }, tx);
        return { loanId: loan.id, applicationId: app.id };
      },
    };
  }

  /**
   * `ApprovalsService.approve()` (frozen) runs `execute()` inside its OWN prisma transaction and gives modules no
   * post-commit hook, so the booking above cannot safely call `ApplicationTransitions.apply` itself (that would
   * open a second, independent transaction while the approval's transaction might still fail to commit afterwards,
   * e.g. while writing `executionResult` — a classic dual-write hazard). Instead this sweep (run frequently by the
   * disbursement queue scheduler) picks up any MANUAL disbursement whose booking has durably committed (status
   * SUCCESS) but whose application hasn't advanced yet, and finishes the transition through the single source of
   * truth. Idempotent: re-running after the application reaches ACTIVE is a no-op.
   */
  async advancePendingManualBookings(): Promise<number> {
    const rows = await this.prisma.disbursementRequest.findMany({ where: { method: 'MANUAL', status: 'SUCCESS' }, include: { loan: true } });
    let advanced = 0;
    for (const dr of rows) {
      const app = await this.prisma.loanApplication.findUnique({ where: { id: dr.loan.applicationId } });
      if (!app || app.status === 'ACTIVE') continue;
      try {
        if (app.status === 'OFFER_ACCEPTED') await this.transitions.apply(app.id, 'DISBURSED', SYSTEM_ACTOR);
        await this.transitions.apply(app.id, 'ACTIVE', SYSTEM_ACTOR);
        advanced++;
      } catch (e) {
        this.log.error(`could not advance application ${app.id} after manual disbursement: ${(e as Error).message}`);
      }
    }
    return advanced;
  }

  /* ───────────────────────── webhook ───────────────────────── */

  async handleWebhook(providerName: string, rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
    const provider = this.providers.forName(providerName);
    const bodyStr = rawBody.toString('utf8');
    if (!provider.verifyWebhookSignature(bodyStr, signature ?? '')) {
      await this.audit.record({ action: 'webhook.rejected', resourceType: 'Webhook', resourceId: `disbursement:${providerName}`, outcome: 'DENIED', actorName: `${providerName} webhook` });
      throw new BadRequestException({ message: 'Invalid signature', code: 'INVALID_SIGNATURE' });
    }
    let event: Record<string, unknown>;
    try { event = JSON.parse(bodyStr) as Record<string, unknown>; } catch { throw new BadRequestException({ message: 'Malformed payload', code: 'MALFORMED_PAYLOAD' }); }

    const { providerRef, status } = this.parseWebhookEvent(providerName, event);
    if (!providerRef) return { received: true };
    const dr = await this.prisma.disbursementRequest.findFirst({ where: { provider: providerName, providerRef } });
    if (!dr) {
      await this.audit.record({ action: 'webhook.unmatched', resourceType: 'Webhook', resourceId: `disbursement:${providerName}`, metadata: { providerRef, status } });
      return { received: true };
    }
    if (dr.status === 'SUCCESS' || dr.status === 'FAILED') return { received: true }; // idempotent: already terminal

    if (status === 'SUCCESS') {
      await this.completeDisbursement(dr.id, providerRef);
    } else if (status === 'FAILED') {
      await this.markFailed(dr.id, 'Provider reported transfer failure via webhook', providerRef);
    }
    return { received: true };
  }

  /** Normalises each vendor's webhook event shape to {providerRef, status}. TODO(vendor): confirm exact event names/shapes against the live docs once contracted. */
  private parseWebhookEvent(providerName: string, event: Record<string, unknown>): { providerRef: string | null; status: 'SUCCESS' | 'FAILED' | 'PROCESSING' | null } {
    if (providerName === 'paystack') {
      const data = event.data as Record<string, unknown> | undefined;
      const evt = String(event.event ?? '');
      const providerRef = data?.transfer_code ? String(data.transfer_code) : data?.reference ? String(data.reference) : null;
      const status = evt === 'transfer.success' ? 'SUCCESS' : evt === 'transfer.failed' || evt === 'transfer.reversed' ? 'FAILED' : null;
      return { providerRef, status };
    }
    if (providerName === 'flutterwave') {
      const data = event.data as Record<string, unknown> | undefined;
      const providerRef = data?.id !== undefined ? String(data.id) : null;
      const s = String(data?.status ?? '');
      const status = s === 'SUCCESSFUL' ? 'SUCCESS' : s === 'FAILED' ? 'FAILED' : null;
      return { providerRef, status };
    }
    if (providerName === 'mono') {
      const data = (event.data as Record<string, unknown> | undefined) ?? event;
      const providerRef = data?.id !== undefined ? String(data.id) : null;
      const s = String((data as Record<string, unknown>)?.status ?? '');
      const status = s === 'successful' ? 'SUCCESS' : s === 'failed' ? 'FAILED' : null;
      return { providerRef, status };
    }
    return { providerRef: null, status: null };
  }

  /* ───────────────────────── reconciliation (daily cron) ───────────────────────── */

  /**
   * Mocks "fetch provider settlement file": every SUCCESS DisbursementRequest / Repayment from the prior Lagos day
   * becomes an expected settlement line. Since there's no real external file to diff against in mock mode, the
   * "provider" side is simulated with a small deterministic discrepancy rate (~3%, keyed off the external ref so
   * re-runs are stable) — just enough to exercise the UNMATCHED -> ReconciliationException path end-to-end; a live
   * integration would instead diff against the vendor's actual settlement report/API.
   */
  async reconcileDaily(forDate?: Date): Promise<{ matched: number; unmatched: number }> {
    const day = forDate ?? new Date(Date.now() - 24 * 60 * 60_000);
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60_000);

    const [disbursements, repayments] = await Promise.all([
      this.prisma.disbursementRequest.findMany({ where: { status: 'SUCCESS', completedAt: { gte: start, lt: end } } }),
      this.prisma.repayment.findMany({ where: { createdAt: { gte: start, lt: end } } }),
    ]);

    let matched = 0, unmatched = 0;
    for (const d of disbursements) {
      const externalRef = d.providerRef ?? d.idempotencyKey;
      const trueAmount = n(d.amountKobo)!;
      const settledAmount = this.simulateProviderAmount(externalRef, trueAmount);
      const isMatch = settledAmount === trueAmount;
      await this.upsertSettlement({
        provider: d.provider, externalRef, type: 'DISBURSEMENT', amountKobo: settledAmount, valueDate: d.completedAt ?? start,
        rawPayload: { disbursementRequestId: d.id, bookedAmountKobo: trueAmount }, matchedDisbursementId: isMatch ? d.id : undefined, matched: isMatch,
      });
      if (isMatch) matched++; else unmatched++;
    }
    for (const r of repayments) {
      const externalRef = r.receiptNumber;
      const trueAmount = n(r.amountKobo)!;
      const settledAmount = this.simulateProviderAmount(externalRef, trueAmount);
      const isMatch = settledAmount === trueAmount;
      await this.upsertSettlement({
        provider: 'internal', externalRef, type: 'REPAYMENT', amountKobo: settledAmount, valueDate: r.createdAt,
        rawPayload: { repaymentId: r.id, bookedAmountKobo: trueAmount }, matchedRepaymentId: isMatch ? r.id : undefined, matched: isMatch,
      });
      if (isMatch) matched++; else unmatched++;
    }
    this.log.log(`reconciliation for ${start.toISOString().slice(0, 10)}: ${matched} matched, ${unmatched} exceptions raised`);
    return { matched, unmatched };
  }

  /** Deterministic ~3% discrepancy rate keyed off the external ref, so re-running reconciliation for the same day is stable. */
  private simulateProviderAmount(externalRef: string, trueAmountKobo: number): number {
    const h = createHash('sha256').update(externalRef).digest();
    if (h[0] / 255 >= 0.97) return trueAmountKobo + (h[1] % 2 === 0 ? 1 : -1) * (100 + (h[2] % 500));
    return trueAmountKobo;
  }

  private async upsertSettlement(args: {
    provider: string; externalRef: string; type: string; amountKobo: number; valueDate: Date; rawPayload: Record<string, unknown>;
    matchedDisbursementId?: string; matchedRepaymentId?: string; matched: boolean;
  }): Promise<boolean> {
    const status = args.matched ? 'MATCHED' : 'UNMATCHED';
    const rec = await this.prisma.settlementRecord.upsert({
      where: { provider_externalRef: { provider: args.provider, externalRef: args.externalRef } },
      create: {
        provider: args.provider, externalRef: args.externalRef, type: args.type, amountKobo: args.amountKobo, valueDate: args.valueDate,
        rawPayload: args.rawPayload as Prisma.InputJsonValue, matchedDisbursementId: args.matchedDisbursementId ?? null, matchedRepaymentId: args.matchedRepaymentId ?? null, status,
      },
      update: { status, matchedDisbursementId: args.matchedDisbursementId ?? null, matchedRepaymentId: args.matchedRepaymentId ?? null },
    });
    if (!args.matched) {
      await this.prisma.reconciliationException.create({ data: { settlementRecordId: rec.id, reason: 'No matching ledger record found for this settlement line', status: 'OPEN' } });
    }
    return args.matched;
  }

  /* ───────────────────────── failed-transfer retry job ───────────────────────── */

  /** Retries FAILED disbursement requests whose backoff window has elapsed, up to `DISBURSEMENT_MAX_RETRIES` retries.
   *  Backoff: 1h after attempt 1, 4h after attempt 2, 24h after attempt 3+. Ops is notified once retries are exhausted
   *  (i.e. the retry itself also comes back FAILED and no attempts remain). */
  async retryFailedTransfers(): Promise<{ retried: number; exhausted: number }> {
    const candidates = await this.prisma.disbursementRequest.findMany({ where: { status: 'FAILED', method: 'AUTOMATED' }, include: { loan: true } });
    let retried = 0, exhausted = 0;
    for (const dr of candidates) {
      if (dr.retryCount >= this.env.DISBURSEMENT_MAX_RETRIES) continue; // already exhausted (and notified) on a prior pass
      const backoff = RETRY_BACKOFF_MS[Math.min(dr.retryCount, RETRY_BACKOFF_MS.length - 1)];
      const readyAt = (dr.completedAt ?? dr.createdAt).getTime() + backoff;
      if (Date.now() < readyAt) continue;

      const nextRetryCount = dr.retryCount + 1;
      const claim = await this.prisma.disbursementRequest.updateMany({ where: { id: dr.id, status: 'FAILED' }, data: { retryCount: nextRetryCount, status: 'NAME_ENQUIRY_DONE' } });
      if (claim.count === 0) continue;
      await this.audit.record({ action: 'disbursement.retry', resourceType: 'DisbursementRequest', resourceId: dr.id, metadata: { retryCount: nextRetryCount } });
      retried++;

      const after = await this.attemptTransfer(dr.id);
      if (after.status === 'FAILED' && nextRetryCount >= this.env.DISBURSEMENT_MAX_RETRIES) {
        await this.notifyOpsRetriesExhausted(dr.id, dr.loan.reference);
        exhausted++;
      }
    }
    return { retried, exhausted };
  }

  private async notifyOpsRetriesExhausted(disbursementRequestId: string, loanReference: string): Promise<void> {
    await this.audit.record({ action: 'disbursement.retries_exhausted', resourceType: 'DisbursementRequest', resourceId: disbursementRequestId, outcome: 'FAILURE', metadata: { loanReference } });
    const ops = await this.prisma.staffUser.findMany({ where: { status: 'ACTIVE', role: { permissions: { some: { permission: { key: 'loan:disburse' } } } } }, select: { id: true } });
    await this.notifications.notifyUsers(ops.map((o) => o.id), 'Disbursement retries exhausted', `Loan ${loanReference} could not be disbursed after ${this.env.DISBURSEMENT_MAX_RETRIES} attempts. Manual intervention required.`, `/loans?ref=${loanReference}`);
  }
}
