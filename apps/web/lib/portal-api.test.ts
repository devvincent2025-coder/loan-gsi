import { getDeviceFingerprint, portalApi, PortalApiError, portalAuthHandlers, resetFingerprintCache, portalErrorMessage } from './portal-api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const headersOf = (f: ReturnType<typeof mockFetch>) => (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

describe('portal api client', () => {
  beforeEach(() => {
    document.cookie = 'ccsrf=csrf-abc';
    resetFingerprintCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.cookie = 'ccsrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.localStorage.clear();
  });

  it('targets /api/v1/portal, includes credentials, csrf and fingerprint on mutations', async () => {
    const f = mockFetch(200, { ok: true });
    await portalApi('/profile', { method: 'PUT', body: { a: 1 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/portal/profile');
    expect(init.credentials).toBe('include');
    const h = headersOf(f);
    expect(h['x-csrf-token']).toBe('csrf-abc');
    expect(h['x-device-fingerprint']).toMatch(/^[0-9a-f]{32,}$/);
    expect(h['x-background-poll']).toBeUndefined();
  });

  it('omits csrf on GET but still sends the fingerprint; background polls are flagged', async () => {
    const f = mockFetch(200, {});
    await portalApi('/me', { background: true });
    const h = headersOf(f);
    expect(h['x-csrf-token']).toBeUndefined();
    expect(h['x-device-fingerprint']).toBeTruthy();
    expect(h['x-background-poll']).toBe('1');
  });

  it('fingerprint is stable across calls and persisted id survives cache resets', async () => {
    const a = await getDeviceFingerprint();
    expect(await getDeviceFingerprint()).toBe(a);
    resetFingerprintCache();
    expect(await getDeviceFingerprint()).toBe(a);
  });

  it('redirects on 401 except for /auth/*', async () => {
    const spy = vi.spyOn(portalAuthHandlers, 'onUnauthorized').mockImplementation(() => undefined);
    mockFetch(401, { statusCode: 401, message: 'no', code: 'SESSION_EXPIRED' });
    await expect(portalApi('/me')).rejects.toBeInstanceOf(PortalApiError);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(portalApi('/auth/verify-otp', { method: 'POST', body: {} })).rejects.toBeInstanceOf(PortalApiError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('surfaces code, field errors and extra body fields', async () => {
    mockFetch(403, { statusCode: 403, message: 'Consent needed', code: 'CONSENT_REQUIRED', purpose: 'BUREAU_PULL' });
    const err = (await portalApi('/eligibility/preview', { method: 'POST', body: {} }).catch((e: unknown) => e)) as PortalApiError;
    expect(err.code).toBe('CONSENT_REQUIRED');
    expect(err.body.purpose).toBe('BUREAU_PULL');
    mockFetch(400, { statusCode: 400, message: 'Validation failed', code: 'VALIDATION_FAILED', errors: { bvn: ['Must be 11 digits'] } });
    const v = (await portalApi('/kyc/bvn', { method: 'POST', body: {} }).catch((e: unknown) => e)) as PortalApiError;
    expect(v.errors).toEqual({ bvn: ['Must be 11 digits'] });
    expect(portalErrorMessage(v)).toContain('Must be 11 digits');
  });

  it('maps DUPLICATE_BVN to a support message', async () => {
    mockFetch(409, { statusCode: 409, message: 'dup', code: 'DUPLICATE_BVN' });
    const err = (await portalApi('/kyc/bvn', { method: 'POST', body: {} }).catch((e: unknown) => e)) as PortalApiError;
    expect(err.statusCode).toBe(409);
    expect(portalErrorMessage(err)).toMatch(/contact support/i);
  });
});
