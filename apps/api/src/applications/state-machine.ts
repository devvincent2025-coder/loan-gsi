/**
 * Loan application state machine. PURE (no Nest/Prisma): the single source of truth for which transitions exist,
 * who may perform them and which are implemented yet. Transitions flagged `implemented: false` are part of the
 * contract (the UI shows them) but throw 501 until prompt 3 (approvals, offers, disbursement, ledger, collections).
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { AllowedTransitionDto, ApplicationStatus, StateMachineDto } from '@damez/shared';

export type Actor = 'CUSTOMER' | 'STAFF' | 'SYSTEM';
export type Phase = 'ORIGINATION' | 'DECISION' | 'BOOKED' | 'RECOVERY' | 'END';

export interface StateDef { key: ApplicationStatus; label: string; phase: Phase; terminal: boolean; implemented: boolean }
export interface TransitionDef {
  from: ApplicationStatus;
  to: ApplicationStatus;
  actors: Actor[];
  /** staff permission required when the actor is STAFF */
  permission: string | null;
  label: string;
  guards: string[];
  requiresReason: boolean;
  implemented: boolean;
  /** shown in the 501 message */
  arrivesIn?: string;
}

export const STATES: StateDef[] = [
  { key: 'DRAFT', label: 'Draft', phase: 'ORIGINATION', terminal: false, implemented: true },
  { key: 'SUBMITTED', label: 'Submitted', phase: 'ORIGINATION', terminal: false, implemented: true },
  { key: 'KYC_PENDING', label: 'KYC pending', phase: 'ORIGINATION', terminal: false, implemented: true },
  { key: 'BUREAU_CHECK', label: 'Credit check', phase: 'ORIGINATION', terminal: false, implemented: true },
  { key: 'UNDER_REVIEW', label: 'Under review', phase: 'DECISION', terminal: false, implemented: true },
  { key: 'APPROVED', label: 'Approved', phase: 'DECISION', terminal: false, implemented: true },
  { key: 'OFFER_SENT', label: 'Offer sent', phase: 'DECISION', terminal: false, implemented: true },
  { key: 'OFFER_ACCEPTED', label: 'Offer accepted', phase: 'DECISION', terminal: false, implemented: true },
  { key: 'DISBURSED', label: 'Disbursed', phase: 'BOOKED', terminal: false, implemented: true },
  { key: 'ACTIVE', label: 'Active', phase: 'BOOKED', terminal: false, implemented: true },
  { key: 'Unpaid', label: 'Unpaid', phase: 'RECOVERY', terminal: false, implemented: true },
  { key: 'RESTRUCTURED', label: 'Restructured', phase: 'RECOVERY', terminal: false, implemented: true },
  { key: 'CLOSED', label: 'Closed', phase: 'END', terminal: true, implemented: true },
  { key: 'WRITTEN_OFF', label: 'Written off', phase: 'END', terminal: true, implemented: true },
  { key: 'REJECTED', label: 'Rejected', phase: 'END', terminal: true, implemented: true },
  { key: 'CANCELLED', label: 'Cancelled', phase: 'END', terminal: true, implemented: true },
];

/** Pre-booking states a customer/staff may still cancel from. */
export const CANCELLABLE: ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT'];
/** Non-terminal states before a loan is booked: used by the "one open application per customer+product" guard. */
export const OPEN_PRE_BOOKING: ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED'];
/** Statuses with a booked loan. */
export const BOOKED: ApplicationStatus[] = ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED'];

const t =(d: Omit<TransitionDef, 'requiresReason' | 'guards' | 'permission'> & Partial<Pick<TransitionDef, 'requiresReason' | 'guards' | 'permission'>>): TransitionDef =>
  ({ requiresReason: false, guards: [], permission: null, ...d });

export const TRANSITIONS: TransitionDef[] = [
  t({ from: 'DRAFT', to: 'SUBMITTED', actors: ['CUSTOMER', 'STAFF'], permission: 'application:update', label: 'Submit application', implemented: true, guards: ['productActive', 'amountWithinBounds', 'tenorWithinBounds', 'noOpenDuplicate'] }),
  t({ from: 'SUBMITTED', to: 'KYC_PENDING', actors: ['SYSTEM'], label: 'Waiting for identity verification', implemented: true, guards: ['kycTierBelowProductMinimum'] }),
  t({ from: 'SUBMITTED', to: 'BUREAU_CHECK', actors: ['SYSTEM'], label: 'Start credit check', implemented: true, guards: ['kycTierSufficient', 'requiredDocsSatisfied'] }),
  t({ from: 'KYC_PENDING', to: 'BUREAU_CHECK', actors: ['SYSTEM'], label: 'Identity verified, start credit check', implemented: true, guards: ['kycTierSufficient', 'requiredDocsSatisfied'] }),
  t({ from: 'BUREAU_CHECK', to: 'UNDER_REVIEW', actors: ['SYSTEM'], label: 'Send to credit review', implemented: true, guards: ['bureauConsentPresent', 'eligibilityAssessed'] }),
  t({ from: 'BUREAU_CHECK', to: 'REJECTED', actors: ['SYSTEM'], label: 'Auto-decline (policy rule)', implemented: true, guards: ['eligibilityIneligible', 'declineRuleFired', 'autoDeclineEnabled'] }),
  t({ from: 'UNDER_REVIEW', to: 'REJECTED', actors: ['STAFF'], permission: 'loan:reject', label: 'Reject application', implemented: true, requiresReason: true, guards: ['reasonRequired'] }),
  ...CANCELLABLE.map((from) => t({ from, to: 'CANCELLED', actors: ['CUSTOMER', 'STAFF'], permission: 'application:update', label: 'Cancel application', implemented: true, requiresReason: true, guards: ['reasonRequired'] })),
  // ── prompt 3: approval → offer → disbursement → servicing → recovery (guards enforced by the calling service) ──
  t({ from: 'UNDER_REVIEW', to: 'APPROVED', actors: ['STAFF'], permission: 'loan:approve', label: 'Approve application', implemented: true, guards: ['approvalLimit', 'makerChecker:LOAN_APPROVAL'] }),
  t({ from: 'APPROVED', to: 'OFFER_SENT', actors: ['STAFF', 'SYSTEM'], permission: 'loan:approve', label: 'Send offer to customer', implemented: true, guards: ['bureauFresh'] }),
  t({ from: 'OFFER_SENT', to: 'OFFER_ACCEPTED', actors: ['CUSTOMER'], label: 'Accept offer (e-signature + OTP)', implemented: true, guards: ['eSignature', 'otpVerified', 'offerNotExpired', 'linkedAccountsVerified'] }),
  t({ from: 'OFFER_ACCEPTED', to: 'DISBURSED', actors: ['STAFF', 'SYSTEM'], permission: 'loan:disburse', label: 'Disburse loan', implemented: true, guards: ['bureauFresh', 'disbursementAccountVerified'] }),
  t({ from: 'DISBURSED', to: 'ACTIVE', actors: ['SYSTEM'], label: 'Activate loan', implemented: true, guards: ['ledgerBooked'] }),
  t({ from: 'ACTIVE', to: 'Unpaid', actors: ['SYSTEM'], label: 'Mark Unpaid', implemented: true, guards: ['overdueInstalment'] }),
  t({ from: 'Unpaid', to: 'ACTIVE', actors: ['SYSTEM'], label: 'Cured: back to active', implemented: true, guards: ['arrearsCleared'] }),
  t({ from: 'ACTIVE', to: 'RESTRUCTURED', actors: ['STAFF'], permission: 'loan:restructure', label: 'Restructure loan', implemented: true, requiresReason: true, guards: ['makerChecker:RESTRUCTURE'] }),
  t({ from: 'Unpaid', to: 'RESTRUCTURED', actors: ['STAFF'], permission: 'loan:restructure', label: 'Restructure loan', implemented: true, requiresReason: true, guards: ['makerChecker:RESTRUCTURE'] }),
  t({ from: 'RESTRUCTURED', to: 'ACTIVE', actors: ['SYSTEM'], label: 'Restructured loan resumes', implemented: true, guards: ['ledgerBooked'] }),
  t({ from: 'ACTIVE', to: 'CLOSED', actors: ['SYSTEM', 'STAFF'], permission: 'loan:create', label: 'Close loan (fully repaid)', implemented: true, guards: ['zeroBalance'] }),
  t({ from: 'Unpaid', to: 'CLOSED', actors: ['SYSTEM', 'STAFF'], permission: 'loan:create', label: 'Close loan (settled)', implemented: true, guards: ['zeroBalance'] }),
  t({ from: 'RESTRUCTURED', to: 'CLOSED', actors: ['SYSTEM', 'STAFF'], permission: 'loan:create', label: 'Close loan (fully repaid)', implemented: true, guards: ['zeroBalance'] }),
  t({ from: 'Unpaid', to: 'WRITTEN_OFF', actors: ['STAFF'], permission: 'loan:writeoff', label: 'Write off loan', implemented: true, requiresReason: true, guards: ['makerChecker:WRITE_OFF'] }),
];

export const stateByKey = (k: ApplicationStatus): StateDef => STATES.find((s) => s.key === k)!;
export const isTerminal = (k: ApplicationStatus): boolean => stateByKey(k).terminal;
export const transitionsFrom = (from: ApplicationStatus): TransitionDef[] => TRANSITIONS.filter((x) => x.from === from);
export const findTransition = (from: ApplicationStatus, to: ApplicationStatus, actor: Actor): TransitionDef | undefined =>
  TRANSITIONS.find((x) => x.from === from && x.to === to && x.actors.includes(actor));

/** Legal for this actor (implemented or not). */
export function canTransition(from: ApplicationStatus, to: ApplicationStatus, actor: Actor): boolean {
  return !!findTransition(from, to, actor);
}

/**
 * Resolve a requested transition or throw: 409 ILLEGAL_TRANSITION (not in the table for this actor / terminal state),
 * 501 NOT_IMPLEMENTED (defined, arrives later). Reason is validated here too (400 REASON_REQUIRED).
 */
export function resolveTransition(from: ApplicationStatus, to: ApplicationStatus, actor: Actor, reason?: string | null): TransitionDef {
  const def = findTransition(from, to, actor);
  if (!def) {
    const why = isTerminal(from) ? `${stateByKey(from).label} is a final state` : `${actor.toLowerCase()} cannot move an application from ${stateByKey(from).label} to ${stateByKey(to).label}`;
    throw new HttpException({ statusCode: 409, code: 'ILLEGAL_TRANSITION', message: `Illegal transition: ${why}`, from, to }, HttpStatus.CONFLICT);
  }
  if (!def.implemented) {
    throw new HttpException({ statusCode: 501, code: 'NOT_IMPLEMENTED', message: `${def.label} (${stateByKey(from).label} → ${stateByKey(to).label}) arrives in ${def.arrivesIn ?? 'a later prompt'}`, from, to }, HttpStatus.NOT_IMPLEMENTED);
  }
  if (def.requiresReason && !(reason ?? '').trim()) {
    throw new HttpException({ statusCode: 400, code: 'REASON_REQUIRED', message: 'A reason is required for this action' }, HttpStatus.BAD_REQUEST);
  }
  return def;
}

/** Staff transitions available from `from` to a user holding `permissions` (unimplemented ones are listed, flagged). */
export function allowedStaffTransitions(from: ApplicationStatus, permissions: ReadonlySet<string>): AllowedTransitionDto[] {
  return transitionsFrom(from)
    .filter((x) => x.actors.includes('STAFF') && (!x.permission || permissions.has(x.permission)))
    .map((x) => ({ to: x.to, label: x.label, requiresReason: x.requiresReason, permission: x.permission, implemented: x.implemented }));
}

export function stateMachineDto(): StateMachineDto {
  return {
    states: STATES.map((s) => ({ ...s })),
    transitions: TRANSITIONS.flatMap((x) => x.actors.map((actor) => ({
      from: x.from, to: x.to, actor, permission: actor === 'STAFF' ? x.permission : null, label: x.label, implemented: x.implemented,
    }))),
  };
}
