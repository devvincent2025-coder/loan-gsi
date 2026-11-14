/**
 * Cross-module PORTS (dependency-injection tokens + interfaces). Modules depend on these, never on each other's
 * services directly, so Phase 2 modules (KYC, bureau, eligibility, applications) and later phases stay decoupled.
 * Provider modules `{ provide: X_PORT, useExisting: TheService }` and `exports: [X_PORT]` (all provider modules are @Global()).
 */
import type {
  BureauReportDto, BureauSummaryDto, DocumentKind, EligibilityResultDto, FacilityStatus, KycTier, PullReason,
} from '@damez/shared';

/* ── credit bureau (provided by BureauModule) ── */
export const BUREAU_PORT = Symbol('BUREAU_PORT');
export interface EnsureReportOptions {
  reason: PullReason;
  /** reuse a cached report if younger than this many days (default: setting bureau.cache_ttl_days) */
  maxAgeDays?: number;
  /** bypass cache */
  force?: boolean;
  requestedById?: string | null;
  applicationId?: string | null;
}
export interface BureauPort {
  /** Returns a usable report (cached or fresh). Throws ForbiddenException {code:'CONSENT_REQUIRED', purpose:'BUREAU_PULL'} when consent is missing (the attempt is logged as BLOCKED_NO_CONSENT). */
  ensureReport(customerId: string, opts: EnsureReportOptions): Promise<BureauReportDto>;
  /** Latest stored report summary (no pull). */
  latestSummary(customerId: string): Promise<{ reportId: string; pulledAt: Date; summary: BureauSummaryDto } | null>;
  getReport(reportId: string): Promise<BureauReportDto>;
  /** Pre-disbursement guard for prompt 3: refresh when older than setting bureau.pre_disbursement_max_age_days. */
  ensureFreshForDisbursement(customerId: string, requestedById?: string | null): Promise<BureauReportDto>;
}

/* ── KYC tier (provided by KycModule) ── */
export const KYC_TIER_PORT = Symbol('KYC_TIER_PORT');
export interface KycTierPort {
  /** recompute from verifications, persist on Customer.kycTier, return it */
  refreshTier(customerId: string): Promise<KycTier>;
  maxLoanKobo(tier: number): Promise<number>;
}

/* ── documents (provided by KycModule) ── */
export const DOCUMENTS_PORT = Symbol('DOCUMENTS_PORT');
export interface DocumentsPort {
  /** kinds with at least one CLEAN, non-rejected document for the customer (optionally for an application) */
  satisfiedKinds(customerId: string, applicationId?: string | null): Promise<Set<DocumentKind>>;
  /** decrypted bytes (internal use: statement analysis); never exposed without an audited endpoint */
  readContent(documentId: string): Promise<{ bytes: Buffer; mimeType: string; kind: DocumentKind }>;
  listIds(customerId: string, kind: DocumentKind): Promise<string[]>;
  /** attach the customer's unattached documents to an application */
  attachToApplication(customerId: string, applicationId: string): Promise<void>;
}

/* ── fraud (provided by KycModule) ── */
export const FRAUD_PORT = Symbol('FRAUD_PORT');
export interface FraudPort {
  unresolvedCounts(customerId: string): Promise<{ high: number; medium: number; low: number }>;
  /** velocity + duplicate checks when an application is submitted; may create FraudSignal rows */
  onApplicationSubmitted(customerId: string, applicationId: string): Promise<void>;
}

/* ── eligibility (provided by EligibilityModule) ── */
export const ELIGIBILITY_PORT = Symbol('ELIGIBILITY_PORT');
export interface EligibilityPort {
  assess(args: {
    customerId: string; productId: string; amountKobo: number; tenorMonths: number;
    applicationId?: string | null; createdById?: string | null;
    /** do not trigger a new bureau pull, use the latest stored report if any */
    noPull?: boolean;
  }): Promise<EligibilityResultDto>;
}

/* ── loan portfolio (prompt 3 supplies the real ledger; Phase 2 ships an application-based implementation) ── */
export const LOAN_PORTFOLIO_PORT = Symbol('LOAN_PORTFOLIO_PORT');
export interface PerformanceRecord {
  customerId: string;
  /** clear BVN (decrypted just-in-time for furnishing only) */
  bvn: string;
  fullName: string;
  phone: string;
  facilityRef: string;
  productType: string;
  openedAt: Date;
  amountGrantedKobo: number;
  outstandingKobo: number;
  monthlyPaymentKobo: number;
  tenorMonths: number;
  /** days past due at period end */
  dpd: number;
  status: FacilityStatus;
  lastPaymentAt: Date | null;
  closedAt: Date | null;
  writtenOffAt: Date | null;
}
export interface LoanPortfolioPort {
  /** customers with a booked, not-yet-closed loan (monitoring job input) */
  listActiveBorrowerIds(): Promise<string[]>;
  /** per-facility performance as at the end of `period` (yyyy-mm): furnishing job input */
  listPerformance(period: string): Promise<PerformanceRecord[]>;
  /** loans repaid / late instalments / written-off with us (eligibility "internal history") */
  internalHistory(customerId: string): Promise<{ completedLoans: number; lateInstalments: number; activeLoan: boolean; writtenOff: boolean }>;
}

/* ── ledger (provided by LedgerModule, prompt 3) ── */
export const LEDGER_PORT = Symbol('LEDGER_PORT');
export interface PostingInput { accountCode: string; side: 'DEBIT' | 'CREDIT'; amountKobo: number }
export interface PostJournalInput {
  date?: Date;
  memo: string;
  sourceType: 'DISBURSEMENT' | 'ACCRUAL' | 'REPAYMENT' | 'FEE' | 'PENALTY' | 'WAIVER' | 'WRITE_OFF' | 'RECOVERY' | 'RECONCILIATION_ADJUSTMENT' | 'MANUAL';
  sourceId?: string;
  loanId?: string;
  createdById?: string | null;
  postings: PostingInput[];
}
export interface LedgerPort {
  /** Posts a balanced journal entry (sum debits = sum credits) inside the given tx when provided. */
  post(input: PostJournalInput, tx?: unknown): Promise<{ id: string; reference: string }>;
  reverse(journalEntryId: string, memo: string, createdById?: string | null): Promise<{ id: string; reference: string }>;
  accountBalance(accountCode: string): Promise<number>;
  loanOutstanding(loanId: string): Promise<{ principalKobo: number; totalKobo: number }>;
}

/* ── payment provider: name enquiry + transfer disbursement (provided by DisbursementModule) ── */
export const PAYMENT_PROVIDER_PORT = Symbol('PAYMENT_PROVIDER_PORT');
export interface PaymentProviderPort {
  nameEnquiry(accountNumber: string, bankCode: string): Promise<{ accountName: string; accountNumber: string; bankCode: string }>;
  initiateTransfer(args: { idempotencyKey: string; amountKobo: number; accountNumber: string; bankCode: string; narration: string }): Promise<{ providerRef: string; status: 'PROCESSING' | 'SUCCESS' | 'FAILED' }>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

/* ── mandate / GSI / card tokenization (provided by AutodebitModule) ── */
export const MANDATE_PORT = Symbol('MANDATE_PORT');
export interface MandatePort {
  createNibssEmandate(args: { accountNumber: string; bankCode: string; bvn: string }): Promise<{ providerRef: string; status: 'ACTIVE' | 'PENDING' | 'FAILED' }>;
  tokenizeCard(args: { authorizationRef: string }): Promise<{ providerRef: string; cardLast4: string; cardBin: string; status: 'ACTIVE' | 'FAILED' }>;
  debit(args: { providerRef: string; amountKobo: number; idempotencyKey: string }): Promise<{ status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; collectedKobo: number; failureReason?: string }>;
}
export const GSI_PORT = Symbol('GSI_PORT');
export interface GsiPort {
  /** CBN GSI debit across the customer's BVN-linked accounts in priority order; partial debits allowed. */
  trigger(args: { customerId: string; bvn: string; amountKobo: number; idempotencyKey: string; accounts: { accountNumber: string; bankCode: string; priority: number }[] }): Promise<{ status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; collectedKobo: number; perAccount: { accountNumber: string; bankCode: string; collectedKobo: number }[] }>;
}
