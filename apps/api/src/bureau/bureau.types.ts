import type { BureauName, FacilityStatus, ScoreBand } from '@damez/shared';

/** Every `BureauName` value, in a stable canonical order. Used for deterministic ordering/filtering of merged
 *  `sources` arrays — NOT for deciding who to query (that's `BUREAUS` below). Facilities/enquiries/flags from a
 *  retired bureau (e.g. an old CRC pull still in the DB) must still show up here; narrowing this would silently
 *  drop their real provenance. */
export const ALL_BUREAUS: BureauName[] = ['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY', 'INTERSWITCH'];
/** The only bureau we query directly. CRC/FIRSTCENTRAL/CREDITREGISTRY remain valid `BureauName` values solely for
 *  (a) the monthly CBN furnishing obligation, which reports to them directly regardless of query vendor, and
 *  (b) displaying old pull/score records that predate the Interswitch-only switch. Neither is queried any more. */
export const BUREAUS: BureauName[] = ['INTERSWITCH'];
/** Native score ranges per bureau. Scores are normalised onto the 300-850 scale for blending/bands. CRC/FIRSTCENTRAL/
 *  CREDITREGISTRY ranges are kept only so historical pulls still render correctly. */
export const SCORE_RANGES: Record<BureauName, { min: number; max: number }> = {
  CRC: { min: 300, max: 850 },
  FIRSTCENTRAL: { min: 300, max: 850 },
  CREDITREGISTRY: { min: 200, max: 900 },
  INTERSWITCH: { min: 300, max: 850 },
};
export const NORM_MIN = 300;
export const NORM_MAX = 850;

/** Severity order used to reconcile bureaus that disagree (higher = more severe). */
export const STATUS_SEVERITY: Record<FacilityStatus, number> = { CLOSED: 0, PERFORMING: 1, Unpaid: 2, DEFAULTED: 3, WRITTEN_OFF: 4 };
export const ACTIVE_STATUSES: FacilityStatus[] = ['PERFORMING', 'Unpaid', 'DEFAULTED'];

export interface BureauRequest {
  /** clear BVN: lives only in memory for the duration of the pull, never logged */
  bvn?: string;
  fullName: string;
  /** yyyy-mm-dd */
  dateOfBirth?: string;
  phone: string;
  /** our own correlation reference (no PII) */
  reference: string;
}

export interface RawFacility {
  lender: string;
  productType: string;
  amountGrantedKobo: number;
  outstandingKobo: number;
  status: FacilityStatus;
  tenorMonths: number | null;
  monthlyPaymentKobo: number;
  openedAt: Date;
  /** for WRITTEN_OFF facilities this is the write-off date */
  closedAt: Date | null;
  lastPaymentAt: Date | null;
  legalAction: boolean;
  soldToCollections: boolean;
  isGuarantor: boolean;
  /** monthly repayment history, oldest first (yyyy-mm, days past due) */
  history: { month: string; dpd: number }[];
  worstDpd: number;
}
export interface RawEnquiry { lender: string; date: Date; purpose: string }
export interface RawFlag { type: 'FRAUD' | 'WATCHLIST' | 'GUARANTOR_DEFAULT'; detail: string; date: Date }

/** Already-normalised vendor result. `notFound` = the bureau has no record of the subject (billable NO_HIT). */
export interface RawBureauResult {
  bureau: BureauName;
  notFound: boolean;
  /** in the bureau's own range; null when the bureau could not score (thin file) */
  score: number | null;
  minScore: number;
  maxScore: number;
  facilities: RawFacility[];
  enquiries: RawEnquiry[];
  flags: RawFlag[];
  /** the bureau itself says there is too little history to score */
  thinFile: boolean;
}

export interface CreditBureauProvider {
  readonly bureau: BureauName;
  /** BVN lookup; falls back to name + DOB + phone when no BVN is available. */
  pull(request: BureauRequest): Promise<RawBureauResult>;
}

export class BureauProviderError extends Error {
  constructor(message: string, public readonly bureau: BureauName, public readonly retryable = true, public readonly code = 'PROVIDER_ERROR') {
    super(message);
    this.name = 'BureauProviderError';
  }
}
export class BureauNotConfiguredError extends BureauProviderError {
  constructor(bureau: BureauName, missing: string[]) {
    super(`${bureau} is not configured (missing ${missing.join(', ')})`, bureau, false, 'NOT_CONFIGURED');
    this.name = 'BureauNotConfiguredError';
  }
}

/* ── merged (cross-bureau) model: what we persist and serve ── */
export interface MergedFacility {
  dedupeKey: string;
  sources: BureauName[];
  lender: string;
  productType: string;
  amountGrantedKobo: number;
  outstandingKobo: number;
  status: FacilityStatus;
  tenorMonths: number | null;
  monthlyPaymentKobo: number;
  openedAt: Date;
  closedAt: Date | null;
  lastPaymentAt: Date | null;
  worstDpd: number;
  isActive: boolean;
  legalAction: boolean;
  soldToCollections: boolean;
  isGuarantor: boolean;
  conflict: boolean;
  history: { month: string; dpd: number }[];
}
export interface MergedEnquiry { lender: string; date: Date; purpose: string; sources: BureauName[] }
export interface MergedFlag { type: 'FRAUD' | 'WATCHLIST' | 'GUARANTOR_DEFAULT'; source: BureauName; detail: string; date: Date }
export interface MergedScore { bureau: BureauName; score: number | null; band: ScoreBand | null; minScore: number; maxScore: number }

export interface BureauSummary {
  bestScore: number | null;
  lowestScore: number | null;
  averageScore: number | null;
  scoreBand: ScoreBand | null;
  worstDpdEver: number;
  activeFacilityCount: number;
  totalOutstandingKobo: number;
  totalMonthlyObligationKobo: number;
  enquiries30d: number;
  enquiries90d: number;
  enquiries180d: number;
  defaultCount: number;
  writeOffCount: number;
  hasWriteOff24m: boolean;
  lastWriteOffMonthsAgo: number | null;
  hasDpd90In12m: boolean;
  elsewhereDefault: boolean;
  fraudFlag: boolean;
  legalActionCount: number;
  soldToCollectionsCount: number;
  guarantorExposureKobo: number;
  thinFile: boolean;
}

export interface MergedReport {
  bureausQueried: BureauName[];
  bureausFailed: { bureau: BureauName; error: string }[];
  scores: MergedScore[];
  facilities: MergedFacility[];
  enquiries: MergedEnquiry[];
  flags: MergedFlag[];
  summary: BureauSummary;
}

export interface PerBureauOutcome {
  bureau: BureauName;
  status: 'SUCCESS' | 'NO_HIT' | 'FAILED';
  attempts: number;
  durationMs: number;
  error?: string;
  result?: RawBureauResult;
}

export interface RetryPolicy { maxAttempts: number; baseDelayMs: number }
export interface BureauSettings {
  cacheTtlDays: number;
  preDisbursementMaxAgeDays: number;
  enabledBureaus: BureauName[];
  costsKobo: Record<BureauName, number>;
  retry: RetryPolicy;
  monitoringEnabled: boolean;
  furnishingEnabled: boolean;
}
