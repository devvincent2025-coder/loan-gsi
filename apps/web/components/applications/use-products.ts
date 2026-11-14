'use client';
import { useQuery } from '@tanstack/react-query';
import type { LoanProductDto } from '@damez/shared';
import { ApiClientError, api } from '@/lib/api';

/** Loan products for pickers/filters. Prefers GET /products; falls back to /settings/products for roles without product:read. */
export function useProductOptions() {
  return useQuery({
    queryKey: ['products', 'options'],
    queryFn: async (): Promise<LoanProductDto[]> => {
      try {
        return await api<LoanProductDto[]>('/products', { silent: true });
      } catch (e) {
        if (e instanceof ApiClientError && (e.statusCode === 403 || e.statusCode === 404)) return api<LoanProductDto[]>('/settings/products', { silent: true });
        throw e;
      }
    },
    staleTime: 60_000,
  });
}
