/**
 * Pure repayment allocation: penalty, then fees, then interest, then principal (CLAUDE.md autodebit rules).
 * Money in kobo integers throughout. Used by the debit engine, manual repayment and early/part-repayment flows.
 */
export interface AllocationTarget {
  penaltyOutstandingKobo: number;
  feeOutstandingKobo: number;
  interestOutstandingKobo: number;
  principalOutstandingKobo: number;
}

export interface Allocation {
  penaltyKobo: number;
  feeKobo: number;
  interestKobo: number;
  principalKobo: number;
  /** amount left over after clearing every bucket (e.g. an early repayment larger than the balance) */
  unallocatedKobo: number;
}

export function allocateRepayment(amountKobo: number, target: AllocationTarget): Allocation {
  let remaining = Math.max(0, Math.trunc(amountKobo));
  const take = (bucket: number) => {
    const amt = Math.min(remaining, Math.max(0, Math.trunc(bucket)));
    remaining -= amt;
    return amt;
  };
  const penaltyKobo = take(target.penaltyOutstandingKobo);
  const feeKobo = take(target.feeOutstandingKobo);
  const interestKobo = take(target.interestOutstandingKobo);
  const principalKobo = take(target.principalOutstandingKobo);
  return { penaltyKobo, feeKobo, interestKobo, principalKobo, unallocatedKobo: remaining };
}
