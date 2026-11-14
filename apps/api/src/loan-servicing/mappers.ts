import type { Loan, LoanInstallment, Mandate, Repayment } from '@prisma/client';
import type {
  InstallmentStatus, LoanDto, LoanInstallmentDto, LoanStatus, MandateDto, RepaymentDto, RepaymentKind, RepaymentMethod,
} from '@damez/shared';
import { totalOutstandingKobo, type InstallmentLike } from './servicing-logic';

export function toPlainInstallment(i: Pick<LoanInstallment, 'id' | 'totalKobo' | 'principalKobo' | 'interestKobo' | 'feeKobo' | 'paidKobo' | 'penaltyAccruedKobo' | 'status'>): InstallmentLike {
  return {
    id: i.id, totalKobo: Number(i.totalKobo), principalKobo: Number(i.principalKobo), interestKobo: Number(i.interestKobo),
    feeKobo: Number(i.feeKobo), paidKobo: Number(i.paidKobo), penaltyAccruedKobo: Number(i.penaltyAccruedKobo), status: i.status as InstallmentStatus,
  };
}

export function installmentDto(i: LoanInstallment): LoanInstallmentDto {
  return {
    id: i.id, seq: i.seq, dueDate: i.dueDate.toISOString().slice(0, 10),
    principalKobo: Number(i.principalKobo), interestKobo: Number(i.interestKobo), feeKobo: Number(i.feeKobo),
    totalKobo: Number(i.totalKobo), paidKobo: Number(i.paidKobo), penaltyAccruedKobo: Number(i.penaltyAccruedKobo),
    status: i.status as InstallmentStatus, paidAt: i.paidAt?.toISOString() ?? null,
  };
}

export function repaymentDto(r: Repayment): RepaymentDto {
  return {
    id: r.id, loanId: r.loanId, receiptNumber: r.receiptNumber, kind: r.kind as RepaymentKind, method: r.method as RepaymentMethod,
    amountKobo: Number(r.amountKobo), allocatedPenaltyKobo: Number(r.allocatedPenaltyKobo), allocatedFeeKobo: Number(r.allocatedFeeKobo),
    allocatedInterestKobo: Number(r.allocatedInterestKobo), allocatedPrincipalKobo: Number(r.allocatedPrincipalKobo),
    createdAt: r.createdAt.toISOString(),
  };
}

export function mandateDto(m: Mandate): MandateDto {
  return {
    id: m.id, type: m.type as MandateDto['type'], provider: m.provider, status: m.status as MandateDto['status'],
    linkedAccountId: m.linkedAccountId, cardLast4: m.cardLast4, priority: m.priority,
    activatedAt: m.activatedAt?.toISOString() ?? null, failureReason: m.failureReason,
  };
}

export function loanDto(
  loan: Loan & { customer: { firstName: string; lastName: string }; product: { name: string } },
  installments: LoanInstallment[],
): LoanDto {
  return {
    id: loan.id, applicationId: loan.applicationId, reference: loan.reference, customerId: loan.customerId,
    customerName: `${loan.customer.firstName} ${loan.customer.lastName}`, productId: loan.productId, productName: loan.product.name,
    branchId: loan.branchId, principalKobo: Number(loan.principalKobo), disbursedAmountKobo: Number(loan.disbursedAmountKobo),
    tenorMonths: loan.tenorMonths, monthlyRateBps: loan.monthlyRateBps, totalCostOfCreditKobo: Number(loan.totalCostOfCreditKobo),
    status: loan.status as LoanStatus, disbursedAt: loan.disbursedAt.toISOString(), maturityDate: loan.maturityDate.toISOString(),
    outstandingPrincipalKobo: Number(loan.outstandingPrincipalKobo), outstandingTotalKobo: totalOutstandingKobo(installments.map(toPlainInstallment)),
    dpd: loan.dpd, ifrsStage: loan.ifrsStage, restructureCount: loan.restructureCount,
    closedAt: loan.closedAt?.toISOString() ?? null, writtenOffAt: loan.writtenOffAt?.toISOString() ?? null,
    writtenOffAmountKobo: loan.writtenOffAmountKobo === null ? null : Number(loan.writtenOffAmountKobo),
  };
}
