import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcceptOfferDto, LoanOfferDto } from '@damez/shared';
import { PortalApiError, pGet, pPost } from './portal-api';

/**
 * Typed wrappers for offer review + e-signature/OTP acceptance (`PortalOffersController`).
 * Mirrors `lib/portal-api.ts`'s conventions exactly (same fetch client, same error handling).
 */

export const OFFER_KEYS = {
  forApplication: (applicationId: string) => ['portal', 'applications', applicationId, 'offer'] as const,
};

/** Latest non-withdrawn offer for an application; null when none exists yet. 404 is also treated as "no offer". */
export const useOfferForApplication = (applicationId: string) =>
  useQuery({
    queryKey: OFFER_KEYS.forApplication(applicationId),
    queryFn: async () => {
      try {
        return await pGet<LoanOfferDto | null>(`/applications/${applicationId}/offer`);
      } catch (e) {
        if (e instanceof PortalApiError && e.statusCode === 404) return null;
        throw e;
      }
    },
  });

export function useInvalidateOffer(applicationId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: OFFER_KEYS.forApplication(applicationId) });
}

/** Downloadable offer letter URL; left to an <a>/Link so the browser handles cookies + the GET. */
export const offerLetterUrl = (offerId: string) => `/api/v1/portal/offers/${offerId}/letter.pdf`;

/**
 * `OffersService.requestAcceptanceOtp` returns this narrower shape (no `challengeId`/`resendAfterSeconds`):
 * the accept call itself just carries the code, so there is nothing to track between request and accept.
 */
export interface OfferOtpResponse { expiresInSeconds: number; destination: string; demoCode?: string }

export const requestOfferOtp = (offerId: string) => pPost<OfferOtpResponse>(`/offers/${offerId}/request-otp`);

export const acceptOffer = (offerId: string, body: AcceptOfferDto) => pPost<LoanOfferDto>(`/offers/${offerId}/accept`, body);

export const declineOffer = (offerId: string, reason?: string) => pPost<LoanOfferDto>(`/offers/${offerId}/decline`, { reason });
