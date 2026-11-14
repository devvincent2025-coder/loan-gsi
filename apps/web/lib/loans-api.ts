import type {
  ApprovalDto,
  DebitAttemptDto,
  LoanDetailDto,
  LoanDto,
  LoanStatus,
  MakeRepaymentDto,
  Page,
  RepaymentDto,
  RestructureRequestDto,
} from '@damez/shared';
import { API_BASE, get, post } from './api';

export interface LoanListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: LoanStatus | '';
  branchId?: string;
  customerId?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export const listLoans = (query: LoanListQuery) => get<Page<LoanDto>>('/loans', query);
export const getLoan = (id: string) => get<LoanDetailDto>(`/loans/${id}`);

export const makeRepayment = (id: string, body: MakeRepaymentDto) => post<RepaymentDto>(`/loans/${id}/repayments`, body);
export const requestRestructure = (id: string, body: RestructureRequestDto) => post<ApprovalDto>(`/loans/${id}/restructure`, body);
export const requestWriteOff = (id: string, reason: string) => post<ApprovalDto>(`/loans/${id}/writeoff`, { reason });
export const recordRecovery = (id: string, body: { amountKobo: number; method: 'MANUAL' | 'CASH' | 'TRANSFER' }) =>
  post<RepaymentDto>(`/loans/${id}/recovery`, body);

export const listDebitAttempts = (id: string) => get<DebitAttemptDto[]>(`/loans/${id}/debit-attempts`);

/** Opens inline/downloads in a new tab; the API audits every fetch and streams the PDF with cookies via credentials: include navigation. */
export const loanStatementUrl = (id: string) => `${API_BASE}/loans/${id}/statement.pdf`;
export const repaymentReceiptUrl = (id: string) => `${API_BASE}/repayments/${id}/receipt.pdf`;
