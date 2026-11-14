/**
 * Prompt-4 DTO types: Collections, Behavioural Analytics, Customer 360, PII Vault, LlmGateway.
 * All money fields are integer kobo. No raw PII ever appears in these types — masked or tokenized only.
 */

// ─── Collections ──────────────────────────────────────────────────────────────

export type CollectionBucket = 'DPD_1_7' | 'DPD_8_30' | 'DPD_31_60' | 'DPD_61_90' | 'DPD_90_PLUS';
export type CollectionStatus = 'OPEN' | 'IN_PROGRESS' | 'PROMISE_TO_PAY' | 'LEGAL' | 'AGENCY' | 'WRITTEN_OFF' | 'SETTLED' | 'CLOSED';
export type CollectionChannel = 'PHONE_CALL' | 'SMS' | 'EMAIL' | 'WHATSAPP' | 'FIELD_VISIT' | 'PORTAL_MESSAGE' | 'LEGAL_NOTICE';
export type CollectionOutcome = 'NO_ANSWER' | 'WRONG_NUMBER' | 'LEFT_VOICEMAIL' | 'SPOKE_TO_BORROWER' | 'SPOKE_TO_THIRD_PARTY' | 'PROMISE_TO_PAY' | 'REFUSED_TO_PAY' | 'DISPUTE_RAISED' | 'COMPLAINT_LODGED' | 'VISITED_ADDRESS' | 'PAYMENT_MADE' | 'PARTIAL_PAYMENT';
export type PtpStatus = 'PENDING' | 'KEPT' | 'BROKEN' | 'PARTIAL' | 'SUPERSEDED';

export interface CollectionCaseDto {
  id: string;
  loanId: string;
  customerId: string;
  customerName: string;       // masked: "Adaeze O."
  customerPhone: string;      // masked: "0803****789"
  branchId: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  bucket: CollectionBucket;
  dpd: number;
  status: CollectionStatus;
  priority: number;
  totalOutstandingKobo: number;
  loanReference: string;
  productName: string;
  agencyId: string | null;
  legalCaseRef: string | null;
  lastActivityAt: string | null;
  nextActionAt: string | null;
  promiseCount: number;
  openPtpAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionCaseDetailDto extends CollectionCaseDto {
  activities: CollectionActivityDto[];
  promisesToPay: PromiseToPayDto[];
  agencyAssignments: AgencyAssignmentDto[];
}

export interface CollectionActivityDto {
  id: string;
  caseId: string;
  agentId: string | null;
  agentName: string;
  channel: CollectionChannel;
  outcome: CollectionOutcome;
  notes: string | null;          // shown only to authorized agents; redacted before LLM
  contactedAt: string;
  nextActionAt: string | null;
  nextActionNote: string | null;
  durationSecs: number | null;
  isFieldVisit: boolean;
}

export interface LogActivityDto {
  channel: CollectionChannel;
  outcome: CollectionOutcome;
  notes?: string;
  nextActionAt?: string;
  nextActionNote?: string;
  durationSecs?: number;
  isFieldVisit?: boolean;
  latitude?: number;
  longitude?: number;
}

export interface PromiseToPayDto {
  id: string;
  caseId: string;
  customerId: string;
  amountKobo: number;
  promisedDate: string;
  status: PtpStatus;
  keepRate: number | null;
  brokenAt: string | null;
  keptAt: string | null;
  createdAt: string;
}

export interface CreatePtpDto {
  amountKobo: number;
  promisedDate: string;
}

export interface AgencyAssignmentDto {
  id: string;
  caseId: string;
  agencyId: string;
  agencyName: string;
  commissionBps: number;
  status: string;
  settledAt: string | null;
  recoveredKobo: number;
  assignedAt: string;
}

export interface ThirdPartyAgencyDto {
  id: string;
  name: string;
  code: string;
  commissionBps: number;
  isActive: boolean;
}

export interface CollectionsQueueSummaryDto {
  total: number;
  byBucket: Record<CollectionBucket, number>;
  byStatus: Record<string, number>;
  totalOutstandingKobo: number;
  avgDpd: number;
  ptpBreakRate: number;          // 0-1
  cureRate30d: number;           // 0-1: % moved from Unpaid to current in 30d
  agentLeaderboard: AgentLeaderboardRowDto[];
}

export interface AgentLeaderboardRowDto {
  agentId: string;
  agentName: string;
  casesHandled: number;
  ptpKept: number;
  ptpBroken: number;
  amountRecoveredKobo: number;
}

export interface AssignCaseDto {
  assignedToId: string;
}

export interface AssignAgencyDto {
  agencyId: string;
}

// ─── Behavioural Analytics ───────────────────────────────────────────────────

export type CustomerSegment = 'RELIABLE' | 'SALARY_CYCLE_PAYER' | 'RELUCTANT' | 'HIGH_RISK' | 'AT_RISK_OF_CHURN' | 'UNKNOWN';

export interface BehaviourSnapshotDto {
  id: string;
  customerId: string;
  snapshotDate: string;
  onTimeRatio: number;
  avgDaysLate: number;
  paydaySensitivity: number;
  channelResponsiveness: number;
  partialPaymentRatio: number;
  avgBalanceAtDebitKobo: number;
  repeatBorrowVelocity: number;
  bureauDefaultCount: number;
  pdScore: number;
  segment: CustomerSegment;
  summaryText: string;
  bestContactChannel: CollectionChannel;
  bestContactTime: string;       // e.g. "Weekday morning"
}

export interface EarlyWarningFlagDto {
  id: string;
  customerId: string;
  customerName: string;   // masked
  loanId: string;
  loanReference: string;
  flagDate: string;
  pdScore: number;
  triggerReason: string;
  status: string;
  actionTakenAt: string | null;
  actionNote: string | null;
  createdAt: string;
}

export interface BehaviourPortfolioDto {
  totalCustomers: number;
  bySegment: Record<CustomerSegment, number>;
  avgPdScore: number;
  earlyWarnings: number;
  rollRate30d: number;   // % of Stage1 loans that rolled to Stage2 in 30d
  cureRate30d: number;
  segmentTrend: { date: string; segment: CustomerSegment; count: number }[];
}

// ─── Customer 360 ─────────────────────────────────────────────────────────────

export interface Customer360Dto {
  customerId: string;
  displayName: string;       // masked: "Adaeze O."
  phone: string;             // masked
  email: string | null;      // masked
  kycTier: number;
  riskFlags: string[];
  segment: CustomerSegment;
  pdScore: number;
  behaviourSummary: string;
  loans: Customer360LoanDto[];
  activeCase: CollectionCaseDto | null;
  earlyWarnings: EarlyWarningFlagDto[];
  repaymentTimeline: RepaymentTimelineEntryDto[];
  linkedAccounts: LinkedAccountSummaryDto[];
  communicationsCount: number;
  lastContactAt: string | null;
}

export interface Customer360LoanDto {
  loanId: string;
  reference: string;
  productName: string;
  principalKobo: number;
  outstandingKobo: number;
  status: string;
  dpd: number;
  ifrsStage: number;
  disbursedAt: string;
  maturityDate: string;
}

export interface RepaymentTimelineEntryDto {
  date: string;
  type: 'REPAYMENT' | 'DEBIT_ATTEMPT' | 'PTP' | 'ACTIVITY';
  amountKobo: number | null;
  status: string;
  channel: string | null;
  notes: string | null;
}

export interface LinkedAccountSummaryDto {
  id: string;
  bankCode: string;
  accountNameMasked: string;
  accountNumberMasked: string;
  isPrimary: boolean;
  status: string;
}

// ─── PII Vault & LlmGateway ───────────────────────────────────────────────────

export type TokenType = 'CUST' | 'BVN' | 'NIN' | 'PHONE' | 'EMAIL' | 'NUBAN' | 'ADDR' | 'DEVICE' | 'FREETEXT';

export interface PiiTokenDto {
  token: string;
  tokenType: TokenType;
  displayMask: string;    // e.g. "0803****789" or "BVN ******1234"
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface LlmBlockLogDto {
  id: string;
  feature: string;
  userId: string | null;
  detectedTypes: string[];
  createdAt: string;
}

export interface PiiLeakReportDto {
  periodDays: number;
  blockedRequests: number;
  blocksByFeature: Record<string, number>;
  blocksByType: Record<string, number>;
  revealEvents: number;
  revealsByUser: { userId: string; userName: string; count: number }[];
  detectorHitRate: number;   // blocked / total outbound
}

export interface LlmUsageDto {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  estimatedCostUsd: number;
  byFeature: Record<string, { requests: number; tokens: number }>;
}
