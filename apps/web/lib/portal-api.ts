import type { ApiError } from '@damez/shared';
import { buildQuery, readCookie } from './api';

/** Customer-portal fetch client. Same-origin `/api/v1/portal/*`, cookie `csid` (httpOnly) + `ccsrf` echoed as x-csrf-token. */
export const PORTAL_BASE = '/api/v1/portal';
const FP_KEY = 'damez.portal.device';

export class PortalApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly errors?: Record<string, string[]>;
  /** raw response body (e.g. `purpose` on CONSENT_REQUIRED) */
  readonly body: Record<string, unknown>;
  constructor(body: Partial<ApiError> & { statusCode: number } & Record<string, unknown>) {
    super(Array.isArray(body.message) ? (body.message as string[]).join(', ') : (body.message ?? `Request failed (${body.statusCode})`));
    this.name = 'PortalApiError';
    this.statusCode = body.statusCode;
    this.code = body.code;
    this.errors = body.errors;
    this.body = body;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** FNV-1a fallback when SubtleCrypto is unavailable (very old browsers / insecure contexts). */
function fnv(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(8);
}

let fingerprintPromise: Promise<string> | null = null;

/** Stable client-side device id: random uuid persisted in localStorage, hashed with UA/screen/timezone. Contains no PII. */
export function getDeviceFingerprint(): Promise<string> {
  if (fingerprintPromise) return fingerprintPromise;
  fingerprintPromise = (async () => {
    let id: string | null = null;
    try {
      id = window.localStorage.getItem(FP_KEY);
      if (!id) {
        id = crypto.randomUUID();
        window.localStorage.setItem(FP_KEY, id);
      }
    } catch {
      id = id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));
    }
    let tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* ignore */
    }
    const raw = [id, navigator.userAgent, `${screen.width}x${screen.height}x${screen.colorDepth}`, tz].join('|');
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return fnv(raw);
    }
  })();
  return fingerprintPromise;
}
/** test hook */
export function resetFingerprintCache() {
  fingerprintPromise = null;
}

export const portalAuthHandlers = {
  onUnauthorized: () => {
    if (typeof window === 'undefined') return;
    const p = window.location.pathname;
    if (p.startsWith('/portal/login') || p.startsWith('/portal/register')) return;
    const here = p + window.location.search;
    window.location.assign(`/portal/login?next=${encodeURIComponent(here)}`);
  },
};

export interface PortalRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** idle/background poll: must not keep the session alive */
  background?: boolean;
}

async function baseHeaders(method: string, background?: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json', 'x-device-fingerprint': await getDeviceFingerprint() };
  if (method !== 'GET') {
    const csrf = readCookie('ccsrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  if (background) headers['x-background-poll'] = '1';
  return headers;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function toError(path: string, status: number, data: unknown): PortalApiError {
  const body = (data ?? {}) as Partial<ApiError> & Record<string, unknown>;
  const err = new PortalApiError({ ...body, statusCode: status, message: body.message as string });
  // login/register/otp failures are expected 401s, not an expired session
  if (status === 401 && !path.startsWith('/auth/')) portalAuthHandlers.onUnauthorized();
  return err;
}

export async function portalApi<T = unknown>(path: string, opts: PortalRequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers = await baseHeaders(method, opts.background);
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${PORTAL_BASE}${path}${buildQuery(opts.query)}`, {
    method,
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const data = parseBody(await res.text());
  if (!res.ok) throw toError(path, res.status, data);
  return data as T;
}

export const pGet = <T,>(path: string, query?: Query, signal?: AbortSignal) => portalApi<T>(path, { query, signal });
export const pPoll = <T,>(path: string) => portalApi<T>(path, { background: true });
export const pPost = <T,>(path: string, body?: unknown) => portalApi<T>(path, { method: 'POST', body: body ?? {} });
export const pPut = <T,>(path: string, body?: unknown) => portalApi<T>(path, { method: 'PUT', body });
export const pDel = <T,>(path: string) => portalApi<T>(path, { method: 'DELETE' });

/** Multipart upload with progress (fetch cannot report upload progress, so XHR). */
export async function portalUpload<T = unknown>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  const headers = await baseHeaders('POST');
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PORTAL_BASE}${path}`);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new PortalApiError({ statusCode: 0, message: 'Network error. Check your connection and try again.' }));
    xhr.onload = () => {
      const data = parseBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(toError(path, xhr.status, data));
    };
    xhr.send(form);
  });
}

const FRIENDLY: Record<string, string> = {
  CONSENT_REQUIRED: 'We need your permission before we can continue.',
  DUPLICATE_BVN: 'This BVN is already linked to another Damez account. Please contact support so we can help you.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  NO_SESSION: 'Please sign in to continue.',
};

/** Customer-friendly message for any thrown value. */
export function portalErrorMessage(e: unknown): string {
  if (e instanceof PortalApiError) {
    if (e.code && FRIENDLY[e.code]) return FRIENDLY[e.code];
    const first = e.errors ? Object.values(e.errors)[0]?.[0] : undefined;
    return first ? `${e.message}: ${first}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

/** Flatten a VALIDATION_FAILED errors map to field -> first message. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof PortalApiError) || !e.errors) return {};
  return Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k.split('.').pop() ?? k, v[0] ?? '']));
}

export const isCode = (e: unknown, code: string): e is PortalApiError => e instanceof PortalApiError && e.code === code;
