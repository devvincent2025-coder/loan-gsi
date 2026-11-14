import type { PiiRevealResponse } from '@damez/shared';
import { api, ApiClientError, API_BASE, post } from './api';

/** true when the API rejected with the given machine code (e.g. CONSENT_REQUIRED) */
export function hasApiCode(e: unknown, code: string): boolean {
  return e instanceof ApiClientError && e.code === code;
}
export const isNotImplemented = (e: unknown) => e instanceof ApiClientError && (e.statusCode === 501 || e.code === 'NOT_IMPLEMENTED');

/** POST that does NOT toast on 403 (callers render a tailored message, e.g. CONSENT_REQUIRED). */
export const postQuiet = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {}, silent: true });

/** Audited PII reveal for a customer field (reason is mandatory server-side). */
export async function revealCustomerField(id: string, field: 'bvn' | 'phone' | 'email' | 'nin' | 'accountNumber', reason: string): Promise<string> {
  return (await post<PiiRevealResponse>('/pii/reveal', { resource: 'customer', id, field, reason })).value;
}

/** Streams the decrypted document; the API audits every download. */
export const documentDownloadUrl = (id: string) => `${API_BASE}/documents/${id}/download`;

/** Naira-formatted percentage helpers for bps inputs. */
export const bpsToPct = (bps: number) => bps / 100;
export const pctToBps = (pct: number) => Math.round(pct * 100);
