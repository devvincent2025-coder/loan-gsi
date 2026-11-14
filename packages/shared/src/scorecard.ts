import { z } from 'zod';

/**
 * Eligibility FACTS: the flat, non-PII inputs the eligibility engine evaluates. Scorecard factors and policy
 * rules reference these keys. The engine builds them from KYC, the bureau report, bank-statement analysis,
 * internal history and fraud signals; the what-if simulator lets risk managers override any of them.
 */
export interface EligibilityFacts {
  // applicant
  age: number;
  employmentStatus: 'EMPLOYED' | 'SELF_EMPLOYED' | 'CIVIL_SERVANT' | 'STUDENT' | 'UNEMPLOYED' | 'RETIRED';
  declaredMonthlyIncomeKobo: number;
  accountAgeDays: number;
  kycTier: number;
  // credit bureau
  bureauScore: number | null;
  bureauThinFile: boolean;
  bureauWorstDpdEver: number;
  bureauDpd90In12m: boolean;
  bureauWriteOff24m: boolean;
  /** months since the most recent write-off (null = none) */
  bureauWriteOffAgeMonths: number | null;
  bureauDefaultCount: number;
  bureauActiveLoans: number;
  bureauMonthlyObligationKobo: number;
  bureauEnquiries30d: number;
  bureauEnquiries90d: number;
  bureauEnquiries180d: number;
  bureauFraudFlag: boolean;
  bureauElsewhereDefault: boolean;
  bureauLegalAction: boolean;
  // bank statement analysis
  bankStatementMonths: number;
  avgMonthlyInflowKobo: number;
  /** 0-100, higher = steadier inflows */
  inflowStability: number;
  avgBalanceKobo: number;
  gamblingFlag: boolean;
  overdraftFlag: boolean;
  salaryDetected: boolean;
  // internal repayment history (stub until loans exist, prompt 3)
  internalCompletedLoans: number;
  internalLateInstalments: number;
  internalActiveLoan: boolean;
  internalWrittenOff: boolean;
  // fraud signals
  fraudHighSignals: number;
  fraudMediumSignals: number;
}

export interface FactFieldMeta {
  key: keyof EligibilityFacts;
  label: string;
  type: 'number' | 'boolean' | 'string';
  group: 'Applicant' | 'Credit bureau' | 'Bank statement' | 'Internal history' | 'Fraud';
  unit?: 'kobo' | 'months' | 'days' | 'percent' | 'count';
}

export const FACT_FIELDS: FactFieldMeta[] = [
  { key: 'age', label: 'Age', type: 'number', group: 'Applicant' },
  { key: 'employmentStatus', label: 'Employment status', type: 'string', group: 'Applicant' },
  { key: 'declaredMonthlyIncomeKobo', label: 'Declared monthly income', type: 'number', group: 'Applicant', unit: 'kobo' },
  { key: 'accountAgeDays', label: 'Account age', type: 'number', group: 'Applicant', unit: 'days' },
  { key: 'kycTier', label: 'KYC tier', type: 'number', group: 'Applicant' },
  { key: 'bureauScore', label: 'Bureau score (blended)', type: 'number', group: 'Credit bureau' },
  { key: 'bureauThinFile', label: 'Thin file (little or no history)', type: 'boolean', group: 'Credit bureau' },
  { key: 'bureauWorstDpdEver', label: 'Worst days-past-due ever', type: 'number', group: 'Credit bureau', unit: 'days' },
  { key: 'bureauDpd90In12m', label: 'DPD 90+ in last 12 months', type: 'boolean', group: 'Credit bureau' },
  { key: 'bureauWriteOff24m', label: 'Write-off in last 24 months', type: 'boolean', group: 'Credit bureau' },
  { key: 'bureauWriteOffAgeMonths', label: 'Months since last write-off', type: 'number', group: 'Credit bureau', unit: 'months' },
  { key: 'bureauDefaultCount', label: 'Defaulted facilities', type: 'number', group: 'Credit bureau', unit: 'count' },
  { key: 'bureauActiveLoans', label: 'Active loans elsewhere', type: 'number', group: 'Credit bureau', unit: 'count' },
  { key: 'bureauMonthlyObligationKobo', label: 'External monthly obligations', type: 'number', group: 'Credit bureau', unit: 'kobo' },
  { key: 'bureauEnquiries30d', label: 'Enquiries (30 days)', type: 'number', group: 'Credit bureau', unit: 'count' },
  { key: 'bureauEnquiries90d', label: 'Enquiries (90 days)', type: 'number', group: 'Credit bureau', unit: 'count' },
  { key: 'bureauEnquiries180d', label: 'Enquiries (180 days)', type: 'number', group: 'Credit bureau', unit: 'count' },
  { key: 'bureauFraudFlag', label: 'Bureau fraud / watchlist flag', type: 'boolean', group: 'Credit bureau' },
  { key: 'bureauElsewhereDefault', label: 'Currently defaulting elsewhere', type: 'boolean', group: 'Credit bureau' },
  { key: 'bureauLegalAction', label: 'Legal action recorded', type: 'boolean', group: 'Credit bureau' },
  { key: 'bankStatementMonths', label: 'Months of bank statement', type: 'number', group: 'Bank statement', unit: 'months' },
  { key: 'avgMonthlyInflowKobo', label: 'Average monthly inflow', type: 'number', group: 'Bank statement', unit: 'kobo' },
  { key: 'inflowStability', label: 'Inflow stability (0-100)', type: 'number', group: 'Bank statement' },
  { key: 'avgBalanceKobo', label: 'Average balance', type: 'number', group: 'Bank statement', unit: 'kobo' },
  { key: 'gamblingFlag', label: 'Gambling activity', type: 'boolean', group: 'Bank statement' },
  { key: 'overdraftFlag', label: 'Overdraft / negative balance', type: 'boolean', group: 'Bank statement' },
  { key: 'salaryDetected', label: 'Regular salary detected', type: 'boolean', group: 'Bank statement' },
  { key: 'internalCompletedLoans', label: 'Loans repaid with us', type: 'number', group: 'Internal history', unit: 'count' },
  { key: 'internalLateInstalments', label: 'Late instalments with us', type: 'number', group: 'Internal history', unit: 'count' },
  { key: 'internalActiveLoan', label: 'Has an active loan with us', type: 'boolean', group: 'Internal history' },
  { key: 'internalWrittenOff', label: 'Previously written off by us', type: 'boolean', group: 'Internal history' },
  { key: 'fraudHighSignals', label: 'High-severity fraud signals', type: 'number', group: 'Fraud', unit: 'count' },
  { key: 'fraudMediumSignals', label: 'Medium-severity fraud signals', type: 'number', group: 'Fraud', unit: 'count' },
];

/* ───────── scorecard definition (stored as JSON, versioned) ───────── */
const bin = z.object({
  gte: z.number().optional(),
  lt: z.number().optional(),
  eq: z.union([z.number(), z.boolean(), z.string()]).optional(),
  points: z.number(),
  label: z.string().optional(),
});
const factor = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  field: z.string().min(1),
  bins: z.array(bin).min(1),
  /** points when the field is null / no bin matches */
  defaultPoints: z.number().default(0),
});
const rule = z.object({
  code: z.string().regex(/^[A-Z0-9_]{3,40}$/),
  label: z.string().min(1),
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
  value: z.union([z.number(), z.boolean(), z.string()]),
  action: z.enum(['DECLINE', 'REFER']),
  customerMessage: z.string().min(1),
  officerMessage: z.string().min(1),
  /** when set, the engine suggests reapplying after this many days */
  reapplyAfterDays: z.number().int().positive().optional(),
});

export const scorecardDefinitionSchema = z.object({
  baseScore: z.number(),
  minScore: z.number(),
  maxScore: z.number(),
  cutoffs: z.object({
    /** score ≥ approve → eligible (subject to affordability) */
    approve: z.number(),
    /** refer ≤ score < approve → conditional (manual review); below → ineligible */
    refer: z.number(),
  }),
  factors: z.array(factor).min(1),
  policyRules: z.array(rule),
  affordability: z.object({
    /** max (new + external obligations) as a share of verified monthly income, in bps */
    maxDtiBps: z.number().int().min(500).max(9000),
    /** share of average inflow counted as income, in bps (haircut for unstable inflow) */
    inflowRecognitionBps: z.number().int().min(1000).max(10000),
    /** min months of statement history to rely on inflow; fewer → declared income at 70% */
    minStatementMonths: z.number().int().min(0).max(12),
    /** conditional approvals can be improved with a guarantor when within this many points of the approve cutoff */
    guarantorWithinPoints: z.number().int().min(0).default(40),
  }),
});
export type ScorecardDefinition = z.infer<typeof scorecardDefinitionSchema>;

/** Seeded scorecard v1 (production-plausible for a Nigerian salary-led digital lender). Score range 300-850. */
export const DEFAULT_SCORECARD_V1: ScorecardDefinition = {
  baseScore: 500,
  minScore: 300,
  maxScore: 850,
  cutoffs: { approve: 600, refer: 520 },
  factors: [
    {
      key: 'bureau_score', label: 'Bureau score', field: 'bureauScore', defaultPoints: 0,
      bins: [
        { lt: 400, points: -90, label: 'Below 400' }, { gte: 400, lt: 500, points: -45, label: '400-499' },
        { gte: 500, lt: 600, points: 0, label: '500-599' }, { gte: 600, lt: 700, points: 40, label: '600-699' },
        { gte: 700, points: 80, label: '700+' },
      ],
    },
    {
      key: 'thin_file', label: 'Credit history depth', field: 'bureauThinFile', defaultPoints: 0,
      bins: [{ eq: true, points: -15, label: 'Thin file' }, { eq: false, points: 15, label: 'Established history' }],
    },
    {
      key: 'worst_dpd', label: 'Late payment ever', field: 'bureauWorstDpdEver', defaultPoints: 0,
      bins: [{ lt: 1, points: 30 }, { gte: 1, lt: 30, points: 0 }, { gte: 30, lt: 90, points: -40 }, { gte: 90, points: -80 }],
    },
    {
      key: 'enquiries_90d', label: 'Recent credit enquiries (90d)', field: 'bureauEnquiries90d', defaultPoints: 0,
      bins: [{ lt: 2, points: 10 }, { gte: 2, lt: 4, points: 0 }, { gte: 4, lt: 6, points: -25 }, { gte: 6, points: -50 }],
    },
    {
      key: 'inflow_stability', label: 'Inflow stability', field: 'inflowStability', defaultPoints: -10,
      bins: [{ lt: 40, points: -35 }, { gte: 40, lt: 70, points: 0 }, { gte: 70, lt: 85, points: 25 }, { gte: 85, points: 45 }],
    },
    {
      key: 'salary', label: 'Regular salary credited', field: 'salaryDetected', defaultPoints: 0,
      bins: [{ eq: true, points: 30, label: 'Salary detected' }, { eq: false, points: -10, label: 'No regular salary' }],
    },
    {
      key: 'avg_balance', label: 'Average balance', field: 'avgBalanceKobo', defaultPoints: 0,
      bins: [{ lt: 2_000_000, points: -20, label: 'Under ₦20k' }, { gte: 2_000_000, lt: 10_000_000, points: 0 }, { gte: 10_000_000, points: 20, label: '₦100k+' }],
    },
    {
      key: 'internal_repaid', label: 'Loans repaid with us', field: 'internalCompletedLoans', defaultPoints: 0,
      bins: [{ lt: 1, points: 0 }, { gte: 1, lt: 3, points: 25 }, { gte: 3, points: 45 }],
    },
    {
      key: 'internal_late', label: 'Late instalments with us', field: 'internalLateInstalments', defaultPoints: 0,
      bins: [{ lt: 1, points: 0 }, { gte: 1, lt: 4, points: -20 }, { gte: 4, points: -45 }],
    },
    {
      key: 'account_age', label: 'Time with us', field: 'accountAgeDays', defaultPoints: 0,
      bins: [{ lt: 30, points: -5 }, { gte: 30, lt: 180, points: 5 }, { gte: 180, points: 15 }],
    },
    {
      key: 'employment', label: 'Employment', field: 'employmentStatus', defaultPoints: 0,
      bins: [
        { eq: 'CIVIL_SERVANT', points: 20 }, { eq: 'EMPLOYED', points: 20 }, { eq: 'SELF_EMPLOYED', points: 0 },
        { eq: 'RETIRED', points: 5 }, { eq: 'STUDENT', points: -25 }, { eq: 'UNEMPLOYED', points: -60 },
      ],
    },
    {
      key: 'gambling', label: 'Gambling activity', field: 'gamblingFlag', defaultPoints: 0,
      bins: [{ eq: true, points: -35 }, { eq: false, points: 0 }],
    },
    {
      key: 'overdraft', label: 'Overdraft / negative balance', field: 'overdraftFlag', defaultPoints: 0,
      bins: [{ eq: true, points: -20 }, { eq: false, points: 0 }],
    },
  ],
  policyRules: [
    {
      code: 'BUREAU_WRITE_OFF_24M', label: 'Write-off in the last 24 months', field: 'bureauWriteOff24m', op: 'eq', value: true, action: 'DECLINE', reapplyAfterDays: 365,
      customerMessage: 'A loan with another lender was written off in the last 2 years.',
      officerMessage: 'Their credit report shows a loan with another lender was written off within the last 24 months. Our policy is to decline these automatically.',
    },
    {
      code: 'BUREAU_DPD90_12M', label: 'DPD 90+ in the last 12 months', field: 'bureauDpd90In12m', op: 'eq', value: true, action: 'DECLINE', reapplyAfterDays: 180,
      customerMessage: 'You have a loan with another lender that is more than 90 days overdue or was recently.',
      officerMessage: 'Their credit report shows a payment more than 90 days late within the last 12 months. Our policy is to decline these automatically.',
    },
    {
      code: 'BUREAU_FRAUD_FLAG', label: 'Fraud / watchlist flag', field: 'bureauFraudFlag', op: 'eq', value: true, action: 'DECLINE',
      customerMessage: 'We are unable to offer you a loan at this time.',
      officerMessage: 'A credit bureau flagged this customer for suspected fraud, or placed them on a watchlist.',
    },
    {
      code: 'FRAUD_SIGNALS_HIGH', label: 'High-severity internal fraud signals', field: 'fraudHighSignals', op: 'gte', value: 1, action: 'DECLINE',
      customerMessage: 'We could not verify some of your details. Please contact support.',
      officerMessage: 'We found a serious, unresolved fraud warning for this customer — for example a matching ID number, face, or device used elsewhere, or unusually fast activity.',
    },
    {
      code: 'INTERNAL_WRITTEN_OFF', label: 'Previously written off by us', field: 'internalWrittenOff', op: 'eq', value: true, action: 'DECLINE',
      customerMessage: 'We are unable to offer you a loan until your previous balance with us is settled.',
      officerMessage: 'This customer previously had a loan with us written off.',
    },
    {
      code: 'TOO_MANY_ENQUIRIES', label: 'Too many recent enquiries', field: 'bureauEnquiries90d', op: 'gte', value: 6, action: 'REFER', reapplyAfterDays: 60,
      customerMessage: 'You have applied for many loans recently. A team member will review your application.',
      officerMessage: 'They have applied for credit 6 or more times in the last 90 days, which can mean they are taking on several loans at once. This needs a manual review.',
    },
    {
      code: 'ELSEWHERE_DEFAULT', label: 'Defaulting elsewhere', field: 'bureauElsewhereDefault', op: 'eq', value: true, action: 'REFER',
      customerMessage: 'We need to review your credit history before we can proceed.',
      officerMessage: 'This customer is currently behind on payments for a loan with another lender.',
    },
    {
      code: 'LEGAL_ACTION', label: 'Legal action recorded', field: 'bureauLegalAction', op: 'eq', value: true, action: 'REFER',
      customerMessage: 'We need to review your credit history before we can proceed.',
      officerMessage: 'Their credit report shows legal action was taken against them.',
    },
    {
      code: 'UNDERAGE', label: 'Below minimum age', field: 'age', op: 'lt', value: 18, action: 'DECLINE',
      customerMessage: 'You must be at least 18 years old to borrow.', officerMessage: 'The applicant is under 18 years old.',
    },
  ],
  affordability: { maxDtiBps: 4000, inflowRecognitionBps: 9000, minStatementMonths: 3, guarantorWithinPoints: 40 },
};
