/**
 * PROMPT 2 API CONTRACT: onboarding/KYC, credit bureau, products, applications, eligibility, scorecards.
 * Same conventions as api-types.ts (base /api/v1, kobo ints, ISO dates, cookie auth + x-csrf-token).
 *
 * TWO AUTH SURFACES
 *  • Staff console: cookie `sid` (+ `csrf` cookie → `x-csrf-token` header). Endpoints below under staff headings.
 *  • Customer portal: ALL portal endpoints live under /portal/*, use cookie `csid` (httpOnly) and a readable
 *    cookie `ccsrf` that must be echoed in header `x-csrf-token` on non-GET requests. 401 code SESSION_EXPIRED /NO_SESSION.
 *    Portal auth endpoints (register/login/verify-otp) are public.
 *
 * Money: `…Kobo` integers. Percentages are plain numbers in percent unless suffixed `Bps`.
 */
import type { ApprovalDto, BranchRef, ConsentStatusRef, LoanProductDto, Page } from './api-types';
import type { ConsentText, DocumentKind, KycTier, KycVerificationStatus, KycVerificationType } from './kyc';
import type { CostOfCredit, InterestMethod, ScheduleLine } from './amortization';
import type { EligibilityFacts, ScorecardDefinition } from './scorecard';
import type { ConsentPurpose } from './constants';

/* ═════════════════════════ CUSTOMER PORTAL ═════════════════════════ */

export interface PortalMe {
  id: string;
  firstName: string;
  lastName: string;
  /** masked */
  phone: string;
  /** masked */
  email: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  kycTier: KycTier;
  /** max loan the customer's current KYC tier allows */
  maxLoanKobo: number;
  onboardingComplete: boolean;
}

/** POST /portal/auth/register {phone, email?, firstName, lastName, acceptPrivacy:true} → OtpChallengeResponse
 *  POST /portal/auth/login {phone} → OtpChallengeResponse (same shape for unknown numbers: no enumeration)
 *  POST /portal/auth/otp/resend {challengeId} → OtpChallengeResponse
 *  POST /portal/auth/verify-otp {challengeId, code} → {customer: PortalMe}; sets cookies csid + ccsrf
 *  POST /portal/auth/logout ; GET /portal/me → PortalMe
 *  POST /portal/email/send → {sent:true, demoCode?} ; POST /portal/email/verify {code} → PortalMe */
export interface OtpChallengeResponse {
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** masked destination, e.g. 0803•••4567 */
  destination: string;
  /** ONLY when DEMO_MODE=true and not production: the OTP so demos work without SMS */
  demoCode?: string;
}
export interface PortalVerifyOtpResponse { customer: PortalMe }

export type OnboardingStepKey =
  | 'ACCOUNT' | 'EMAIL' | 'PROFILE' | 'BVN' | 'NIN' | 'FACE' | 'BANK_ACCOUNT' | 'DOCUMENTS' | 'ADDRESS' | 'BUREAU_CONSENT';
export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  description: string;
  status: 'DONE' | 'CURRENT' | 'TODO' | 'OPTIONAL' | 'LOCKED' | 'FAILED' | 'REVIEW';
  required: boolean;
  /** friendly detail, e.g. why it failed or what unlocks it */
  detail: string | null;
}
/** GET /portal/onboarding */
export interface OnboardingState {
  steps: OnboardingStep[];
  currentStep: OnboardingStepKey | null;
  kycTier: KycTier;
  maxLoanKobo: number;
  /** steps required before applying for a loan */
  completed: boolean;
  tiers: { tier: 1 | 2 | 3; label: string; requirements: string[]; maxLoanKobo: number; achieved: boolean }[];
}

/** PUT /portal/profile → PortalMe */
export interface PortalProfileRequest {
  /** yyyy-mm-dd */
  dateOfBirth: string;
  gender?: 'MALE' | 'FEMALE';
  address: { line1: string; city: string; state: string; landmark?: string };
  employment: {
    status: EligibilityFacts['employmentStatus'];
    employer?: string;
    monthlyIncomeKobo: number;
    /** day of month salary lands, 1-31 */
    salaryDay?: number;
  };
}

export interface KycVerificationDto {
  id: string;
  type: KycVerificationType;
  provider: string;
  status: KycVerificationStatus;
  referenceId: string | null;
  /** face match / name match confidence, percent */
  matchConfidence: number | null;
  livenessPassed: boolean | null;
  /** non-PII human summary */
  summary: string;
  createdAt: string;
  completedAt: string | null;
}
/** Result of every KYC step call. */
export interface KycStepResult {
  status: KycVerificationStatus;
  /** friendly message for the customer */
  message: string;
  kycTier: KycTier;
  retryAllowed: boolean;
  verification: KycVerificationDto;
  /** bank name enquiry only */
  accountName?: string;
}
/** POST /portal/kyc/bvn {bvn, dateOfBirth?} → KycStepResult   (requires KYC_VERIFICATION consent; duplicate BVN → 409 DUPLICATE_BVN)
 *  POST /portal/kyc/nin {nin} → KycStepResult
 *  POST /portal/kyc/bank-account {accountNumber, bankCode} → KycStepResult (accountName set)
 *  POST /portal/kyc/gov-id {idType:'DRIVERS_LICENSE'|'VOTERS_CARD'|'INTL_PASSPORT', idNumber} → KycStepResult
 *  POST /portal/kyc/address {line1, city, state, landmark?} → KycStepResult  (optional; unlocks Tier 3)
 *  GET  /portal/kyc/verifications → KycVerificationDto[]
 *  FACE (Dojah widget):
 *    POST /portal/kyc/face/session → FaceSessionDto
 *    POST /portal/kyc/face/complete {referenceId, sdkEvent?} → KycStepResult
 *        The browser callback is only a HINT: the server fetches/awaits the authoritative result from Dojah
 *        (and the Dojah webhook POST /webhooks/dojah, signature verified, also completes it). */
export interface FaceSessionDto {
  referenceId: string;
  mode: 'dojah';
  widget: { appId: string; publicKey: string; widgetId: string; scriptUrl: string; environment: 'sandbox' | 'production' };
}

export interface DocumentDto {
  id: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  applicationId: string | null;
  uploadedAt: string;
}
/** POST /portal/documents (multipart: kind, file, applicationId?) → DocumentDto  (≤8MB; jpeg/png/pdf/csv; virus-scanned; encrypted at rest)
 *  GET /portal/documents → DocumentDto[] ; DELETE /portal/documents/:id (only while review PENDING) */

export interface ConsentDto {
  id: string;
  purpose: ConsentPurpose;
  status: 'GRANTED' | 'REVOKED' | 'EXPIRED';
  textVersion: string;
  grantedAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
}
/** GET /portal/consents → PortalConsentsDto ; POST /portal/consents {purpose, textVersion} → ConsentDto ;
 *  POST /portal/consents/:purpose/revoke → ConsentDto  (bureau consent is required to apply) */
export interface PortalConsentsDto { texts: ConsentText[]; consents: ConsentDto[] }

export interface PortalProductDto {
  id: string;
  code: string;
  name: string;
  description: string;
  minAmountKobo: number;
  maxAmountKobo: number;
  minTenorMonths: number;
  maxTenorMonths: number;
  monthlyRateBps: number;
  interestMethod: InterestMethod;
  /** e.g. "1% management + 0.5% insurance, deducted upfront" */
  feesSummary: string;
  requiredDocs: DocumentKind[];
  minKycTier: number;
  /** false when locked for this customer */
  available: boolean;
  lockedReason: string | null;
  /** whether this product requires guarantor information */
  allowGuarantor: boolean;
  /** whether this product accepts collateral descriptions */
  allowCollateral: boolean;
}

/* ─── Guarantors ─── */

export interface GuarantorDto {
  id: string;
  firstName: string;
  lastName: string;
  /** masked */
  phone: string;
  relationship: string;
  occupation: string | null;
  idType: string | null;
  createdAt: string;
}
/** POST /portal/applications/:id/guarantors → GuarantorDto
 *  GET /portal/applications/:id/guarantors → GuarantorDto[]
 *  DELETE /portal/applications/:id/guarantors/:gid → {ok:true}
 *  Staff: same paths without /portal prefix */
/** GET /portal/products → PortalProductDto[] */

export interface LoanQuoteDto { schedule: ScheduleLine[]; cost: CostOfCredit }
/** POST /portal/loans/schedule-preview {productId, amountKobo, tenorMonths} → LoanQuoteDto  (also staff: POST /loans/schedule-preview) */

/** POST /portal/eligibility/preview {productId, amountKobo, tenorMonths} → EligibilityCustomerDto
 *    needs BUREAU_PULL consent: otherwise 403 {code:'CONSENT_REQUIRED', purpose:'BUREAU_PULL'}
 *  POST /portal/applications {productId, amountKobo, tenorMonths, purpose, acceptDisclosure:true} → PortalApplicationDto
 *  GET /portal/applications → PortalApplicationDto[] ; GET /portal/applications/:id → PortalApplicationDto
 *  POST /portal/applications/:id/cancel → PortalApplicationDto */
export interface PortalApplicationDto {
  id: string;
  reference: string;
  product: { id: string; name: string };
  amountKobo: number;
  tenorMonths: number;
  purpose: string | null;
  status: ApplicationStatus;
  /** friendly label + explanation for the customer */
  statusLabel: string;
  statusMessage: string;
  /** what the customer should do next, if anything */
  nextAction: { type: 'UPLOAD_DOCUMENT' | 'GIVE_CONSENT' | 'COMPLETE_KYC' | 'NONE'; label: string; href: string } | null;
  requiredDocs: { kind: DocumentKind; satisfied: boolean }[];
  eligibility: EligibilityCustomerDto | null;
  quote: LoanQuoteDto;
  submittedAt: string | null;
  createdAt: string;
  /** guarantors attached to this application */
  guarantors: GuarantorDto[];
  /** collateral: stock/securities description (null if not provided) */
  collateralStockDesc: string | null;
  /** collateral: property description (null if not provided) */
  collateralPropertyDesc: string | null;
  /** self-reported income at application time (kobo) */
  selfReportedIncomeKobo: number | null;
}

/* ═════════════════════════ ELIGIBILITY ═════════════════════════ */

export type EligibilityOutcome = 'ELIGIBLE' | 'CONDITIONAL' | 'INELIGIBLE';
export type ReasonSeverity = 'BLOCKER' | 'WARNING' | 'INFO' | 'POSITIVE';
export type SuggestionType =
  | 'REDUCE_AMOUNT' | 'LONGER_TENOR' | 'ADD_GUARANTOR' | 'ADD_COLLATERAL' | 'LINK_ACCOUNTS'
  | 'UPGRADE_KYC' | 'REAPPLY_LATER' | 'UPLOAD_DOCUMENT' | 'CLEAR_DEBT';

export interface EligibilityReasonDto {
  code: string;
  severity: ReasonSeverity;
  /** friendly wording for the customer portal */
  customerMessage: string;
  /** full detail for staff */
  officerMessage: string;
}
export interface EligibilitySuggestionDto {
  type: SuggestionType;
  customerMessage: string;
  officerMessage: string;
  amountKobo?: number;
  tenorMonths?: number;
  monthlyRepaymentKobo?: number;
  reapplyAfterDays?: number;
  /** ISO date */
  reapplyDate?: string;
}
export interface AlternativeOfferDto {
  productId: string;
  productName: string;
  amountKobo: number;
  tenorMonths: number;
  monthlyRepaymentKobo: number;
  monthlyRateBps: number;
  note: string;
}
export interface FactorContributionDto { key: string; label: string; value: string; points: number }

/** Staff view (full detail). */
export interface EligibilityResultDto {
  id: string;
  outcome: EligibilityOutcome;
  score: number;
  scoreBand: 'POOR' | 'FAIR' | 'GOOD' | 'VERY_GOOD' | 'EXCELLENT';
  requested: { productId: string; amountKobo: number; tenorMonths: number };
  /** largest amount the customer qualifies for at the requested tenor (≥0) */
  maxAmountKobo: number;
  maxMonthlyRepaymentKobo: number;
  requestedMonthlyRepaymentKobo: number;
  /** (new instalment + external obligations) / recognised income, in bps */
  dtiBps: number;
  recognisedIncomeKobo: number;
  externalObligationsKobo: number;
  kycTier: number;
  kycCapKobo: number;
  scorecard: { id: string; key: string; version: number; name: string };
  reasons: EligibilityReasonDto[];
  suggestions: EligibilitySuggestionDto[];
  alternatives: AlternativeOfferDto[];
  factors: FactorContributionDto[];
  /** policy rules that fired */
  firedRules: { code: string; action: 'DECLINE' | 'REFER' }[];
  bureauReportId: string | null;
  simulated: boolean;
  createdAt: string;
}
/** Customer view (friendly wording only: no scorecard internals). */
export interface EligibilityCustomerDto {
  id: string;
  outcome: EligibilityOutcome;
  headline: string;
  summary: string;
  requested: { productId: string; amountKobo: number; tenorMonths: number };
  maxAmountKobo: number;
  reasons: { message: string; severity: ReasonSeverity }[];
  suggestions: Omit<EligibilitySuggestionDto, 'officerMessage'>[];
  alternatives: AlternativeOfferDto[];
}

/** POST /eligibility/simulate (staff, eligibility:run) */
export interface SimulateRequest {
  productId: string;
  amountKobo: number;
  tenorMonths: number;
  /** use this stored scorecard version… */
  scorecardId?: string;
  /** …or an unsaved draft definition */
  definition?: ScorecardDefinition;
  /** start from a real customer's current facts (latest bureau report, bank analysis, KYC)… */
  baseCustomerId?: string;
  /** …and override any fact */
  facts?: Partial<EligibilityFacts>;
}
export interface SimulateResponse { result: EligibilityResultDto; facts: EligibilityFacts }

/* ═════════════════════════ SCORECARDS ═════════════════════════ */
export type ScorecardStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
/** GET /scorecards (scorecard:read) → ScorecardDto[] ; GET /scorecards/:id ; GET /scorecards/fields → FactFieldMeta[] (from shared FACT_FIELDS)
 *  POST /scorecards {name, key?, fromId?, definition, notes?} → new DRAFT (next version of key) (scorecard:update)
 *  PUT /scorecards/:id {name?, definition, notes?} (DRAFT only)
 *  POST /scorecards/:id/request-activation {reason} → ApprovalDto  (maker-checker type SCORECARD_ACTIVATION; on approval the version becomes ACTIVE and the previous ACTIVE is RETIRED) */
export interface ScorecardDto {
  id: string;
  key: string;
  name: string;
  version: number;
  status: ScorecardStatus;
  definition: ScorecardDefinition;
  notes: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  activatedAt: string | null;
  pendingApprovalId: string | null;
}

/* ═════════════════════════ CREDIT BUREAU ═════════════════════════ */
export type BureauName = 'CRC' | 'FIRSTCENTRAL' | 'CREDITREGISTRY' | 'INTERSWITCH';
export type PullReason = 'APPLICATION' | 'PRE_DISBURSEMENT' | 'ON_DEMAND' | 'MONITORING';
export type FacilityStatus = 'PERFORMING' | 'Unpaid' | 'DEFAULTED' | 'WRITTEN_OFF' | 'CLOSED';
export type ScoreBand = 'POOR' | 'FAIR' | 'GOOD' | 'VERY_GOOD' | 'EXCELLENT';

export interface BureauScoreDto { bureau: BureauName; score: number | null; band: ScoreBand | null; minScore: number; maxScore: number }
export interface BureauFacilityDto {
  id: string;
  /** every bureau that reported this facility (deduplicated) */
  sources: BureauName[];
  lender: string;
  productType: string;
  amountGrantedKobo: number;
  outstandingKobo: number;
  status: FacilityStatus;
  tenorMonths: number | null;
  monthlyPaymentKobo: number;
  openedAt: string;
  closedAt: string | null;
  lastPaymentAt: string | null;
  worstDpd: number;
  isActive: boolean;
  legalAction: boolean;
  soldToCollections: boolean;
  isGuarantor: boolean;
  /** bureaus disagreed on status; we kept the most severe */
  conflict: boolean;
  /** up to 36 months, oldest first */
  history: { month: string; dpd: number }[];
}
export interface BureauEnquiryDto { lender: string; date: string; purpose: string; sources: BureauName[] }
export interface BureauFlagDto { type: 'FRAUD' | 'WATCHLIST' | 'GUARANTOR_DEFAULT'; source: BureauName; detail: string; date: string }
export interface BureauSummaryDto {
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
  /** months since the most recent write-off, null if none */
  lastWriteOffMonthsAgo: number | null;
  hasDpd90In12m: boolean;
  /** currently Unpaid/defaulted at another lender */
  elsewhereDefault: boolean;
  fraudFlag: boolean;
  legalActionCount: number;
  soldToCollectionsCount: number;
  guarantorExposureKobo: number;
  thinFile: boolean;
}
export interface BureauReportDto {
  id: string;
  customerId: string;
  pulledAt: string;
  expiresAt: string;
  ageDays: number;
  /** older than the pre-disbursement max age setting */
  stale: boolean;
  reason: PullReason;
  bureausQueried: BureauName[];
  bureausFailed: { bureau: BureauName; error: string }[];
  scores: BureauScoreDto[];
  summary: BureauSummaryDto;
  facilities: BureauFacilityDto[];
  enquiries: BureauEnquiryDto[];
  flags: BureauFlagDto[];
}
export interface BureauReportListItem { id: string; pulledAt: string; reason: PullReason; averageScore: number | null; bureausQueried: BureauName[] }
export interface BureauPullDto {
  id: string;
  customerId: string;
  /** masked */
  customerName: string;
  applicationId: string | null;
  bureau: BureauName | 'ALL';
  reason: PullReason;
  status: 'SUCCESS' | 'NO_HIT' | 'FAILED' | 'BLOCKED_NO_CONSENT' | 'CACHED';
  costKobo: number;
  durationMs: number | null;
  requestedBy: { id: string; name: string } | null;
  error: string | null;
  createdAt: string;
}
/** Staff bureau endpoints (permission in brackets)
 *  GET  /customers/:id/bureau → BureauReportDto | null            (bureau:read)  latest report
 *  GET  /customers/:id/bureau/history → BureauReportListItem[]    (bureau:read)
 *  GET  /customers/:id/bureau/reports/:reportId → BureauReportDto (bureau:read)
 *  POST /customers/:id/bureau/pull {force?:boolean} → BureauReportDto  (bureau:pull) reason ON_DEMAND; 403 CONSENT_REQUIRED without consent
 *  GET  /customers/:id/bureau/pulls → BureauPullDto[]             (bureau:read)
 *  GET  /bureau/pulls?page&pageSize&bureau&status&reason&from&to → Page<BureauPullDto>   (bureau:usage)
 *  GET  /bureau/usage?from&to → BureauUsageDto                    (bureau:usage)
 *  GET  /bureau/submissions?page → Page<BureauSubmissionDto>      (bureau:usage)
 *  POST /bureau/furnishing/run {period?:'yyyy-mm'} → BureauSubmissionDto[]  (bureau:manage)
 *  GET  /bureau/distribution → BureauDistributionDto              (bureau:usage; dataset for executive dashboards)
 *  GET  /bureau/monitoring/alerts?page → Page<RiskFlagDto>        (bureau:usage)
 *  POST /bureau/monitoring/run → {checked:number, alerts:number}  (bureau:manage) */
export interface BureauUsageDto {
  from: string;
  to: string;
  totalPulls: number;
  billablePulls: number;
  cacheHits: number;
  failed: number;
  blockedNoConsent: number;
  totalCostKobo: number;
  avgCostPerBillablePullKobo: number;
  byBureau: { bureau: BureauName; pulls: number; costKobo: number; successRate: number; avgDurationMs: number }[];
  byReason: { reason: PullReason; pulls: number; costKobo: number }[];
  daily: { date: string; pulls: number; costKobo: number }[];
}
export interface BureauSubmissionDto {
  id: string;
  bureau: BureauName;
  /** yyyy-mm */
  period: string;
  fileName: string;
  format: string;
  recordCount: number;
  acceptedCount: number;
  rejectedCount: number;
  status: 'SUBMITTED' | 'PARTIAL' | 'REJECTED' | 'FAILED';
  errors: { record: string; message: string }[];
  submittedAt: string;
}
export interface BureauDistributionDto {
  asOf: string;
  totalCustomers: number;
  averageScore: number | null;
  bands: { label: string; min: number; max: number; customers: number; exposureKobo: number }[];
  /** share of scored customers with an elsewhere-default / write-off */
  elsewhereDefaultPct: number;
  writeOffPct: number;
}
export interface RiskFlagDto {
  id: string;
  customerId: string;
  /** masked */
  customerName: string;
  type: 'ELSEWHERE_DEFAULT' | 'NEW_DELINQUENCY' | 'SCORE_DROP' | 'FRAUD_WATCHLIST';
  source: 'BUREAU_MONITORING' | 'BUREAU_PULL' | 'INTERNAL';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  detail: string;
  active: boolean;
  createdAt: string;
}

/* ═════════════════════════ CUSTOMER (STAFF VIEW) ═════════════════════════ */
export interface StaffDocumentDto extends DocumentDto {
  customerId: string;
  sha256: string;
  scanEngine: string | null;
  reviewedBy: { id: string; name: string } | null;
}
export interface ScreeningDto {
  id: string;
  type: 'SANCTIONS' | 'PEP';
  provider: string;
  status: 'CLEAR' | 'MATCH' | 'REVIEW';
  matchCount: number;
  reference: string | null;
  createdAt: string;
}
export interface FraudSignalDto {
  id: string;
  type:
    | 'DUPLICATE_BVN' | 'DUPLICATE_PHONE' | 'DUPLICATE_FACE' | 'DUPLICATE_NIN' | 'SHARED_DEVICE'
    | 'VELOCITY_REGISTRATION' | 'VELOCITY_APPLICATION' | 'NAME_MISMATCH' | 'PHONE_BVN_MISMATCH' | 'LIVENESS_FAIL';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  detail: string;
  relatedCustomerId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}
/** GET /customers/:id (customer:read) */
export interface CustomerDetailDto {
  id: string;
  /** masked */
  fullName: string;
  phone: string;
  email: string | null;
  bvn: string | null;
  state: string | null;
  branch: BranchRef | null;
  createdAt: string;
  portalRegistered: boolean;
  phoneVerified: boolean;
  emailVerified: boolean;
  employer: string | null;
  employmentStatus: string | null;
  monthlyIncomeKobo: number | null;
  salaryDay: number | null;
  kycTier: KycTier;
  kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  maxLoanKobo: number;
  verifications: KycVerificationDto[];
  documents: StaffDocumentDto[];
  consents: ConsentDto[];
  screening: ScreeningDto[];
  fraudSignals: FraudSignalDto[];
  riskFlags: RiskFlagDto[];
  applications: ApplicationSummaryDto[];
  bureau: { reportId: string; pulledAt: string; summary: BureauSummaryDto } | null;
}
/** POST /customers/:id/screening/run → ScreeningDto[] (screening:run) ; GET /customers/:id/fraud-signals ;
 *  POST /fraud-signals/:id/resolve {note} (fraud:resolve) ; POST /customers/:id/fraud-scan → FraudSignalDto[] (fraud:read)
 *  GET /documents/:id/download (document:read; audited; streams decrypted file) ; POST /documents/:id/review {status:'APPROVED'|'REJECTED', note?} (document:review) */

/* ═════════════════════════ PRODUCTS (extends LoanProductDto) ═════════════════════════ */
export interface LoanProductFullDto extends LoanProductDto {
  description: string;
  interestMethod: InterestMethod;
  processingFeeBps: number;
  managementFeeBps: number;
  insuranceFeeBps: number;
  penaltyBpsPerDay: number;
  penaltyGraceDays: number;
  gracePeriodDays: number;
  minKycTier: number;
  requiredDocs: DocumentKind[];
  minAge: number;
  maxAge: number;
  /** extra policy overrides, e.g. {maxDtiBps: 3500} */
  eligibilityOverrides: Record<string, unknown>;
  scorecardKey: string;
  allowGuarantor: boolean;
  allowCollateral: boolean;
}
/** GET /products → LoanProductFullDto[] (product:read) ; GET /products/:id ; POST /products (product:create; created inactive)
 *  PATCH /products/:id (product:update): non-pricing fields apply immediately; pricing fields
 *  (monthlyRateBps, interestMethod, *FeeBps, penalty*) are submitted to maker-checker (PRODUCT_RATE_CHANGE with payload {productId, changes})
 *  and return {product, approval}. */
export interface ProductPatchResponse { product: LoanProductFullDto; approval: ApprovalDto | null }

/* ═════════════════════════ APPLICATIONS ═════════════════════════ */
export const APPLICATION_STATUSES = [
  'DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED',
  'DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED', 'CLOSED', 'WRITTEN_OFF', 'REJECTED', 'CANCELLED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface ApplicationSummaryDto {
  id: string;
  reference: string;
  customer: { id: string; name: string };
  product: { id: string; name: string };
  amountKobo: number;
  tenorMonths: number;
  status: ApplicationStatus;
  statusReason: string | null;
  eligibilityOutcome: EligibilityOutcome | null;
  score: number | null;
  branch: BranchRef | null;
  submittedAt: string | null;
  createdAt: string;
}
export interface ApplicationEventDto {
  id: string;
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  actor: { type: 'CUSTOMER' | 'STAFF' | 'SYSTEM'; name: string };
  reason: string | null;
  at: string;
}
export interface AllowedTransitionDto { to: ApplicationStatus; label: string; requiresReason: boolean; permission: string | null; implemented: boolean }
export interface ApplicationDetailDto extends ApplicationSummaryDto {
  purpose: string | null;
  channel: 'PORTAL' | 'BRANCH';
  interestMethod: InterestMethod;
  monthlyRateBps: number;
  quote: LoanQuoteDto;
  eligibility: EligibilityResultDto | null;
  bureau: { reportId: string; pulledAt: string; summary: BureauSummaryDto; stale: boolean } | null;
  documents: StaffDocumentDto[];
  requiredDocs: { kind: DocumentKind; satisfied: boolean }[];
  events: ApplicationEventDto[];
  allowedTransitions: AllowedTransitionDto[];
  kyc: { tier: KycTier; maxLoanKobo: number };
  fraudSignals: FraudSignalDto[];
  customerDetailHref: string;
}
export interface StateMachineDto {
  states: { key: ApplicationStatus; label: string; phase: 'ORIGINATION' | 'DECISION' | 'BOOKED' | 'RECOVERY' | 'END'; terminal: boolean; implemented: boolean }[];
  transitions: { from: ApplicationStatus; to: ApplicationStatus; actor: 'CUSTOMER' | 'STAFF' | 'SYSTEM'; permission: string | null; label: string; implemented: boolean }[];
}
/** GET /applications?page&pageSize&q&status&productId&outcome&branchId → Page<ApplicationSummaryDto> (application:read, branch-scoped)
 *  GET /applications/state-machine → StateMachineDto
 *  GET /applications/:id → ApplicationDetailDto
 *  POST /applications {customerId, productId, amountKobo, tenorMonths, purpose?} → ApplicationDetailDto (application:create; DRAFT)
 *  POST /applications/:id/submit → ApplicationDetailDto (application:update; runs pipeline: KYC tier check → bureau → eligibility)
 *  POST /applications/:id/transition {to, reason?} → ApplicationDetailDto (permission per transition; unimplemented states return 501 {code:'NOT_IMPLEMENTED'})
 *  POST /applications/:id/reassess → ApplicationDetailDto (eligibility:run; re-runs eligibility with a fresh/cached bureau report)
 *  POST /loans/schedule-preview {productId, amountKobo, tenorMonths} → LoanQuoteDto (application:read) */
export type ApplicationListPage = Page<ApplicationSummaryDto>;
export type { ConsentStatusRef };
