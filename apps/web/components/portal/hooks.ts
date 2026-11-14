'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KycVerificationDto, OnboardingState, PortalApplicationDto, PortalConsentsDto, PortalProductDto, DocumentDto,
} from '@damez/shared';
import { pGet, pPoll } from '@/lib/portal-api';
import { PORTAL_ME_KEY } from '@/lib/portal-auth';

export const KEYS = {
  onboarding: ['portal', 'onboarding'] as const,
  applications: ['portal', 'applications'] as const,
  application: (id: string) => ['portal', 'applications', id] as const,
  products: ['portal', 'products'] as const,
  documents: ['portal', 'documents'] as const,
  consents: ['portal', 'consents'] as const,
  verifications: ['portal', 'verifications'] as const,
};

export const useOnboarding = () => useQuery({ queryKey: KEYS.onboarding, queryFn: () => pGet<OnboardingState>('/onboarding') });
export const useApplications = () => useQuery({ queryKey: KEYS.applications, queryFn: () => pGet<PortalApplicationDto[]>('/applications') });
export const useProducts = () => useQuery({ queryKey: KEYS.products, queryFn: () => pGet<PortalProductDto[]>('/products') });
export const useDocuments = () => useQuery({ queryKey: KEYS.documents, queryFn: () => pGet<DocumentDto[]>('/documents') });
export const useConsents = () => useQuery({ queryKey: KEYS.consents, queryFn: () => pGet<PortalConsentsDto>('/consents') });
export const useVerifications = () => useQuery({ queryKey: KEYS.verifications, queryFn: () => pGet<KycVerificationDto[]>('/kyc/verifications') });

/** Statuses where the pipeline is still running server-side: poll every 5s (background polls never extend the session). */
export const TRANSITIONAL = ['SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK'] as const;

export function useApplication(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: KEYS.application(id),
    queryFn: () => {
      // refetches while the pipeline runs are background polls
      const cached = qc.getQueryData<PortalApplicationDto>(KEYS.application(id));
      const polling = cached && (TRANSITIONAL as readonly string[]).includes(cached.status);
      return polling ? pPoll<PortalApplicationDto>(`/applications/${id}`) : pGet<PortalApplicationDto>(`/applications/${id}`);
    },
    refetchInterval: (q) => (q.state.data && (TRANSITIONAL as readonly string[]).includes(q.state.data.status) ? 5000 : false),
  });
}

/** Refresh everything that depends on KYC / onboarding progress. */
export function useInvalidateOnboarding() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: KEYS.onboarding });
    void qc.invalidateQueries({ queryKey: PORTAL_ME_KEY });
    void qc.invalidateQueries({ queryKey: KEYS.verifications });
    void qc.invalidateQueries({ queryKey: KEYS.products });
  };
}
