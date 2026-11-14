/**
 * Phase 3 typed wrappers: underwriting queue/decisions/notes, offers, disbursement.
 * Follows the style of `lib/staff-api-extra.ts` — thin functions over `get`/`post` from `lib/api.ts`.
 */
import type {
  ApplicationDetailDto, ApplicationStatus, ApprovalDto, CreateOfferDto, DisbursementRequestDto, LoanOfferDto,
  UnderwritingDecisionDto, UnderwritingNoteDto, UnderwritingQueueItemDto,
} from '@damez/shared';
import { API_BASE, get, post } from './api';

/* ── underwriting queue & decisions ── */
export const getUnderwritingQueue = (params: { status?: ApplicationStatus | ''; branchId?: string; assignedToId?: string }) =>
  get<UnderwritingQueueItemDto[]>('/underwriting/queue', { status: params.status || undefined, branchId: params.branchId || undefined, assignedToId: params.assignedToId || undefined });

export const decideApplication = (applicationId: string, body: UnderwritingDecisionDto) =>
  post<ApplicationDetailDto>(`/applications/${applicationId}/decision`, body);

/* ── underwriting notes ── */
export const getApplicationNotes = (applicationId: string) => get<UnderwritingNoteDto[]>(`/applications/${applicationId}/notes`);
export const addApplicationNote = (applicationId: string, body: string) => post<UnderwritingNoteDto>(`/applications/${applicationId}/notes`, { body });

/* ── offers ── */
export const createOffer = (applicationId: string, body: Omit<CreateOfferDto, 'applicationId'>) =>
  post<LoanOfferDto>(`/applications/${applicationId}/offers`, body);
export const getOffers = (applicationId: string) => get<LoanOfferDto[]>(`/applications/${applicationId}/offers`);
export const sendOffer = (offerId: string) => post<LoanOfferDto>(`/offers/${offerId}/send`);

/** Streams the offer letter PDF; the API audits every download. */
export const offerLetterUrl = (offerId: string) => `${API_BASE}/offers/${offerId}/letter.pdf`;

/* ── disbursement ── */
export const disburse = (applicationId: string) => post<DisbursementRequestDto>(`/loans/applications/${applicationId}/disburse`);
export const disburseManual = (applicationId: string, reason: string) => post<ApprovalDto>(`/loans/applications/${applicationId}/disburse-manual`, { reason });
export const getDisbursement = (applicationId: string) => get<DisbursementRequestDto>(`/loans/applications/${applicationId}/disbursement`);
