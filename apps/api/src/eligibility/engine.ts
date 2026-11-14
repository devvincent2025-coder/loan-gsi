/**
 * PURE eligibility engine: no DB, no IO, no clock (the caller passes `now`). Same input → same output.
 * Orchestration (fact gathering, persistence, audit) lives in eligibility.service.ts.
 */
import {
  AlternativeOfferDto, DEFAULT_TIER_LOAN_CAPS_KOBO, EligibilityFacts, EligibilityReasonDto, EligibilityResultDto, EligibilitySuggestionDto,
  FACT_FIELDS, FactorContributionDto, formatNaira, InterestMethod, maxPrincipalForInstalment, monthlyInstalment, ReasonSeverity, ScorecardDefinition,
} from '@damez/shared';

type PolicyRule = ScorecardDefinition['policyRules'][number];
type Factor = ScorecardDefinition['factors'][number];

export interface EngineProduct {
  id: string;
  name: string;
  monthlyRateBps: number;
  interestMethod: InterestMethod;
  minAmountKobo: number;
  maxAmountKobo: number;
  minTenorMonths: number;
  maxTenorMonths: number;
  minKycTier: number;
  minAge: number;
  maxAge: number;
  allowGuarantor: boolean;
  allowCollateral: boolean;
  isActive?: boolean;
  eligibilityOverrides?: Record<string, unknown> | null;
}

export interface EngineInput {
  facts: EligibilityFacts;
  definition: ScorecardDefinition;
  scorecard: { id: string; key: string; version: number; name: string };
  product: EngineProduct;
  requested: { amountKobo: number; tenorMonths: number };
  /** max loan the customer's CURRENT KYC tier allows */
  kycCapKobo: number;
  /** tier → cap (kobo); used to tell the customer which tier unlocks their amount. Defaults to the shared defaults. */
  tierCapsKobo?: Record<string, number>;
  otherProducts?: EngineProduct[];
  now: Date;
}

export type EngineResult = Omit<EligibilityResultDto, 'id' | 'bureauReportId' | 'simulated' | 'createdAt'>;

const STEP = 100_000; // ₦1,000
const SEVERITY_RANK: Record<ReasonSeverity, number> = { BLOCKER: 0, WARNING: 1, INFO: 2, POSITIVE: 3 };
const DECLARED_INCOME_RECOGNITION_BPS = 7000;
const WRITE_OFF_WINDOW_MONTHS = 24;

const floorStep = (k: number) => Math.max(0, Math.floor(k / STEP) * STEP);
const naira = (k: number) => formatNaira(k, { trimZeroKobo: true });
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

export function scoreBand(score: number): EligibilityResultDto['scoreBand'] {
  if (score < 500) return 'POOR';
  if (score < 580) return 'FAIR';
  if (score < 670) return 'GOOD';
  if (score < 740) return 'VERY_GOOD';
  return 'EXCELLENT';
}

export function formatFactValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return 'Not available';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const meta = FACT_FIELDS.find((f) => f.key === key);
  if (typeof v === 'number') {
    if (meta?.unit === 'kobo') return naira(v);
    if (meta?.unit === 'months') return `${v} month${v === 1 ? '' : 's'}`;
    if (meta?.unit === 'days') return `${v} day${v === 1 ? '' : 's'}`;
  }
  return String(v);
}

/** First matching bin wins; null/undefined or no match → defaultPoints. */
export function factorPoints(factor: Factor, value: unknown): number {
  if (value === null || value === undefined) return factor.defaultPoints ?? 0;
  for (const b of factor.bins) {
    if (b.eq !== undefined) {
      if (value === b.eq) return b.points;
      continue;
    }
    if (typeof value !== 'number') continue;
    if (b.gte !== undefined && value < b.gte) continue;
    if (b.lt !== undefined && value >= b.lt) continue;
    return b.points;
  }
  return factor.defaultPoints ?? 0;
}

export function computeScore(facts: EligibilityFacts, def: ScorecardDefinition): { score: number; factors: FactorContributionDto[] } {
  let total = def.baseScore;
  const factors: FactorContributionDto[] = def.factors.map((f) => {
    const value = (facts as unknown as Record<string, unknown>)[f.field];
    const points = factorPoints(f, value);
    total += points;
    return { key: f.key, label: f.label, value: formatFactValue(f.field, value), points };
  });
  return { score: Math.round(Math.min(def.maxScore, Math.max(def.minScore, total))), factors };
}

/** Null/undefined facts never match; ordering operators need two numbers. */
export function ruleMatches(rule: PolicyRule, facts: EligibilityFacts): boolean {
  const v = (facts as unknown as Record<string, unknown>)[rule.field];
  if (v === null || v === undefined) return false;
  switch (rule.op) {
    case 'eq': return v === rule.value;
    case 'neq': return v !== rule.value;
    default: {
      if (typeof v !== 'number' || typeof rule.value !== 'number') return false;
      if (rule.op === 'gt') return v > rule.value;
      if (rule.op === 'gte') return v >= rule.value;
      if (rule.op === 'lt') return v < rule.value;
      return v <= rule.value;
    }
  }
}

/** Months of the rule's look-back window parsed from its field name (…24m → 24), when that field is the write-off flag. */
function ruleReapplyDays(rule: PolicyRule, facts: EligibilityFacts): number | null {
  if (rule.field === 'bureauWriteOff24m' && facts.bureauWriteOffAgeMonths !== null) {
    return Math.max(1, Math.round((WRITE_OFF_WINDOW_MONTHS - facts.bureauWriteOffAgeMonths) * 30));
  }
  return rule.reapplyAfterDays ?? null;
}

function ruleDetail(rule: PolicyRule, facts: EligibilityFacts): string {
  const v = (facts as unknown as Record<string, unknown>)[rule.field];
  const fieldLabel = FACT_FIELDS.find((f) => f.key === rule.field)?.label ?? rule.label;
  let d = `${fieldLabel}: ${formatFactValue(rule.field, v)}`;
  if (rule.field === 'bureauWriteOff24m' && facts.bureauWriteOffAgeMonths !== null) d += ` (last write-off ${facts.bureauWriteOffAgeMonths} months ago)`;
  return d;
}

const addDays = (now: Date, days: number): string => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

interface Affordability {
  recognisedIncomeKobo: number;
  statementBased: boolean;
  maxDtiBps: number;
  maxTotalObligationKobo: number;
  maxMonthlyRepaymentKobo: number;
  externalObligationsKobo: number;
}

function overrideDti(product: EngineProduct, def: ScorecardDefinition): number {
  const o = product.eligibilityOverrides?.maxDtiBps;
  return typeof o === 'number' && Number.isFinite(o) && o >= 500 && o <= 9000 ? Math.round(o) : def.affordability.maxDtiBps;
}

export function computeAffordability(facts: EligibilityFacts, def: ScorecardDefinition, product: EngineProduct): Affordability {
  const a = def.affordability;
  const statementBased = facts.bankStatementMonths > 0 && facts.bankStatementMonths >= a.minStatementMonths && facts.avgMonthlyInflowKobo > 0;
  const recognisedIncomeKobo = Math.max(0, Math.round(statementBased
    ? (facts.avgMonthlyInflowKobo * a.inflowRecognitionBps) / 10_000
    : (facts.declaredMonthlyIncomeKobo * DECLARED_INCOME_RECOGNITION_BPS) / 10_000));
  const maxDtiBps = overrideDti(product, def);
  const maxTotalObligationKobo = Math.round((recognisedIncomeKobo * maxDtiBps) / 10_000);
  const externalObligationsKobo = Math.max(0, facts.bureauMonthlyObligationKobo);
  return { recognisedIncomeKobo, statementBased, maxDtiBps, maxTotalObligationKobo, externalObligationsKobo, maxMonthlyRepaymentKobo: Math.max(0, maxTotalObligationKobo - externalObligationsKobo) };
}

const tenorValid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 120;
const instalmentFor = (p: number, rate: number, t: number, m: InterestMethod) => (p > 0 && tenorValid(t) ? monthlyInstalment(p, rate, t, m) : 0);

/** Highest amount affordable for `maxRepay` at a tenor (₦1,000 steps). */
const affordableAmount = (maxRepay: number, rate: number, t: number, m: InterestMethod) => (tenorValid(t) ? maxPrincipalForInstalment(maxRepay, rate, t, m) : 0);

function minTierForAmount(amountKobo: number, caps: Record<string, number>): number {
  for (const t of [1, 2, 3]) if ((caps[String(t)] ?? 0) >= amountKobo) return t;
  return 3;
}

export function runEligibilityEngine(input: EngineInput): EngineResult {
  const { facts, definition: def, product, requested, now } = input;
  const req = requested.amountKobo;
  const tenor = requested.tenorMonths;
  const caps: Record<string, number> = input.tierCapsKobo ?? DEFAULT_TIER_LOAN_CAPS_KOBO;
  const reasons: EligibilityReasonDto[] = [];
  const push = (code: string, severity: ReasonSeverity, customerMessage: string, officerMessage: string) => reasons.push({ code, severity, customerMessage, officerMessage });

  /* (a) score */
  const { score, factors } = computeScore(facts, def);

  /* (b) policy rules */
  const fired = def.policyRules.filter((r) => ruleMatches(r, facts));
  const declines = fired.filter((r) => r.action === 'DECLINE');
  const refers = fired.filter((r) => r.action === 'REFER');
  for (const r of fired) {
    push(r.code, r.action === 'DECLINE' ? 'BLOCKER' : 'WARNING', r.customerMessage, `${r.officerMessage} (Based on: ${ruleDetail(r, facts)})`);
  }
  const firedFields = new Set(fired.map((r) => r.field));

  /* (c) cutoffs */
  const belowRefer = score < def.cutoffs.refer;
  const belowApprove = score < def.cutoffs.approve;
  if (belowRefer) {
    push('SCORE_BELOW_MINIMUM', 'BLOCKER', 'Your overall credit profile does not meet our requirements for this loan right now.', `Their score of ${score} is below the minimum of ${def.cutoffs.refer} needed to even consider this application.`);
  } else if (belowApprove) {
    push('SCORE_REVIEW_BAND', 'WARNING', 'Your application needs a quick review by our team before we can confirm it.', `Their score of ${score} is between ${def.cutoffs.refer} and ${def.cutoffs.approve}, so someone needs to review it by hand before it can be approved.`);
  }
  const customerBlock = declines.length > 0 || belowRefer;

  /* (f) bounds */
  const ageBlock = facts.age < product.minAge || facts.age > product.maxAge;
  if (ageBlock) push('AGE_OUT_OF_RANGE', 'BLOCKER', `This loan is for customers aged ${product.minAge} to ${product.maxAge}.`, `They are ${facts.age} years old, but this loan is only for customers between ${product.minAge} and ${product.maxAge}.`);
  const tenorBlock = tenor < product.minTenorMonths || tenor > product.maxTenorMonths || !tenorValid(tenor);
  if (tenorBlock) push('TENOR_OUT_OF_RANGE', 'BLOCKER', `This loan runs for ${product.minTenorMonths} to ${product.maxTenorMonths} months.`, `They asked for a repayment period of ${tenor} months, but this loan only allows between ${product.minTenorMonths} and ${product.maxTenorMonths} months.`);
  const belowMin = req < product.minAmountKobo;
  if (belowMin) push('AMOUNT_BELOW_MINIMUM', 'BLOCKER', `The smallest amount for this loan is ${naira(product.minAmountKobo)}.`, `They asked for ${naira(req)}, which is less than the smallest amount allowed for this loan, ${naira(product.minAmountKobo)}.`);
  const aboveProductMax = req > product.maxAmountKobo;
  if (aboveProductMax) push('AMOUNT_ABOVE_PRODUCT_MAX', 'WARNING', `The most you can borrow with this loan is ${naira(product.maxAmountKobo)}.`, `They asked for ${naira(req)}, which is more than the most this loan allows, ${naira(product.maxAmountKobo)}.`);

  /* (e) identity verification tier */
  const kycBelowMin = facts.kycTier < product.minKycTier;
  if (kycBelowMin) push('KYC_TIER_TOO_LOW', 'BLOCKER', 'Complete a few more identity checks to unlock this loan.', `Their identity verification is at level ${facts.kycTier}, but this loan needs at least level ${product.minKycTier}.`);
  const overKycCap = !kycBelowMin && req > input.kycCapKobo;
  if (overKycCap) push('KYC_CAP_EXCEEDED', 'WARNING', `Your current verification level allows loans up to ${naira(input.kycCapKobo)}. Verify more of your details to borrow more.`, `They asked for ${naira(req)}, but their current verification level (level ${facts.kycTier}) only allows up to ${naira(input.kycCapKobo)}.`);

  /* (d) affordability */
  const aff = computeAffordability(facts, def, product);
  const inst = instalmentFor(req, product.monthlyRateBps, tenor, product.interestMethod);
  const dtiBps = aff.recognisedIncomeKobo > 0 ? Math.min(99_999, Math.round(((inst + aff.externalObligationsKobo) * 10_000) / aff.recognisedIncomeKobo)) : 99_999;
  const fits = inst <= aff.maxMonthlyRepaymentKobo;
  const affordMaxRaw = affordableAmount(aff.maxMonthlyRepaymentKobo, product.monthlyRateBps, tenor, product.interestMethod);
  const affordMax = fits ? Math.max(affordMaxRaw, req) : affordMaxRaw;

  const inflowLabel = aff.statementBased ? 'inflow' : 'income';
  const inflowAmount = aff.statementBased ? facts.avgMonthlyInflowKobo : facts.declaredMonthlyIncomeKobo;
  if (aff.recognisedIncomeKobo <= 0) {
    push('NO_VERIFIABLE_INCOME', 'BLOCKER', 'We could not confirm an income to support this loan. Linking your bank account or uploading a statement can help.', 'We could not count any income for them: there is no usable bank statement showing money coming in, and the income they told us about is zero.');
  } else {
    const basisPlain = aff.statementBased
      ? `We looked at ${facts.bankStatementMonths} month(s) of bank statements showing ${naira(facts.avgMonthlyInflowKobo)} coming in each month on average, and counted ${pct(def.affordability.inflowRecognitionBps)} of that as reliable income.`
      : `We do not have a usable bank statement, so we used the income they told us about, ${naira(facts.declaredMonthlyIncomeKobo)} a month, and only counted 70% of it as reliable.`;
    const supports = `Monthly ${inflowLabel} of ${naira(inflowAmount)} supports a maximum repayment of ${naira(aff.maxMonthlyRepaymentKobo)}`;
    push('AFFORDABILITY_LIMIT', fits ? 'INFO' : 'BLOCKER', `${supports} a month.`,
      `${supports} a month. ${basisPlain} That gives a reliable income of ${naira(aff.recognisedIncomeKobo)} a month. We allow up to ${pct(aff.maxDtiBps)} of that to go toward loan repayments, which is ${naira(aff.maxTotalObligationKobo)} a month. After subtracting the ${naira(aff.externalObligationsKobo)} a month they already pay on other loans, that leaves ${naira(aff.maxMonthlyRepaymentKobo)} available for a new loan repayment. This loan's repayment would be ${naira(inst)} a month, which is ${pct(dtiBps)} of their reliable income.`);
  }
  if (aff.externalObligationsKobo > 0 && aff.maxTotalObligationKobo > 0) {
    const share = aff.externalObligationsKobo / aff.maxTotalObligationKobo;
    if (aff.maxMonthlyRepaymentKobo === 0 || (!fits && share >= 0.5)) {
      push('HIGH_DTI_EXISTING_LOANS', 'WARNING', `Your existing loan repayments (about ${naira(aff.externalObligationsKobo)} a month) already take up a large part of your income.`, `The ${naira(aff.externalObligationsKobo)} a month they already pay on other loans uses up ${Math.round(share * 100)}% of the ${naira(aff.maxTotalObligationKobo)} a month we allow for loan repayments.`);
    }
  } else if (aff.externalObligationsKobo > 0 && aff.maxTotalObligationKobo === 0) {
    push('HIGH_DTI_EXISTING_LOANS', 'WARNING', 'Your existing loan repayments are too high compared with your income.', `They already pay ${naira(aff.externalObligationsKobo)} a month on other loans, but we found no reliable income to support any loan repayment at all.`);
  }
  if (!aff.statementBased && aff.recognisedIncomeKobo > 0) {
    push('INCOME_NOT_VERIFIED', 'INFO', 'We used the income you declared. Linking your account lets us verify it and may increase what you can borrow.', `We could not verify their income with a bank statement (we have ${facts.bankStatementMonths} month(s), but need at least ${def.affordability.minStatementMonths}), so we counted 70% of the income they declared.`);
  }

  /* fact-based observations (skipped when a fired rule already explains the same field) */
  if (!firedFields.has('bureauWriteOff24m') && facts.bureauWriteOff24m) {
    const ago = facts.bureauWriteOffAgeMonths !== null ? `${facts.bureauWriteOffAgeMonths} months ago` : 'in the last 2 years';
    push('WRITE_OFF_ELSEWHERE', 'WARNING', 'A past loan with another lender was written off, which counts against you.', `Their credit report shows a loan with another lender was written off ${ago}.`);
  }
  if (!firedFields.has('bureauDpd90In12m') && facts.bureauDpd90In12m) push('DPD90_12M', 'WARNING', 'A loan with another lender was more than 90 days overdue in the past year.', 'Their credit report shows a payment that was more than 90 days late within the past 12 months.');
  if (!firedFields.has('bureauEnquiries90d') && facts.bureauEnquiries90d >= 4) push('MANY_ENQUIRIES', 'WARNING', 'You have applied for credit several times recently.', `They have applied for credit ${facts.bureauEnquiries90d} times in the past 90 days, including ${facts.bureauEnquiries30d} time(s) in just the past 30 days.`);
  if (facts.gamblingFlag) push('GAMBLING_ACTIVITY', 'WARNING', 'We noticed regular betting activity on your account.', 'Their bank statement shows regular betting (gambling) transactions.');
  if (facts.overdraftFlag) push('OVERDRAFT', 'WARNING', 'Your account balance has often dropped below zero.', 'Their bank balance has gone below zero several times.');
  if (facts.bureauThinFile) push('THIN_FILE', 'INFO', 'You have little or no credit history yet, so we have less to go on. Repaying a first loan on time will build it.', 'Their credit report shows little or no credit history.');
  if (facts.bankStatementMonths < def.affordability.minStatementMonths) {
    push('SHORT_STATEMENT', 'INFO', facts.bankStatementMonths === 0 ? 'We could not see your bank account activity.' : `We could only see ${facts.bankStatementMonths} month(s) of your bank activity.`, `We only have ${facts.bankStatementMonths} month(s) of bank statement; we need at least ${def.affordability.minStatementMonths} month(s) before we can rely on it.`);
  }
  if (facts.salaryDetected) push('SALARY_DETECTED', 'POSITIVE', 'Your regular salary payments count in your favour.', 'We found regular salary payments in their bank statement.');
  if (facts.inflowStability >= 70 && facts.bankStatementMonths > 0) push('STABLE_INFLOW', 'POSITIVE', 'Your income has been steady month to month.', `Their monthly income has stayed steady, scoring ${facts.inflowStability} out of 100 for stability.`);
  if (facts.internalCompletedLoans >= 1 && facts.internalLateInstalments === 0) push('REPAYMENT_HISTORY_WITH_US', 'POSITIVE', 'You have repaid loans with us on time before.', `They have completed ${facts.internalCompletedLoans} loan(s) with us before, always paying on time.`);
  if (!facts.bureauThinFile && facts.bureauWorstDpdEver < 1 && facts.bureauScore !== null && facts.bureauScore >= 600) push('CLEAN_CREDIT_HISTORY', 'POSITIVE', 'Your credit history shows you repay on time.', `Their credit score is ${facts.bureauScore}, with no missed payments on record.`);

  /* (g) final amount */
  const productBlock = ageBlock || tenorBlock || belowMin || kycBelowMin;
  const rawMax = Math.min(affordMax, input.kycCapKobo, product.maxAmountKobo);
  let maxRaw = floorStep(rawMax);
  if (req <= rawMax && maxRaw < req) maxRaw = req;
  const amountInfeasible = maxRaw < product.minAmountKobo;
  if (amountInfeasible && !productBlock && aff.recognisedIncomeKobo > 0 && affordMax < Math.min(input.kycCapKobo, product.maxAmountKobo)) {
    push('AFFORDABILITY_INSUFFICIENT', 'BLOCKER', `Based on your income and existing commitments, you cannot afford the smallest loan of ${naira(product.minAmountKobo)} right now.`, `The most they can afford to borrow over ${tenor} months is ${naira(affordMaxRaw)}, which is below the smallest loan amount allowed, ${naira(product.minAmountKobo)}.`);
  }
  const ineligible = customerBlock || productBlock || amountInfeasible;
  const maxAmountKobo = customerBlock || productBlock ? 0 : maxRaw;
  const conditional = !ineligible && (refers.length > 0 || belowApprove || req > maxAmountKobo);
  const outcome: EligibilityResultDto['outcome'] = ineligible ? 'INELIGIBLE' : conditional ? 'CONDITIONAL' : 'ELIGIBLE';

  /* suggestions */
  const sug: EligibilitySuggestionDto[] = [];
  const amountSuggestible = !customerBlock && !productBlock;
  const reqCapOk = req <= Math.min(input.kycCapKobo, product.maxAmountKobo);

  if (amountSuggestible && !amountInfeasible && req > maxAmountKobo && maxAmountKobo >= product.minAmountKobo) {
    const m = instalmentFor(maxAmountKobo, product.monthlyRateBps, tenor, product.interestMethod);
    sug.push({ type: 'REDUCE_AMOUNT', amountKobo: maxAmountKobo, tenorMonths: tenor, monthlyRepaymentKobo: m,
      customerMessage: `You can borrow up to ${naira(maxAmountKobo)} over ${tenor} months, repaying about ${naira(m)} a month.`,
      officerMessage: `Suggest reducing the amount to ${naira(maxAmountKobo)}. This is the smallest of three limits: what they can afford (${naira(affordMax)}), the most their verification level allows (${naira(input.kycCapKobo)}), and the most this loan product allows (${naira(product.maxAmountKobo)}). Over ${tenor} months, the repayment would be about ${naira(m)} a month.` });
  }
  if (amountSuggestible && !fits && reqCapOk && aff.recognisedIncomeKobo > 0) {
    for (let t = tenor + 1; t <= product.maxTenorMonths; t++) {
      const m = instalmentFor(req, product.monthlyRateBps, t, product.interestMethod);
      if (m <= aff.maxMonthlyRepaymentKobo) {
        sug.push({ type: 'LONGER_TENOR', amountKobo: req, tenorMonths: t, monthlyRepaymentKobo: m,
          customerMessage: `Spread over ${t} months, you could borrow ${naira(req)} and repay about ${naira(m)} a month.`,
          officerMessage: `The requested ${naira(req)} does not fit their budget over ${tenor} months (the repayment would be ${naira(inst)} a month). Spread over ${t} months instead, the repayment drops to about ${naira(m)} a month, which fits within what they can afford (${naira(aff.maxMonthlyRepaymentKobo)} a month).` });
        break;
      }
    }
  }
  if (kycBelowMin || overKycCap) {
    const tier = kycBelowMin ? product.minKycTier : Math.max(product.minKycTier, minTierForAmount(req, caps));
    if (tier > facts.kycTier) {
      sug.push({ type: 'UPGRADE_KYC',
        customerMessage: kycBelowMin ? `Complete Tier ${tier} verification to unlock this loan.` : `Complete Tier ${tier} verification to borrow ${naira(req)}.`,
        officerMessage: `Their identity verification is at level ${facts.kycTier}; level ${tier} is required ${kycBelowMin ? 'for this loan product' : `because level ${tier} allows up to ${naira(caps[String(tier)] ?? 0)}, which covers the requested ${naira(req)}`}.` });
    }
  }
  if (facts.bankStatementMonths < def.affordability.minStatementMonths) {
    sug.push({ type: 'LINK_ACCOUNTS',
      customerMessage: 'Link more of your bank accounts, or upload a 6-month bank statement, so we can verify your income.',
      officerMessage: `We only have ${facts.bankStatementMonths} month(s) of bank statement history, but need at least ${def.affordability.minStatementMonths}. Ask the customer to link more bank accounts or upload a 6-month statement.` });
    if ((facts.employmentStatus === 'EMPLOYED' || facts.employmentStatus === 'CIVIL_SERVANT') && !facts.salaryDetected) {
      sug.push({ type: 'UPLOAD_DOCUMENT', customerMessage: 'Upload your latest payslip to help us verify your salary.', officerMessage: 'They say they are employed, but we did not see a salary payment in their bank statement. Ask them for their latest payslip.' });
    }
  }
  const nearApprove = belowApprove && def.cutoffs.approve - score <= def.affordability.guarantorWithinPoints;
  if (product.allowGuarantor && amountSuggestible && nearApprove) {
    sug.push({ type: 'ADD_GUARANTOR', customerMessage: 'Adding a guarantor could strengthen your application.', officerMessage: `Their score of ${score} is ${def.cutoffs.approve - score} point(s) below the ${def.cutoffs.approve} needed for automatic approval. Since this is a small gap (within ${def.affordability.guarantorWithinPoints} points), adding a guarantor might be enough to approve this loan.` });
  }
  if (product.allowCollateral && amountSuggestible && !fits) {
    sug.push({ type: 'ADD_COLLATERAL', customerMessage: 'Offering collateral could help us approve a larger amount.', officerMessage: `The repayment for this loan (${naira(inst)} a month) is more than they can afford (${naira(aff.maxMonthlyRepaymentKobo)} a month). Collateral could make it safer to approve anyway.` });
  }
  if (amountSuggestible && !fits && aff.externalObligationsKobo > 0) {
    const shortfall = inst - aff.maxMonthlyRepaymentKobo;
    const clear = Math.min(shortfall, aff.externalObligationsKobo);
    sug.push({ type: 'CLEAR_DEBT', monthlyRepaymentKobo: clear,
      customerMessage: `Paying down existing loans so your monthly repayments drop by about ${naira(clear)} would help you afford this loan.`,
      officerMessage: `The repayment for this loan (${naira(inst)} a month) is more than they can afford (${naira(aff.maxMonthlyRepaymentKobo)} a month) by ${naira(shortfall)}. They currently pay ${naira(aff.externalObligationsKobo)} a month on other loans. If they paid off about ${naira(clear)} a month of that debt, this loan would then fit their budget.` });
  }
  // reapply: wait out every DECLINE rule that has a known period; otherwise a REFER-rule period (e.g. enquiries ageing out)
  const declineDays = declines.map((r) => ruleReapplyDays(r, facts));
  const referDays = refers.map((r) => ruleReapplyDays(r, facts)).filter((d): d is number => d !== null);
  let reapply: number | null = null;
  if (declines.length > 0 && !belowRefer && declineDays.every((d) => d !== null)) reapply = Math.max(...(declineDays as number[]));
  else if (declines.length === 0 && referDays.length > 0 && outcome !== 'ELIGIBLE') reapply = Math.max(...referDays);
  if (reapply !== null) {
    sug.push({ type: 'REAPPLY_LATER', reapplyAfterDays: reapply, reapplyDate: addDays(now, reapply),
      customerMessage: `You can apply again after ${addDays(now, reapply)} (in about ${reapply} days).`,
      officerMessage: `They can reapply on ${addDays(now, reapply)} (in about ${reapply} days), once the issues listed above are no longer a concern.` });
  }
  const order: Record<string, number> = { REDUCE_AMOUNT: 1, LONGER_TENOR: 2, UPGRADE_KYC: 3, LINK_ACCOUNTS: 4, UPLOAD_DOCUMENT: 5, ADD_GUARANTOR: 6, ADD_COLLATERAL: 7, CLEAR_DEBT: 8, REAPPLY_LATER: 9 };
  if (outcome === 'INELIGIBLE' && customerBlock) order.REAPPLY_LATER = 0;
  sug.sort((a, b) => order[a.type] - order[b.type]);

  /* alternatives */
  const alternatives = outcome === 'ELIGIBLE' || customerBlock ? [] : findAlternatives(input, aff);

  reasons.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    outcome, score, scoreBand: scoreBand(score),
    requested: { productId: product.id, amountKobo: req, tenorMonths: tenor },
    maxAmountKobo, maxMonthlyRepaymentKobo: aff.maxMonthlyRepaymentKobo, requestedMonthlyRepaymentKobo: inst, dtiBps,
    recognisedIncomeKobo: aff.recognisedIncomeKobo, externalObligationsKobo: aff.externalObligationsKobo,
    kycTier: facts.kycTier, kycCapKobo: input.kycCapKobo, scorecard: input.scorecard,
    reasons, suggestions: sug, alternatives, factors,
    firedRules: fired.map((r) => ({ code: r.code, action: r.action })),
  };
}

/** Re-run affordability across the OTHER active products (and tenors); best 3 by closeness to the requested amount. */
function findAlternatives(input: EngineInput, aff: Affordability): AlternativeOfferDto[] {
  const { facts, requested, definition: def } = input;
  const out: (AlternativeOfferDto & { gap: number })[] = [];
  for (const p of input.otherProducts ?? []) {
    if (p.id === input.product.id || p.isActive === false) continue;
    if (facts.kycTier < p.minKycTier || facts.age < p.minAge || facts.age > p.maxAge) continue;
    const dti = overrideDti(p, def);
    const maxRepay = Math.max(0, Math.round((aff.recognisedIncomeKobo * dti) / 10_000) - aff.externalObligationsKobo);
    const cap = Math.min(input.kycCapKobo, p.maxAmountKobo);
    const tenors = new Set<number>();
    for (let t = p.minTenorMonths; t <= p.maxTenorMonths; t++) tenors.add(t);
    let best: { amount: number; tenor: number; m: number } | null = null;
    for (const t of [...tenors].sort((a, b) => a - b)) {
      const maxAmt = floorStep(Math.min(affordableAmount(maxRepay, p.monthlyRateBps, t, p.interestMethod), cap));
      if (maxAmt < p.minAmountKobo) continue;
      const amount = Math.max(p.minAmountKobo, Math.min(requested.amountKobo, maxAmt));
      const m = instalmentFor(amount, p.monthlyRateBps, t, p.interestMethod);
      if (m > maxRepay) continue;
      // prefer the larger amount, then the tenor closest to the requested one, then the shorter tenor
      const better = !best || amount > best.amount
        || (amount === best.amount && (Math.abs(t - requested.tenorMonths) < Math.abs(best.tenor - requested.tenorMonths)));
      if (better) best = { amount, tenor: t, m };
    }
    if (!best) continue;
    const isFull = best.amount >= requested.amountKobo;
    out.push({
      productId: p.id, productName: p.name, amountKobo: best.amount, tenorMonths: best.tenor, monthlyRepaymentKobo: best.m, monthlyRateBps: p.monthlyRateBps,
      note: `${isFull ? 'Covers the amount you asked for' : `Up to ${naira(best.amount)}`} over ${best.tenor} months, about ${naira(best.m)} a month (${(p.monthlyRateBps / 100).toFixed(2)}% per month).`,
      gap: Math.abs(requested.amountKobo - best.amount),
    });
  }
  return out.sort((a, b) => a.gap - b.gap || a.monthlyRateBps - b.monthlyRateBps || a.productName.localeCompare(b.productName)).slice(0, 3).map(({ gap: _g, ...o }) => o);
}
