/**
 * Pure helpers for turning a principal/tenor/pricing triple into the LoanOffer's persisted schedule + totals.
 * No Nest/Prisma here so this is trivially unit-testable; `OfferService` wires it to the DB.
 */
import { buildSchedule, type InterestMethod } from '@damez/shared';
import type { OfferScheduleRowDto } from '@damez/shared';
import type { PricingSnapshot } from '../applications/mappers';

export interface OfferComputationInput {
  principalKobo: number;
  tenorMonths: number;
  pricing: PricingSnapshot;
  /** staff may override the rate on a counter-offer; defaults to the pricing snapshot's rate */
  monthlyRateBps?: number;
  startDate?: Date;
}

export interface OfferComputation {
  monthlyRateBps: number;
  interestMethod: InterestMethod;
  totalInterestKobo: number;
  totalFeesKobo: number;
  totalPenaltyProjectedKobo: number;
  totalCostOfCreditKobo: number;
  totalRepayableKobo: number;
  schedule: OfferScheduleRowDto[];
}

/** Projected penalty exposure disclosed on the offer: one grace-period-exceeding late instalment at the penalty rate, for disclosure purposes only. */
function projectedPenaltyKobo(pricing: PricingSnapshot, typicalInstalmentKobo: number): number {
  if (!pricing.penaltyBpsPerDay) return 0;
  const days = 30; // disclose a full month of lateness as the illustrative worst case
  return Math.round((typicalInstalmentKobo * pricing.penaltyBpsPerDay * days) / 10_000);
}

export function computeOffer(input: OfferComputationInput): OfferComputation {
  const monthlyRateBps = input.monthlyRateBps ?? input.pricing.monthlyRateBps;
  const { schedule, cost } = buildSchedule({
    principalKobo: input.principalKobo,
    tenorMonths: input.tenorMonths,
    monthlyRateBps,
    method: input.pricing.interestMethod,
    processingFeeBps: input.pricing.processingFeeBps,
    managementFeeBps: input.pricing.managementFeeBps,
    insuranceFeeBps: input.pricing.insuranceFeeBps,
    penaltyBpsPerDay: input.pricing.penaltyBpsPerDay,
    penaltyGraceDays: input.pricing.penaltyGraceDays,
    graceMonths: Math.floor(input.pricing.gracePeriodDays / 30),
    startDate: input.startDate,
  });

  const rows: OfferScheduleRowDto[] = schedule.map((l) => ({
    seq: l.n,
    dueDate: l.dueDate,
    principalKobo: l.principalKobo,
    interestKobo: l.interestKobo,
    feeKobo: 0, // fees are charged upfront (deducted from disbursement), not spread across instalments
    totalKobo: l.totalKobo,
    balanceAfterKobo: l.balanceKobo,
  }));

  return {
    monthlyRateBps,
    interestMethod: input.pricing.interestMethod,
    totalInterestKobo: cost.totalInterestKobo,
    totalFeesKobo: cost.totalFeesKobo,
    totalPenaltyProjectedKobo: projectedPenaltyKobo(input.pricing, cost.monthlyInstalmentKobo),
    totalCostOfCreditKobo: cost.totalCostOfCreditKobo,
    totalRepayableKobo: cost.totalRepayableKobo,
    schedule: rows,
  };
}
