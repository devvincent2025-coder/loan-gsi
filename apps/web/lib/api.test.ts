import { api, ApiClientError, authHandlers, buildQuery } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api client', () => {
  beforeEach(() => {
    document.cookie = 'csrf=tok123';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('sends x-csrf-token and credentials on mutating requests', async () => {
    const f = mockFetch(200, { ok: true });
    await api('/users', { method: 'POST', body: { a: 1 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/users');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok123');
    expect(init.credentials).toBe('include');
  });

  it('does not send the csrf header on GET', async () => {
    const f = mockFetch(200, {});
    await api('/users');
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('redirects on 401 except for /auth/*', async () => {
    const spy = vi.spyOn(authHandlers, 'onUnauthorized').mockImplementation(() => undefined);
    mockFetch(401, { statusCode: 401, message: 'no' });
    await expect(api('/users')).rejects.toBeInstanceOf(ApiClientError);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiClientError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('toasts via handler on 403 and exposes error fields', async () => {
    const spy = vi.spyOn(authHandlers, 'onForbidden').mockImplementation(() => undefined);
    mockFetch(403, { statusCode: 403, message: 'Forbidden', code: 'NO_PERM' });
    await expect(api('/roles')).rejects.toMatchObject({ statusCode: 403, code: 'NO_PERM' });
    expect(spy).toHaveBeenCalledWith('Forbidden');
  });

  it('builds query strings skipping empty values', () => {
    expect(buildQuery({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
  });
});
