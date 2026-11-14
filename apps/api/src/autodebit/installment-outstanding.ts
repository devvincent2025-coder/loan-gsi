import type { AllocationTarget } from '../common/repayment-allocation';

/**
 * `LoanInstallment` stores a single aggregate `paidKobo` against `totalKobo` (principal+interest+fee), plus a
 * separately-tracked `penaltyAccruedKobo` that has no matching "paid" column. We recover a per-bucket outstanding
 * breakdown (for `allocateRepayment`) by replaying the SAME penalty→fee→interest→principal waterfall that every
 * repayment (autodebit or manual) uses: `paidKobo` is assumed to have been applied fee→interest→principal, in that
 * order, since penalty is accounted for separately via `penaltyAccruedKobo` (reduced directly as it is collected).
 *
 * ASSUMPTION (documented for the loan-servicing / ledger agents to reconcile): penalty collected does not count
 * toward `paidKobo`; only the fee/interest/principal portion of a payment does.
 */
export interface InstallmentLike {
  feeKobo: bigint | number;
  interestKobo: bigint | number;
  principalKobo: bigint | number;
  paidKobo: bigint | number;
  penaltyAccruedKobo: bigint | number;
}

const n = (v: bigint | number): number => (typeof v === 'bigint' ? Number(v) : v);

export function outstandingTarget(inst: InstallmentLike): AllocationTarget {
  let remaining = Math.max(0, n(inst.paidKobo));
  const take = (bucket: number) => {
    const amt = Math.min(remaining, Math.max(0, bucket));
    remaining -= amt;
    return amt;
  };
  const feePaid = take(n(inst.feeKobo));
  const interestPaid = take(n(inst.interestKobo));
  const principalPaid = take(n(inst.principalKobo));
  return {
    penaltyOutstandingKobo: Math.max(0, n(inst.penaltyAccruedKobo)),
    feeOutstandingKobo: Math.max(0, n(inst.feeKobo) - feePaid),
    interestOutstandingKobo: Math.max(0, n(inst.interestKobo) - interestPaid),
    principalOutstandingKobo: Math.max(0, n(inst.principalKobo) - principalPaid),
  };
}

export function totalOutstandingKobo(inst: InstallmentLike): number {
  const t = outstandingTarget(inst);
  return t.penaltyOutstandingKobo + t.feeOutstandingKobo + t.interestOutstandingKobo + t.principalOutstandingKobo;
}
