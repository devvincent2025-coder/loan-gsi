import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMandateDto, LinkAccountDto, LinkedAccountDto, MandateDto, OtpChallengeResponse } from '@damez/shared';
import { pDel, pGet, pPost } from './portal-api';

/**
 * Typed wrappers for linked-account + mandate + GSI-consent setup (`PortalAutodebitController`).
 * Mirrors `lib/portal-api.ts`'s conventions exactly (same fetch client, same error handling).
 */

export const AUTODEBIT_KEYS = {
  linkedAccounts: ['portal', 'linked-accounts'] as const,
  mandates: ['portal', 'mandates'] as const,
};

export const useLinkedAccounts = () => useQuery({ queryKey: AUTODEBIT_KEYS.linkedAccounts, queryFn: () => pGet<LinkedAccountDto[]>('/linked-accounts') });
export const useMandates = () => useQuery({ queryKey: AUTODEBIT_KEYS.mandates, queryFn: () => pGet<MandateDto[]>('/mandates') });

export function useInvalidateAutodebit() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: AUTODEBIT_KEYS.linkedAccounts });
    void qc.invalidateQueries({ queryKey: AUTODEBIT_KEYS.mandates });
  };
}

export const linkAccount = (body: LinkAccountDto) => pPost<LinkedAccountDto>('/linked-accounts', body);
export const removeLinkedAccount = (id: string) => pDel<{ removed: boolean }>(`/linked-accounts/${id}`);

export const createMandate = (body: CreateMandateDto) => pPost<MandateDto>('/mandates', body);

export const requestGsiConsentOtp = () => pPost<OtpChallengeResponse>('/gsi-consent/otp');

/**
 * `gsiConsentSchema` on the server also accepts an optional `challengeId` (falls back to the customer's latest
 * unconsumed GSI_CONSENT challenge when omitted) even though the published `GsiConsentDto` only lists
 * `{acknowledged, otpCode}`; we pass it through when we have it, for robustness against concurrent requests.
 */
export interface GsiConsentRequest { acknowledged: boolean; otpCode: string; challengeId?: string }

export const grantGsiConsent = (body: GsiConsentRequest) => pPost<{ granted: boolean }>('/gsi-consent', body);
