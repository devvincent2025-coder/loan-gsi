import { Injectable } from '@nestjs/common';
import type { FacilityStatus } from '@damez/shared';
import type { LoanPortfolioPort, PerformanceRecord } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';
// Read-only imports from the frozen applications module: reused to replicate the EXACT phase-2 fallback heuristic
// (not edited) for customers who have not yet had a Loan booked.
import { readPricing } from '../applications/mappers';
import { BOOKED } from '../applications/state-machine';
import { totalOutstandingKobo } from './servicing-logic';
import { toPlainInstallment } from './mappers';

const aad = (id: string, f: string) => `customer:${id}:${f}`;
const ACTIVE_LOAN_STATUSES = ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED'] as const;

/**
 * Prompt-3 implementation of LOAN_PORTFOLIO_PORT: backed by the real Loan/LoanInstallment/Repayment ledger tables.
 * Replaces ApplicationLoanPortfolio (phase-2 placeholder) without the consumers (bureau furnishing/monitoring,
 * eligibility) changing at all. `internalHistory` merges Loan-based facts with the old application-based heuristic
 * for customers who have no Loan row yet, so eligibility does not regress for customers still in origination.
 */
@Injectable()
export class LedgerLoanPortfolio implements LoanPortfolioPort {
  constructor(private prisma: PrismaService, private cipher: FieldCipher) {}

  async listActiveBorrowerIds(): Promise<string[]> {
    const rows = await this.prisma.loan.findMany({ where: { status: { in: [...ACTIVE_LOAN_STATUSES] } }, select: { customerId: true }, distinct: ['customerId'] });
    return rows.map((r) => r.customerId);
  }

  async listPerformance(period: string): Promise<PerformanceRecord[]> {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) throw new Error('period must be yyyy-mm');
    const periodEnd = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0, 23, 59, 59));
    const loans = await this.prisma.loan.findMany({
      where: { disbursedAt: { lte: periodEnd } }, include: { customer: true, product: true, installments: true, repayments: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { disbursedAt: 'asc' },
    });
    const out: PerformanceRecord[] = [];
    for (const loan of loans) {
      const c = loan.customer;
      if (!c.bvnEnc) continue; // cannot be furnished without a BVN
      const installments = loan.installments;
      const typicalInstalmentKobo = installments.length ? Number(installments[0].totalKobo) : 0;
      const lastPaymentAt = loan.repayments[0]?.createdAt ?? null;

      let status: FacilityStatus = 'PERFORMING';
      let outstandingKobo = Number(loan.outstandingPrincipalKobo);
      let dpd = loan.dpd;
      let closedAt: Date | null = null;
      let writtenOffAt: Date | null = null;

      if (loan.closedAt && loan.closedAt <= periodEnd) {
        status = 'CLOSED'; outstandingKobo = 0; dpd = 0; closedAt = loan.closedAt;
      } else if (loan.writtenOffAt && loan.writtenOffAt <= periodEnd) {
        status = 'WRITTEN_OFF'; outstandingKobo = Number(loan.writtenOffAmountKobo ?? 0n); writtenOffAt = loan.writtenOffAt;
      } else if (loan.status === 'Unpaid') {
        status = dpd >= 90 ? 'DEFAULTED' : 'Unpaid';
        outstandingKobo = totalOutstandingKobo(installments.map(toPlainInstallment));
      } else {
        outstandingKobo = totalOutstandingKobo(installments.map(toPlainInstallment));
      }

      out.push({
        customerId: c.id, bvn: this.cipher.decrypt(c.bvnEnc, aad(c.id, 'bvn')), fullName: `${c.firstName} ${c.lastName}`,
        phone: this.cipher.decrypt(c.phoneEnc, aad(c.id, 'phone')), facilityRef: loan.reference, productType: loan.product.name,
        openedAt: loan.disbursedAt, amountGrantedKobo: Number(loan.principalKobo), outstandingKobo, monthlyPaymentKobo: typicalInstalmentKobo,
        tenorMonths: loan.tenorMonths, dpd, status, lastPaymentAt, closedAt, writtenOffAt,
      });
    }
    return out;
  }

  async internalHistory(customerId: string): Promise<{ completedLoans: number; lateInstalments: number; activeLoan: boolean; writtenOff: boolean }> {
    const loans = await this.prisma.loan.findMany({ where: { customerId } });
    if (loans.length === 0) return this.applicationFallback(customerId);

    const installments = await this.prisma.loanInstallment.findMany({ where: { loanId: { in: loans.map((l) => l.id) } } });
    const lateInstalments = installments.filter((i) => i.status === 'OVERDUE' || (i.paidAt && i.paidAt > i.dueDate)).length;
    return {
      completedLoans: loans.filter((l) => l.status === 'CLOSED').length,
      lateInstalments,
      activeLoan: loans.some((l) => (ACTIVE_LOAN_STATUSES as readonly string[]).includes(l.status)),
      writtenOff: loans.some((l) => l.status === 'WRITTEN_OFF'),
    };
  }

  /** Exact replica of the retired ApplicationLoanPortfolio.internalHistory, for customers with no Loan row yet. */
  private async applicationFallback(customerId: string) {
    const apps = await this.prisma.loanApplication.findMany({ where: { customerId, status: { in: [...BOOKED, 'CLOSED', 'WRITTEN_OFF'] } }, select: { status: true, pricing: true } });
    const Unpaid = apps.filter((a) => a.status === 'Unpaid');
    return {
      completedLoans: apps.filter((a) => a.status === 'CLOSED').length,
      lateInstalments: Unpaid.reduce((s, a) => s + (readPricing(a.pricing).simulatedLateInstalments ?? 2), 0),
      activeLoan: apps.some((a) => (BOOKED as string[]).includes(a.status)),
      writtenOff: apps.some((a) => a.status === 'WRITTEN_OFF'),
    };
  }
}
