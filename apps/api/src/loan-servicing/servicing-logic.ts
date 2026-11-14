/**
 * Pure, side-effect-free loan servicing math: repayment allocation across many instalments, outstanding-balance
 * computation (the zero-balance closure trigger) and delinquency dpd / penalty-accrual computation.
 * Money in kobo integers throughout. No Prisma/Nest imports here so this file is cheaply unit-testable.
 */
import { allocateRepayment, type AllocationTarget } from '../common/repayment-allocation';

export type InstallmentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface InstallmentLike {
  id: string;
  totalKobo: number;
  principalKobo: number;
  interestKobo: number;
  feeKobo: number;
  paidKobo: number;
  penaltyAccruedKobo: number;
  status: InstallmentStatus;
}

/**
 * Breaks an instalment's obligation into outstanding buckets. `penaltyAccruedKobo` is tracked directly (its own
 * bucket, decremented as it is paid). `paidKobo` is the cumulative amount ever applied towards fee→interest→principal
 * (in that priority order) of `totalKobo`, so the fee/interest/principal buckets are derived by "unwinding" paidKobo
 * through that same priority.
 */
export function installmentOutstanding(i: InstallmentLike): AllocationTarget {
  const feeOutstandingKobo = Math.max(0, i.feeKobo - Math.min(i.paidKobo, i.feeKobo));
  const afterFee = Math.max(0, i.paidKobo - i.feeKobo);
  const interestOutstandingKobo = Math.max(0, i.interestKobo - Math.min(afterFee, i.interestKobo));
  const afterInterest = Math.max(0, afterFee - i.interestKobo);
  const principalOutstandingKobo = Math.max(0, i.principalKobo - Math.min(afterInterest, i.principalKobo));
  return { penaltyOutstandingKobo: i.penaltyAccruedKobo, feeOutstandingKobo, interestOutstandingKobo, principalOutstandingKobo };
}

export function installmentTotalOutstandingKobo(i: InstallmentLike): number {
  const t = installmentOutstanding(i);
  return t.penaltyOutstandingKobo + t.feeOutstandingKobo + t.interestOutstandingKobo + t.principalOutstandingKobo;
}

/** Sum of every instalment's outstanding balance (penalty+fee+interest+principal). Zero means the loan may close. */
export function totalOutstandingKobo(installments: InstallmentLike[]): number {
  return installments.reduce((s, i) => s + installmentTotalOutstandingKobo(i), 0);
}

export interface InstallmentUpdate {
  id: string;
  newPaidKobo: number;
  newPenaltyAccruedKobo: number;
  newStatus: InstallmentStatus;
}

export interface AllocationAcrossResult {
  updates: InstallmentUpdate[];
  totalPenaltyKobo: number;
  totalFeeKobo: number;
  totalInterestKobo: number;
  totalPrincipalKobo: number;
  /** left over after every instalment (including future, not-yet-due ones) is fully cleared */
  unallocatedKobo: number;
}

/**
 * Spreads `amountKobo` across `installments` (expected in ascending due-date/seq order) using the standard
 * penalty→fee→interest→principal priority on EACH instalment before moving to the next. This naturally supports:
 *  - a scheduled/partial payment that only reaches the next due instalment or two,
 *  - an early/top-up payment that overpays and reduces principal on FUTURE (not yet due) instalments too,
 * because the loop simply keeps consuming instalments, in order, until the amount or the instalments run out.
 */
export function allocateAcrossInstallments(installments: InstallmentLike[], amountKobo: number): AllocationAcrossResult {
  let remaining = Math.max(0, Math.trunc(amountKobo));
  const updates: InstallmentUpdate[] = [];
  let totalPenaltyKobo = 0;
  let totalFeeKobo = 0;
  let totalInterestKobo = 0;
  let totalPrincipalKobo = 0;

  for (const inst of installments) {
    if (remaining <= 0) break;
    const target = installmentOutstanding(inst);
    const due = target.penaltyOutstandingKobo + target.feeOutstandingKobo + target.interestOutstandingKobo + target.principalOutstandingKobo;
    if (due <= 0) continue; // already fully settled
    const alloc = allocateRepayment(remaining, target);
    const consumed = alloc.penaltyKobo + alloc.feeKobo + alloc.interestKobo + alloc.principalKobo;
    if (consumed <= 0) continue;
    remaining -= consumed;

    totalPenaltyKobo += alloc.penaltyKobo;
    totalFeeKobo += alloc.feeKobo;
    totalInterestKobo += alloc.interestKobo;
    totalPrincipalKobo += alloc.principalKobo;

    const newPenaltyAccruedKobo = inst.penaltyAccruedKobo - alloc.penaltyKobo;
    const newPaidKobo = inst.paidKobo + alloc.feeKobo + alloc.interestKobo + alloc.principalKobo;
    const newStatus: InstallmentStatus = newPaidKobo >= inst.totalKobo && newPenaltyAccruedKobo <= 0 ? 'PAID' : newPaidKobo > 0 ? 'PARTIAL' : inst.status;
    updates.push({ id: inst.id, newPaidKobo, newPenaltyAccruedKobo, newStatus });
  }

  return { updates, totalPenaltyKobo, totalFeeKobo, totalInterestKobo, totalPrincipalKobo, unallocatedKobo: remaining };
}

/** Applies the `updates` from allocateAcrossInstallments onto a plain instalment list, for recomputing totals in-memory. */
export function applyUpdates(installments: InstallmentLike[], updates: InstallmentUpdate[]): InstallmentLike[] {
  const byId = new Map(updates.map((u) => [u.id, u]));
  return installments.map((i) => {
    const u = byId.get(i.id);
    return u ? { ...i, paidKobo: u.newPaidKobo, penaltyAccruedKobo: u.newPenaltyAccruedKobo, status: u.newStatus } : i;
  });
}

/** Days between the oldest unpaid instalment's due date and `asOf` (0 if none overdue or no unpaid instalments). */
export function computeDpd(oldestUnpaidDueDate: Date | null, asOf: Date): number {
  if (!oldestUnpaidDueDate) return 0;
  const ms = asOf.getTime() - oldestUnpaidDueDate.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * One day's worth of penalty on a single instalment's outstanding total, respecting the product's grace period.
 * Intended to be called once per overdue instalment per cron run (the cron runs daily).
 */
export function computeDailyPenaltyIncrementKobo(outstandingKobo: number, penaltyBpsPerDay: number, dpd: number, graceDays: number): number {
  if (outstandingKobo <= 0 || penaltyBpsPerDay <= 0 || dpd <= graceDays) return 0;
  return Math.round((outstandingKobo * penaltyBpsPerDay) / 10_000);
}
