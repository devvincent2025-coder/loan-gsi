import type {
  EclConfigDto,
  GlExportRowDto,
  JournalEntryDto,
  LedgerAccountDto,
  ProvisioningReportDto,
  SettlementReconciliationSummaryDto,
  TreasuryCashPositionDto,
} from '@damez/shared';
import { API_BASE, get, post, put } from './api';

/** GET /finance/treasury/cash-position */
export const getCashPosition = () => get<TreasuryCashPositionDto>('/finance/treasury/cash-position');

/** GET /finance/treasury/reconciliation-summary?period=yyyy-mm */
export const getReconciliationSummary = (period: string) =>
  get<SettlementReconciliationSummaryDto>('/finance/treasury/reconciliation-summary', { period });

/** GET /finance/ifrs9/provisioning-report?asOfDate=yyyy-mm-dd */
export const getProvisioningReport = (asOfDate: string) =>
  get<ProvisioningReportDto>('/finance/ifrs9/provisioning-report', { asOfDate });

/** GET /finance/ifrs9/config */
export const getEclConfig = () => get<EclConfigDto>('/finance/ifrs9/config');

/** PUT /finance/ifrs9/config */
export const updateEclConfig = (body: EclConfigDto) => put<EclConfigDto>('/finance/ifrs9/config', body);

/** GET /ledger/accounts */
export const getLedgerAccounts = () => get<LedgerAccountDto[]>('/ledger/accounts');

export interface JournalQuery {
  loanId?: string;
  from?: string;
  to?: string;
  [key: string]: string | undefined;
}

/** GET /ledger/journal?loanId=&from=&to= */
export const getJournal = (query: JournalQuery) => get<JournalEntryDto[]>('/ledger/journal', query);

export interface ManualPostingLine {
  accountCode: string;
  side: 'DEBIT' | 'CREDIT';
  amountKobo: number;
}

export interface ManualPostingDto {
  memo: string;
  date?: string;
  loanId?: string;
  postings: ManualPostingLine[];
}

/** POST /ledger/manual — balanced manual posting. */
export const postManualEntry = (body: ManualPostingDto) => post<JournalEntryDto>('/ledger/manual', body);

/** Builds the GL export download URL (CSV or JSON); use a plain <a href> for CSV. */
export function glExportUrl(query: { from: string; to: string; format: 'csv' | 'json' }): string {
  const sp = new URLSearchParams({ from: query.from, to: query.to, format: query.format });
  return `${API_BASE}/ledger/gl-export?${sp.toString()}`;
}

/** GET /ledger/gl-export?format=json — for the inline JSON preview table. */
export const getGlExportJson = (query: { from: string; to: string }) =>
  get<GlExportRowDto[]>('/ledger/gl-export', { ...query, format: 'json' });
