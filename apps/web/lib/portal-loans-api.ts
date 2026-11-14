import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EligibilityResultDto, LoanDetailDto, LoanDto, LoanInstallmentDto, RepaymentDto } from '@damez/shared';
import { pGet, pPost } from './portal-api';

/**
 * Typed wrappers for the prompt-3 "booked loans" portal surface (`Loan` model, not `LoanApplication`).
 * Mirrors `lib/portal-api.ts`'s conventions exactly (same fetch client, same error handling).
 */

export const LOAN_KEYS = {
  loans: ['portal', 'loans'] as const,
  loan: (id: string) => ['portal', 'loans', id] as const,
  calendar: (id: string) => ['portal', 'loans', id, 'calendar'] as const,
  repeatBorrowing: (productId: string, amountKobo: number, tenorMonths: number) =>
    ['portal', 'eligibility', 'repeat-borrowing', productId, amountKobo, tenorMonths] as const,
};

export const useLoans = () => useQuery({ queryKey: LOAN_KEYS.loans, queryFn: () => pGet<LoanDto[]>('/loans') });

export const useLoan = (id: string) => useQuery({ queryKey: LOAN_KEYS.loan(id), queryFn: () => pGet<LoanDetailDto>(`/loans/${id}`) });

export const useRepaymentCalendar = (id: string) =>
  useQuery({ queryKey: LOAN_KEYS.calendar(id), queryFn: () => pGet<LoanInstallmentDto[]>(`/loans/${id}/repayment-calendar`) });

/** Pure eligibility feedback for repeat borrowing (`noPull: true` server-side; safe to call speculatively). */
export const useRepeatBorrowingEligibility = (args: { productId: string; amountKobo: number; tenorMonths: number } | null) =>
  useQuery({
    queryKey: args ? LOAN_KEYS.repeatBorrowing(args.productId, args.amountKobo, args.tenorMonths) : ['portal', 'eligibility', 'repeat-borrowing', 'disabled'],
    queryFn: () => pGet<EligibilityResultDto>('/eligibility/repeat-borrowing', args ?? undefined),
    enabled: !!args,
    staleTime: 60_000,
    retry: false,
  });

export function useInvalidateLoan(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: LOAN_KEYS.loan(id) });
    void qc.invalidateQueries({ queryKey: LOAN_KEYS.loans });
    void qc.invalidateQueries({ queryKey: LOAN_KEYS.calendar(id) });
  };
}

/**
 * Portal repay body: the server (`PortalLoanServicingController.repay`) only accepts `{amountKobo, kind}` and
 * always forces `method: 'MANUAL'` server-side (see controller docblock) — narrower than the staff-side
 * `MakeRepaymentDto` (which also takes `method`/`reference`/`TOPUP_NET`).
 */
export interface PortalRepayRequest { amountKobo: number; kind: 'EARLY' | 'PART' }

export const repayLoan = (loanId: string, body: PortalRepayRequest) => pPost<RepaymentDto>(`/loans/${loanId}/repay`, body);

/** Downloadable statement URL; let the browser/anchor handle cookies + the GET. */
export const loanStatementUrl = (loanId: string, from?: string, to?: string) => {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const s = qs.toString();
  return `/api/v1/portal/loans/${loanId}/statement.pdf${s ? `?${s}` : ''}`;
};
