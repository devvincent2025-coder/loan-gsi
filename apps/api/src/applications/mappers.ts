/**
 * Local, dependency-free mappers for the applications module (product → pricing/DTOs, assessment rows → DTOs,
 * customer-friendly wording). Kept here so the module does not import other agents' services (no cycles).
 */
import type { LoanProduct, EligibilityAssessment, Scorecard } from '@prisma/client';
import {
  buildSchedule, DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type ApplicationStatus, type DocumentKind, type EligibilityCustomerDto, type EligibilityOutcome,
  type EligibilityResultDto, type InterestMethod, type LoanQuoteDto, type PortalApplicationDto, type PortalProductDto,
} from '@damez/shared';

/** Frozen copy of product pricing stored on the application so later product edits never change in-flight applications. */
export interface PricingSnapshot {
  monthlyRateBps: number;
  interestMethod: InterestMethod;
  processingFeeBps: number;
  managementFeeBps: number;
  insuranceFeeBps: number;
  penaltyBpsPerDay: number;
  penaltyGraceDays: number;
  gracePeriodDays: number;
  /** demo/simulation hooks used by the portfolio port (never set by the app itself) */
  simulatedDpd?: number;
  simulatedLateInstalments?: number;
}

export function pricingFromProduct(p: LoanProduct): PricingSnapshot {
  return {
    monthlyRateBps: p.monthlyRateBps, interestMethod: p.interestMethod as InterestMethod, processingFeeBps: p.processingFeeBps,
    managementFeeBps: p.managementFeeBps, insuranceFeeBps: p.insuranceFeeBps, penaltyBpsPerDay: p.penaltyBpsPerDay,
    penaltyGraceDays: p.penaltyGraceDays, gracePeriodDays: p.gracePeriodDays,
  };
}

export const readPricing = (json: unknown): PricingSnapshot => json as PricingSnapshot;

export function buildQuote(pricing: PricingSnapshot, amountKobo: number, tenorMonths: number, startDate?: Date): LoanQuoteDto {
  return buildSchedule({
    principalKobo: amountKobo, tenorMonths, monthlyRateBps: pricing.monthlyRateBps, method: pricing.interestMethod,
    processingFeeBps: pricing.processingFeeBps, managementFeeBps: pricing.managementFeeBps, insuranceFeeBps: pricing.insuranceFeeBps,
    penaltyBpsPerDay: pricing.penaltyBpsPerDay, penaltyGraceDays: pricing.penaltyGraceDays,
    graceMonths: Math.floor(pricing.gracePeriodDays / 30), startDate,
  });
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2).replace(/(\.\d)0$/, '$1')}%`;

export function feesSummary(p: Pick<LoanProduct, 'processingFeeBps' | 'managementFeeBps' | 'insuranceFeeBps'>): string {
  const parts: string[] = [];
  if (p.processingFeeBps) parts.push(`${pct(p.processingFeeBps)} processing`);
  if (p.managementFeeBps) parts.push(`${pct(p.managementFeeBps)} management`);
  if (p.insuranceFeeBps) parts.push(`${pct(p.insuranceFeeBps)} insurance`);
  return parts.length ? `${parts.join(' + ')}, deducted upfront` : 'No upfront fees';
}

export function requiredDocsOf(p: Pick<LoanProduct, 'requiredDocs'>): DocumentKind[] {
  const v = p.requiredDocs;
  return Array.isArray(v) ? (v as unknown[]).filter((k): k is DocumentKind => (DOCUMENT_KINDS as readonly string[]).includes(k as string)) : [];
}

export function toPortalProductDto(p: LoanProduct, customerTier: number, tierCapKobo: number): PortalProductDto {
  let lockedReason: string | null = null;
  if (!p.isActive) lockedReason = 'This product is not available right now.';
  else if (customerTier < p.minKycTier) lockedReason = `Complete Tier ${p.minKycTier} identity verification to unlock this loan.`;
  else if (tierCapKobo < Number(p.minAmountKobo)) lockedReason = 'Your current verification level does not allow loans of this size. Upgrade your verification to unlock it.';
  return {
    id: p.id, code: p.code, name: p.name, description: p.description, minAmountKobo: Number(p.minAmountKobo), maxAmountKobo: Number(p.maxAmountKobo),
    minTenorMonths: p.minTenorMonths, maxTenorMonths: p.maxTenorMonths, monthlyRateBps: p.monthlyRateBps, interestMethod: p.interestMethod as InterestMethod,
    feesSummary: feesSummary(p), requiredDocs: requiredDocsOf(p), minKycTier: p.minKycTier, available: lockedReason === null, lockedReason,
    allowGuarantor: p.allowGuarantor, allowCollateral: p.allowCollateral,
  };
}

/** Assessment row (+ scorecard) → staff EligibilityResultDto. */
export function toEligibilityResultDto(a: EligibilityAssessment, sc: Pick<Scorecard, 'id' | 'key' | 'version' | 'name'> | null): EligibilityResultDto {
  return {
    id: a.id, outcome: a.outcome as EligibilityOutcome, score: a.score, scoreBand: a.scoreBand as EligibilityResultDto['scoreBand'],
    requested: { productId: a.productId, amountKobo: Number(a.requestedAmountKobo), tenorMonths: a.tenorMonths },
    maxAmountKobo: Number(a.maxAmountKobo), maxMonthlyRepaymentKobo: Number(a.maxRepaymentKobo), requestedMonthlyRepaymentKobo: Number(a.requestedRepaymentKobo),
    dtiBps: a.dtiBps, recognisedIncomeKobo: Number(a.recognisedIncomeKobo), externalObligationsKobo: Number(a.externalObligationsKobo),
    kycTier: a.kycTier, kycCapKobo: Number(a.kycCapKobo),
    scorecard: sc ? { id: sc.id, key: sc.key, version: sc.version, name: sc.name } : { id: a.scorecardId, key: 'unknown', version: 0, name: 'Unknown scorecard' },
    reasons: (a.reasons ?? []) as unknown as EligibilityResultDto['reasons'], suggestions: (a.suggestions ?? []) as unknown as EligibilityResultDto['suggestions'],
    alternatives: (a.alternatives ?? []) as unknown as EligibilityResultDto['alternatives'], factors: (a.factors ?? []) as unknown as EligibilityResultDto['factors'],
    firedRules: (a.firedRules ?? []) as unknown as EligibilityResultDto['firedRules'], bureauReportId: a.bureauReportId, simulated: a.simulated, createdAt: a.createdAt.toISOString(),
  };
}

const HEADLINES: Record<EligibilityOutcome, { headline: string; summary: string }> = {
  ELIGIBLE: { headline: 'Good news: you qualify', summary: 'Based on what we know, you can get this loan on the terms you asked for. A credit officer will still review your application.' },
  CONDITIONAL: { headline: 'You may qualify with some changes', summary: 'We cannot offer exactly what you asked for yet, but there are options below that could work for you.' },
  INELIGIBLE: { headline: 'We cannot offer this loan right now', summary: 'You do not meet the requirements for this loan at the moment. See below what you can do to improve your chances.' },
};

/** Friendly customer view: no scorecard internals, no officer wording. */
export function toCustomerView(r: EligibilityResultDto): EligibilityCustomerDto {
  const h = HEADLINES[r.outcome];
  return {
    id: r.id, outcome: r.outcome, headline: h.headline, summary: h.summary, requested: r.requested, maxAmountKobo: r.maxAmountKobo,
    reasons: r.reasons.filter((x) => x.severity !== 'INFO').map((x) => ({ message: x.customerMessage, severity: x.severity })),
    suggestions: r.suggestions.map(({ officerMessage: _o, ...rest }) => rest),
    alternatives: r.alternatives,
  };
}

/** The most important customer-facing reason (blockers first). */
export function topCustomerReason(r: Pick<EligibilityResultDto, 'reasons'>): string {
  const b = r.reasons.find((x) => x.severity === 'BLOCKER') ?? r.reasons.find((x) => x.severity === 'WARNING') ?? r.reasons[0];
  return b?.customerMessage ?? 'Your application does not meet our lending criteria at this time.';
}

/** Customer-facing copy per status. */
export const CUSTOMER_STATUS_COPY: Record<ApplicationStatus, { label: string; message: string }> = {
  DRAFT: { label: 'Draft', message: 'Your application has not been submitted yet.' },
  SUBMITTED: { label: 'Submitted', message: 'We have received your application and are checking your details.' },
  KYC_PENDING: { label: 'Verification needed', message: 'We need you to finish identity verification before we can continue.' },
  BUREAU_CHECK: { label: 'Checking your credit', message: 'We are reviewing your credit history. This usually takes a few moments.' },
  UNDER_REVIEW: { label: 'Under review', message: 'A credit officer is reviewing your application. We will message you as soon as there is a decision.' },
  APPROVED: { label: 'Approved', message: 'Your loan has been approved. Your offer will be sent shortly.' },
  OFFER_SENT: { label: 'Offer ready', message: 'Your loan offer is ready for you to review and accept.' },
  OFFER_ACCEPTED: { label: 'Offer accepted', message: 'Thanks for accepting. We are preparing your disbursement.' },
  DISBURSED: { label: 'Disbursed', message: 'Your loan has been paid out.' },
  ACTIVE: { label: 'Active loan', message: 'Your loan is active. Repay on time to keep a good record.' },
  Unpaid: { label: 'Payment overdue', message: 'You have an overdue instalment. Please pay as soon as you can.' },
  RESTRUCTURED: { label: 'Restructured', message: 'Your repayment plan has been adjusted.' },
  CLOSED: { label: 'Closed', message: 'This loan has been fully repaid. Thank you.' },
  WRITTEN_OFF: { label: 'Closed (written off)', message: 'This loan has been closed. Please contact us.' },
  REJECTED: { label: 'Not approved', message: 'We could not approve this application.' },
  CANCELLED: { label: 'Cancelled', message: 'This application was cancelled.' },
};

export const docLabel = (k: DocumentKind) => DOCUMENT_KIND_LABELS[k];

export type NextAction = PortalApplicationDto['nextAction'];
