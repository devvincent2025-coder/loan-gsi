import { toast } from 'sonner';
import type { ApiError } from '@damez/shared';

export const API_BASE = '/api/v1';

export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly errors?: Record<string, string[]>;
  constructor(body: Partial<ApiError> & { statusCode: number }) {
    super(Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? `Request failed (${body.statusCode})`));
    this.name = 'ApiClientError';
    this.statusCode = body.statusCode;
    this.code = body.code;
    this.errors = body.errors;
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(q?: Query): string {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const authHandlers = {
  onUnauthorized: () => {
    if (typeof window === 'undefined') return;
    const here = window.location.pathname + window.location.search;
    if (window.location.pathname.startsWith('/login')) return;
    window.location.assign(`/login?next=${encodeURIComponent(here)}`);
  },
  onForbidden: (message: string) => {
    toast.error(message || 'You do not have permission to do that.');
  },
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** do not toast on 403 */
  silent?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, {
    method,
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const body = (data ?? {}) as Partial<ApiError>;
    const err = new ApiClientError({ ...body, statusCode: res.status, message: body.message as string });
    if (res.status === 401 && !path.startsWith('/auth/')) authHandlers.onUnauthorized();
    if (res.status === 403 && !opts.silent) authHandlers.onForbidden(err.message);
    throw err;
  }
  return data as T;
}

export const get = <T,>(path: string, query?: Query, signal?: AbortSignal) => api<T>(path, { query, signal });
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) {
    const first = e.errors ? Object.values(e.errors)[0]?.[0] : undefined;
    return first ? `${e.message}: ${first}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
