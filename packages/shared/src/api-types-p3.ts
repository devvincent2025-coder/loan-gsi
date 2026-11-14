/**
 * Phase 3 DTOs: underwriting/offers, loans, ledger, disbursement, linked accounts, mandates/GSI, autodebit.
 * Money = kobo integers (JSON number). Dates = ISO strings over the wire.
 */
import type { ApplicationStatus } from './api-types-p2';

/* ── offers ── */
export const OFFER_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface OfferScheduleRowDto {
  seq: number;
  dueDate: string;
  principalKobo: number;
  interestKobo: number;
  feeKobo: number;
  totalKobo: number;
  balanceAfterKobo: number;
}

export interface LoanOfferDto {
  id: string;
  applicationId: string;
  offerNumber: string;
  isCounterOffer: boolean;
  principalKobo: number;
  tenorMonths: number;
  monthlyRateBps: number;
  interestMethod: string;
  totalInterestKobo: number;
  totalFeesKobo: number;
  totalCostOfCreditKobo: number;
  totalRepayableKobo: number;
  gsiBps: number;
  schedule: OfferScheduleRowDto[];
  autodebitConsentRequired: boolean;
  gsiConsentRequired: boolean;
  coolingOffHours: number;
  status: OfferStatus;
  sentAt: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  createdAt: string;
}

export interface CreateOfferDto {
  applicationId: string;
  principalKobo: number;
  tenorMonths: number;
  monthlyRateBps?: number;
  isCounterOffer?: boolean;
  note?: string;
}

export interface AcceptOfferDto {
  otpCode: string;
  eSignatureName: string;
  acceptedTermsVersion: string;
  waiveCoolingOff?: boolean;
}

/* ── underwriting decisions ── */
export const DECISION_ACTIONS = ['APPROVE', 'REJECT', 'REFER', 'REQUEST_INFO', 'COUNTER_OFFER'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export interface UnderwritingDecisionDto {
  action: DecisionAction;
  reason?: string;
  amountKobo?: number;
  tenorMonths?: number;
  note?: string;
  /** Required for action REFER: 1-2 staff user ids to refer the application to. */
  assigneeIds?: string[];
}

/** BVN prefill result for the Add Customer form's "To"-style lookup. No PII is persisted by this call. */
export interface BvnLookupResultDto {
  found: boolean;
  firstName?: string;
  lastName?: string;
  phone?: string;
  /** yyyy-mm-dd */
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE';
}

/** Lightweight staff-directory entry for "To"-style pickers (referrals, assignments). */
export interface StaffDirectoryEntryDto {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  branchName: string | null;
}

export interface UnderwritingNoteDto {
  id: string;
  applicationId: string;
  authorId: string | null;
  authorName: string;
  kind: 'NOTE' | 'DECISION' | 'REQUEST_INFO';
  body: string;
  createdAt: string;
}

export interface UnderwritingQueueItemDto {
  applicationId: string;
  reference: string;
  customerId: string;
  customerName: string;
  productName: string;
  requestedAmountKobo: number;
  tenorMonths: number;
  status: ApplicationStatus;
  eligibilityOutcome: string | null;
  score: number | null;
  submittedAt: string | null;
  assignedToId: string | null;
  branchId: string | null;
  slaHoursRemaining: number | null;
}

/* ── loans & servicing ── */
export const LOAN_STATUSES = ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED', 'CLOSED', 'WRITTEN_OFF'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const INSTALLMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export interface LoanInstallmentDto {
  id: string;
  seq: number;
  dueDate: string;
  principalKobo: number;
  interestKobo: number;
  feeKobo: number;
  totalKobo: number;
  paidKobo: number;
  penaltyAccruedKobo: number;
  status: InstallmentStatus;
  paidAt: string | null;
}

export interface LoanDto {
  id: string;
  applicationId: string;
  reference: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  branchId: string | null;
  principalKobo: number;
  disbursedAmountKobo: number;
  tenorMonths: number;
  monthlyRateBps: number;
  totalCostOfCreditKobo: number;
  status: LoanStatus;
  disbursedAt: string;
  maturityDate: string;
  outstandingPrincipalKobo: number;
  outstandingTotalKobo: number;
  dpd: number;
  ifrsStage: number;
  restructureCount: number;
  closedAt: string | null;
  writtenOffAt: string | null;
  writtenOffAmountKobo: number | null;
}

export interface LoanDetailDto extends LoanDto {
  installments: LoanInstallmentDto[];
  repayments: RepaymentDto[];
  mandates: MandateDto[];
}

export const REPAYMENT_METHODS = ['AUTODEBIT_MANDATE', 'AUTODEBIT_GSI', 'MANUAL', 'CASH', 'TRANSFER'] as const;
export type RepaymentMethod = (typeof REPAYMENT_METHODS)[number];
export const REPAYMENT_KINDS = ['SCHEDULED', 'EARLY', 'PART', 'TOPUP_NET', 'RECOVERY'] as const;
export type RepaymentKind = (typeof REPAYMENT_KINDS)[number];

export interface RepaymentDto {
  id: string;
  loanId: string;
  receiptNumber: string;
  kind: RepaymentKind;
  method: RepaymentMethod;
  amountKobo: number;
  allocatedPenaltyKobo: number;
  allocatedFeeKobo: number;
  allocatedInterestKobo: number;
  allocatedPrincipalKobo: number;
  createdAt: string;
}

export interface MakeRepaymentDto {
  amountKobo: number;
  kind: 'EARLY' | 'PART' | 'TOPUP_NET';
  method: 'MANUAL' | 'CASH' | 'TRANSFER';
  reference?: string;
}

export interface RestructureRequestDto {
  newTenorMonths: number;
  newMonthlyRateBps?: number;
  reason: string;
}

/* ── linked accounts ── */
export const LINKED_ACCOUNT_STATUSES = ['PENDING', 'VERIFIED', 'FAILED', 'REMOVED'] as const;
export type LinkedAccountStatus = (typeof LINKED_ACCOUNT_STATUSES)[number];

export interface LinkedAccountDto {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumberMasked: string;
  accountNameMasked: string;
  isPrimary: boolean;
  priority: number;
  status: LinkedAccountStatus;
  verificationMethod: string | null;
  bvnNameMatchScore: number | null;
  failureReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface LinkAccountDto {
  accountNumber: string;
  bankCode: string;
  isPrimary?: boolean;
}

/* ── mandates / GSI ── */
export const MANDATE_TYPES = ['NIBSS_EMANDATE', 'CARD_TOKEN', 'GSI'] as const;
export type MandateType = (typeof MANDATE_TYPES)[number];
export const MANDATE_STATUSES = ['PENDING', 'ACTIVE', 'FAILED', 'REVOKED', 'EXPIRED'] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export interface MandateDto {
  id: string;
  type: MandateType;
  provider: string;
  status: MandateStatus;
  linkedAccountId: string | null;
  cardLast4: string | null;
  priority: number;
  activatedAt: string | null;
  failureReason: string | null;
}

export interface CreateMandateDto {
  type: 'NIBSS_EMANDATE' | 'CARD_TOKEN';
  linkedAccountId?: string;
  cardAuthorizationRef?: string;
}

export interface GsiConsentDto {
  acknowledged: boolean;
  otpCode: string;
}

/* ── disbursement ── */
export const DISBURSEMENT_STATUSES = ['PENDING', 'NAME_ENQUIRY_DONE', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED'] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

export interface DisbursementRequestDto {
  id: string;
  loanId: string;
  amountKobo: number;
  provider: string;
  method: 'AUTOMATED' | 'MANUAL';
  status: DisbursementStatus;
  providerRef: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface NameEnquiryResultDto {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  matched: boolean;
  matchScore: number;
}

/* ── debit engine ── */
export const DEBIT_ATTEMPT_STATUSES = ['SCHEDULED', 'INITIATED', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export type DebitAttemptStatus = (typeof DEBIT_ATTEMPT_STATUSES)[number];

export interface DebitAttemptDto {
  id: string;
  loanId: string;
  installmentId: string | null;
  method: MandateType;
  retryStage: string;
  attemptNumber: number;
  amountKobo: number;
  collectedKobo: number;
  status: DebitAttemptStatus;
  failureReason: string | null;
  scheduledFor: string;
  executedAt: string | null;
}

export interface DebitSuccessRateByBankDto { bankName: string; attempts: number; successes: number; successRateBps: number }
export interface MandateStatusSummaryDto { status: MandateStatus; count: number }
export interface FailedDebitReasonDto { reason: string; count: number }
export interface GsiRecoverySummaryDto { period: string; recoveredKobo: number; attempts: number; successes: number }
export interface LinkedAccountHealthDto { customerId: string; customerName: string; verifiedCount: number; requiredCount: number; healthy: boolean }

export interface AutodebitDashboardDto {
  successRateByBank: DebitSuccessRateByBankDto[];
  mandateStatusSummary: MandateStatusSummaryDto[];
  failedReasons: FailedDebitReasonDto[];
  gsiRecovery: GsiRecoverySummaryDto[];
  linkedAccountHealth: { totalCustomers: number; healthyCustomers: number; samples: LinkedAccountHealthDto[] };
}

/* ── ledger / finance ── */
export interface LedgerAccountDto { id: string; code: string; name: string; type: string; normalSide: 'DEBIT' | 'CREDIT'; balanceKobo: number }
export interface JournalPostingDto { accountCode: string; accountName: string; side: 'DEBIT' | 'CREDIT'; amountKobo: number }
export interface JournalEntryDto {
  id: string;
  reference: string;
  date: string;
  memo: string;
  sourceType: string;
  loanId: string | null;
  postings: JournalPostingDto[];
}

export interface GlExportRowDto { date: string; reference: string; accountCode: string; accountName: string; debitKobo: number; creditKobo: number; memo: string }

export interface TreasuryCashPositionDto {
  asOfDate: string;
  cashKobo: number;
  disbursedTodayKobo: number;
  collectedTodayKobo: number;
  pendingDisbursementsKobo: number;
  unreconciledKobo: number;
}

export interface SettlementReconciliationSummaryDto {
  period: string;
  matched: number;
  unmatched: number;
  exceptions: number;
  matchedKobo: number;
  unmatchedKobo: number;
}

/* ── IFRS 9 / ECL ── */
export interface EclConfigDto {
  stage1PdBps: number;
  stage2PdBps: number;
  stage3PdBps: number;
  lgdBps: number;
  stage2DpdThreshold: number;
  stage3DpdThreshold: number;
}

export interface LoanStagingDto {
  loanId: string;
  reference: string;
  customerName: string;
  outstandingKobo: number;
  dpd: number;
  stage: number;
  pdBps: number;
  lgdBps: number;
  eadKobo: number;
  eclKobo: number;
}

export interface ProvisioningReportDto {
  asOfDate: string;
  byStage: { stage: number; loanCount: number; eadKobo: number; eclKobo: number }[];
  totalEadKobo: number;
  totalEclKobo: number;
  loans: LoanStagingDto[];
}
