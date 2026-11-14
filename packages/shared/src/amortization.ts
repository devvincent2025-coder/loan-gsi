/**
 * Amortization schedule + total cost of credit disclosure. Pure, integer-kobo arithmetic.
 *  FLAT: interest = principal × monthlyRate × n, spread evenly; instalment = (P + I) / n
 *  REDUCING_BALANCE: equal instalments (annuity) with interest on the outstanding balance
 * Rounding: half-up to the kobo each period; the FINAL instalment absorbs the remainder so totals are exact.
 * Fees (processing / management / insurance, in bps of principal) are charged upfront and deducted from the disbursement.
 */
export type InterestMethod = 'FLAT' | 'REDUCING_BALANCE';

export interface AmortizationInput {
  principalKobo: number;
  /** basis points per month, 450 = 4.50% */
  monthlyRateBps: number;
  tenorMonths: number;
  method: InterestMethod;
  processingFeeBps?: number;
  managementFeeBps?: number;
  insuranceFeeBps?: number;
  /** first instalment date; defaults to one month after `startDate` */
  startDate?: Date;
  /** months before the first instalment falls due (interest accrues for reducing balance), default 0 */
  graceMonths?: number;
  penaltyBpsPerDay?: number;
  penaltyGraceDays?: number;
}

export interface ScheduleLine {
  n: number;
  /** ISO date (yyyy-mm-dd) */
  dueDate: string;
  principalKobo: number;
  interestKobo: number;
  totalKobo: number;
  balanceKobo: number;
}

export interface CostOfCredit {
  principalKobo: number;
  totalInterestKobo: number;
  processingFeeKobo: number;
  managementFeeKobo: number;
  insuranceFeeKobo: number;
  totalFeesKobo: number;
  /** principal + interest (what the borrower repays in instalments) */
  totalRepayableKobo: number;
  /** principal − upfront fees (what lands in the borrower's account) */
  netDisbursedKobo: number;
  /** interest + fees */
  totalCostOfCreditKobo: number;
  monthlyInstalmentKobo: number;
  firstDueDate: string;
  lastDueDate: string;
  tenorMonths: number;
  method: InterestMethod;
  monthlyRateBps: number;
  /** monthlyRate × 12, in percent */
  nominalAnnualRatePct: number;
  /** effective annual rate (IRR on net-disbursed vs instalments, annualised), in percent: the APR-style disclosure */
  effectiveAnnualRatePct: number;
  penaltyDescription: string;
}

const bpsOf = (amount: number, bps: number): number => Math.round((amount * bps) / 10_000);

function addMonths(d: Date, m: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + m);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildSchedule(input: AmortizationInput): { schedule: ScheduleLine[]; cost: CostOfCredit } {
  const { principalKobo: P, monthlyRateBps, tenorMonths: n, method } = input;
  if (!Number.isInteger(P) || P <= 0) throw new Error('principalKobo must be a positive integer');
  if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error('tenorMonths must be 1..120');
  if (monthlyRateBps < 0) throw new Error('rate cannot be negative');
  const r = monthlyRateBps / 10_000;
  const start = input.startDate ?? new Date();
  const grace = input.graceMonths ?? 0;

  const lines: ScheduleLine[] = [];
  let balance = P;

  if (method === 'FLAT') {
    const totalInterest = Math.round(P * r * n);
    const totalRepay = P + totalInterest;
    const instalment = Math.round(totalRepay / n);
    const principalPer = Math.floor(P / n);
    let interestLeft = totalInterest;
    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const principal = last ? balance : principalPer;
      const interest = last ? interestLeft : Math.min(interestLeft, instalment - principalPer);
      interestLeft -= interest;
      balance -= principal;
      lines.push({ n: i, dueDate: iso(addMonths(start, i + grace)), principalKobo: principal, interestKobo: interest, totalKobo: principal + interest, balanceKobo: balance });
    }
  } else {
    // annuity: A = P·r / (1 − (1+r)^−n); r = 0 → P/n
    const A = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
    const instalment = Math.round(A);
    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const interest = Math.round(balance * r);
      const principal = last ? balance : Math.min(balance, instalment - interest);
      balance -= principal;
      lines.push({ n: i, dueDate: iso(addMonths(start, i + grace)), principalKobo: principal, interestKobo: interest, totalKobo: principal + interest, balanceKobo: balance });
    }
  }

  const totalInterest = lines.reduce((s, l) => s + l.interestKobo, 0);
  const processing = bpsOf(P, input.processingFeeBps ?? 0);
  const management = bpsOf(P, input.managementFeeBps ?? 0);
  const insurance = bpsOf(P, input.insuranceFeeBps ?? 0);
  const fees = processing + management + insurance;
  const net = P - fees;
  const instalmentTypical = lines.length > 1 ? lines[0].totalKobo : lines[0].totalKobo;

  // monthly IRR of (−net at t0, +instalment_i at month i), annualised: (1+irr)^12 − 1
  const flows = lines.map((l) => l.totalKobo);
  const monthlyIrr = solveIrr(net, flows);
  const eir = (Math.pow(1 + monthlyIrr, 12) - 1) * 100;

  const penaltyBps = input.penaltyBpsPerDay ?? 0;
  const cost: CostOfCredit = {
    principalKobo: P,
    totalInterestKobo: totalInterest,
    processingFeeKobo: processing,
    managementFeeKobo: management,
    insuranceFeeKobo: insurance,
    totalFeesKobo: fees,
    totalRepayableKobo: P + totalInterest,
    netDisbursedKobo: net,
    totalCostOfCreditKobo: totalInterest + fees,
    monthlyInstalmentKobo: instalmentTypical,
    firstDueDate: lines[0].dueDate,
    lastDueDate: lines[lines.length - 1].dueDate,
    tenorMonths: n,
    method,
    monthlyRateBps,
    nominalAnnualRatePct: Math.round(monthlyRateBps * 12) / 100,
    effectiveAnnualRatePct: Math.round(eir * 100) / 100,
    penaltyDescription: penaltyBps
      ? `${(penaltyBps / 100).toFixed(2)}% of the overdue amount per day after a ${input.penaltyGraceDays ?? 0}-day grace period`
      : 'No penalty charged',
  };
  return { schedule: lines, cost };
}

/** Bisection IRR; monotonic for loans (outflow first). Returns monthly rate. */
function solveIrr(netOut: number, inflows: number[]): number {
  if (netOut <= 0) return 0;
  const npv = (rate: number) => inflows.reduce((s, c, i) => s + c / Math.pow(1 + rate, i + 1), 0) - netOut;
  let lo = 0;
  let hi = 5;
  if (npv(lo) <= 0) return 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Monthly instalment for a given principal (used by the eligibility engine to test affordability). */
export function monthlyInstalment(principalKobo: number, monthlyRateBps: number, tenorMonths: number, method: InterestMethod): number {
  const r = monthlyRateBps / 10_000;
  if (method === 'FLAT') return Math.round((principalKobo + principalKobo * r * tenorMonths) / tenorMonths);
  if (r === 0) return Math.round(principalKobo / tenorMonths);
  return Math.round((principalKobo * r) / (1 - Math.pow(1 + r, -tenorMonths)));
}

/** Inverse: largest principal whose monthly instalment ≤ maxInstalmentKobo (rounded down to the nearest ₦1,000). */
export function maxPrincipalForInstalment(maxInstalmentKobo: number, monthlyRateBps: number, tenorMonths: number, method: InterestMethod): number {
  if (maxInstalmentKobo <= 0) return 0;
  const r = monthlyRateBps / 10_000;
  let p: number;
  if (method === 'FLAT') p = (maxInstalmentKobo * tenorMonths) / (1 + r * tenorMonths);
  else p = r === 0 ? maxInstalmentKobo * tenorMonths : (maxInstalmentKobo * (1 - Math.pow(1 + r, -tenorMonths))) / r;
  return Math.floor(p / 100_000) * 100_000; // ₦1,000 steps (100,000 kobo)
}
