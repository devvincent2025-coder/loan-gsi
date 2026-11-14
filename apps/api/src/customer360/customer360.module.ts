import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
} from '@nestjs/common';
import {
  CollectionCaseDto,
  Customer360Dto,
  Customer360LoanDto,
  EarlyWarningFlagDto,
  LinkedAccountSummaryDto,
  maskEmail,
  maskName,
  maskPhone,
  RepaymentTimelineEntryDto,
} from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser, canSeeBranch } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { n } from '../common/bigint';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { BehaviourModule, BehaviourSnapshotService } from '../behaviour/behaviour.module';

const aad = (id: string, field: string) => `customer:${id}:${field}`;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class Customer360Service {
  constructor(
    private prisma: PrismaService,
    private cipher: FieldCipher,
    private audit: AuditService,
    private behaviour: BehaviourSnapshotService,
  ) {}

  async get(user: AuthUser, customerId: string): Promise<Customer360Dto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { branch: true },
    });
    if (!customer || customer.erasedAt || !canSeeBranch(user, customer.branchId)) {
      throw new NotFoundException('Customer not found');
    }

    const dec = (v: string | null, f: string): string | null => {
      try {
        return v ? this.cipher.decrypt(v, aad(customerId, f)) : null;
      } catch {
        return null;
      }
    };

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [
      loans,
      latestSnap,
      activeCase,
      earlyWarningRows,
      repayments,
      debitAttempts,
      communicationsCount,
      lastActivity,
      linkedAccounts,
      riskFlags,
    ] = await Promise.all([
      this.prisma.loan.findMany({
        where: { customerId },
        include: { product: { select: { name: true } } },
        orderBy: { disbursedAt: 'desc' },
      }),
      this.behaviour.getLatestSnapshot(customerId),
      this.prisma.collectionCase.findFirst({
        where: { customerId, status: { not: 'CLOSED' } },
        include: {
          loan: { select: { reference: true, product: { select: { name: true } } } },
          activities: { orderBy: { contactedAt: 'desc' }, take: 1 },
          promisesToPay: { where: { status: 'PENDING' } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.earlyWarningFlag.findMany({
        where: { customerId, status: 'OPEN' },
        orderBy: { flagDate: 'desc' },
      }),
      this.prisma.repayment.findMany({
        where: { loan: { customerId }, createdAt: { gte: ninetyDaysAgo } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.debitAttempt.findMany({
        where: { loan: { customerId }, scheduledFor: { gte: ninetyDaysAgo } },
        orderBy: { scheduledFor: 'desc' },
      }),
      this.prisma.collectionActivity.count({ where: { case: { customerId } } }),
      this.prisma.collectionActivity.findFirst({
        where: { case: { customerId } },
        orderBy: { contactedAt: 'desc' },
        select: { contactedAt: true },
      }),
      this.prisma.linkedAccount.findMany({
        where: { customerId, removedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { priority: 'asc' }],
      }),
      this.prisma.customerRiskFlag.findMany({
        where: { customerId, active: true },
        select: { type: true },
      }),
    ]);

    // Fetch loan repayments for outstanding calculation
    const loanIds = loans.map((l) => l.id);
    const allRepayments =
      loanIds.length > 0
        ? await this.prisma.repayment.findMany({ where: { loanId: { in: loanIds } }, select: { loanId: true, amountKobo: true } })
        : [];
    const repaidByLoan = new Map<string, number>();
    for (const r of allRepayments) {
      repaidByLoan.set(r.loanId, (repaidByLoan.get(r.loanId) ?? 0) + Number(r.amountKobo));
    }

    const loanDtos: Customer360LoanDto[] = loans.map((l) => ({
      loanId: l.id,
      reference: l.reference,
      productName: l.product.name,
      principalKobo: n(l.principalKobo) ?? 0,
      outstandingKobo: Math.max(0, Number(l.principalKobo) - (repaidByLoan.get(l.id) ?? 0)),
      status: l.status,
      dpd: l.dpd,
      ifrsStage: l.ifrsStage,
      disbursedAt: l.disbursedAt.toISOString(),
      maturityDate: l.maturityDate.toISOString(),
    }));

    // Repayment timeline
    const timeline: RepaymentTimelineEntryDto[] = [];

    for (const r of repayments) {
      timeline.push({
        date: r.createdAt.toISOString(),
        type: 'REPAYMENT',
        amountKobo: n(r.amountKobo),
        status: r.kind,
        channel: r.method,
        notes: null,
      });
    }
    for (const d of debitAttempts) {
      timeline.push({
        date: d.scheduledFor.toISOString(),
        type: 'DEBIT_ATTEMPT',
        amountKobo: n(d.amountKobo),
        status: d.status,
        channel: d.method,
        notes: d.failureReason ?? null,
      });
    }
    if (activeCase) {
      for (const ptp of activeCase.promisesToPay) {
        timeline.push({
          date: ptp.promisedDate.toISOString(),
          type: 'PTP',
          amountKobo: n(ptp.amountKobo),
          status: ptp.status,
          channel: null,
          notes: null,
        });
      }
    }
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // LinkedAccounts
    const linkedAccountDtos: LinkedAccountSummaryDto[] = linkedAccounts.map((la) => {
      const rawName = dec(la.accountNameEnc, 'accountName');
      const rawNumber = dec(la.accountNumberEnc, 'accountNumber');
      return {
        id: la.id,
        bankCode: la.bankCode,
        accountNameMasked: rawName ? maskName(rawName) : '***',
        accountNumberMasked: rawNumber ? rawNumber.replace(/.(?=.{4})/g, '*') : '**********',
        isPrimary: la.isPrimary,
        status: la.status,
      };
    });

    // Fetch loan references for early warnings
    const warningLoanIds = [...new Set(earlyWarningRows.map((r) => r.loanId))];
    const warningLoans =
      warningLoanIds.length > 0
        ? await this.prisma.loan.findMany({ where: { id: { in: warningLoanIds } }, select: { id: true, reference: true } })
        : [];
    const warningLoanMap = new Map(warningLoans.map((l) => [l.id, l]));
    const maskedName = maskName(`${customer.firstName} ${customer.lastName}`);

    const warningDtos: EarlyWarningFlagDto[] = earlyWarningRows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerName: maskedName,
      loanId: r.loanId,
      loanReference: warningLoanMap.get(r.loanId)?.reference ?? r.loanId,
      flagDate: r.flagDate.toISOString(),
      pdScore: r.pdScore,
      triggerReason: r.triggerReason,
      status: r.status,
      actionTakenAt: r.actionTakenAt?.toISOString() ?? null,
      actionNote: r.actionNote,
      createdAt: r.createdAt.toISOString(),
    }));

    // Active case DTO
    let activeCaseDto: CollectionCaseDto | null = null;
    if (activeCase) {
      const lastAct = activeCase.activities[0];
      const openPtpAmount = activeCase.promisesToPay.reduce((s, p) => s + Number(p.amountKobo), 0);
      activeCaseDto = {
        id: activeCase.id,
        loanId: activeCase.loanId,
        customerId: activeCase.customerId,
        customerName: maskedName,
        customerPhone: maskPhone(dec(customer.phoneEnc, 'phone')),
        branchId: activeCase.branchId ?? null,
        assignedToId: activeCase.assignedToId,
        assignedToName: activeCase.assignedToName,
        bucket: activeCase.bucket as CollectionCaseDto['bucket'],
        dpd: activeCase.dpd,
        status: activeCase.status as CollectionCaseDto['status'],
        priority: activeCase.priority,
        totalOutstandingKobo: n(activeCase.totalOutstandingKobo) ?? 0,
        loanReference: activeCase.loan.reference,
        productName: activeCase.loan.product.name,
        agencyId: activeCase.agencyId,
        legalCaseRef: activeCase.legalCaseRef,
        lastActivityAt: lastAct?.contactedAt.toISOString() ?? null,
        nextActionAt: null,
        promiseCount: activeCase.promisesToPay.length,
        openPtpAmount,
        createdAt: activeCase.createdAt.toISOString(),
        updatedAt: activeCase.updatedAt.toISOString(),
      };
    }

    await this.audit.record({
      action: 'customer360.viewed',
      resourceType: 'Customer',
      resourceId: customerId,
      branchId: customer.branchId,
    });

    const phone = dec(customer.phoneEnc, 'phone');
    const email = dec(customer.emailEnc ?? null, 'email');

    return {
      customerId: customer.id,
      displayName: maskedName,
      phone: maskPhone(phone),
      email: email ? maskEmail(email) : null,
      kycTier: customer.kycTier,
      riskFlags: riskFlags.map((f) => f.type),
      segment: latestSnap?.segment ?? 'UNKNOWN',
      pdScore: latestSnap?.pdScore ?? 0,
      behaviourSummary: latestSnap?.summaryText ?? 'No behavioural data available yet.',
      loans: loanDtos,
      activeCase: activeCaseDto,
      earlyWarnings: warningDtos,
      repaymentTimeline: timeline,
      linkedAccounts: linkedAccountDtos,
      communicationsCount,
      lastContactAt: lastActivity?.contactedAt.toISOString() ?? null,
    };
  }
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller()
class Customer360Controller {
  constructor(private svc: Customer360Service) {}

  @Get('customers/:customerId/360')
  @RequirePermission('customer360:read')
  get(@CurrentUser() u: AuthUser, @Param('customerId') customerId: string) {
    return this.svc.get(u, customerId);
  }
}

// ─── Module ───────────────────────────────────────────────────────────────────

@Module({
  imports: [BehaviourModule],
  providers: [Customer360Service],
  controllers: [Customer360Controller],
  exports: [Customer360Service],
})
export class Customer360Module {}
