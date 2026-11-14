import { DojahScreeningProvider, ScreeningNotConfiguredError, ScreeningProviderError } from './screening.module';

const env = (overrides: Partial<{ DOJAH_BASE_URL: string; DOJAH_APP_ID?: string; DOJAH_SECRET_KEY?: string }> = {}) =>
  ({ DOJAH_BASE_URL: 'https://sandbox.dojah.io', DOJAH_APP_ID: 'app1', DOJAH_SECRET_KEY: 'secret1', ...overrides } as never);

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body } as Response;
}

describe('DojahScreeningProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('throws ScreeningNotConfiguredError when credentials are missing', async () => {
    const p = new DojahScreeningProvider(env({ DOJAH_SECRET_KEY: undefined }));
    await expect(p.screen({ firstName: 'Ada', lastName: 'Obi' })).rejects.toBeInstanceOf(ScreeningNotConfiguredError);
  });

  it('clears when there are no matches', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ entity: { entity_id: 'e1', match_status: 'No Match', results: [] } }));
    const p = new DojahScreeningProvider(env());
    const r = await p.screen({ firstName: 'Ada', lastName: 'Obi' });
    expect(r).toEqual([
      { type: 'SANCTIONS', status: 'CLEAR', matchCount: 0, reference: 'e1', details: { lists: [] } },
      { type: 'PEP', status: 'CLEAR', matchCount: 0, reference: 'e1', details: { lists: [] } },
    ]);
  });

  it('matches a confirmed sanctions hit and leaves PEP clear', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      entity: { entity_id: 'e2', match_status: 'Confirmed Match', results: [{ source_type: 'Sanctions', match: true }] },
    }));
    const p = new DojahScreeningProvider(env());
    const r = await p.screen({ firstName: 'Baba', lastName: 'Blacklisted' });
    expect(r.find((x) => x.type === 'SANCTIONS')).toMatchObject({ status: 'MATCH', matchCount: 1 });
    expect(r.find((x) => x.type === 'PEP')).toMatchObject({ status: 'CLEAR', matchCount: 0 });
  });

  it('reviews a PEP result when the overall match is only partial/potential', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      entity: { entity_id: 'e3', match_status: 'Potential Match', results: [{ source_type: 'PEP', match: false }] },
    }));
    const p = new DojahScreeningProvider(env());
    const r = await p.screen({ firstName: 'Senator', lastName: 'Testperson' });
    expect(r.find((x) => x.type === 'PEP')).toMatchObject({ status: 'REVIEW', matchCount: 0 });
  });

  it('wraps transport/5xx failures in ScreeningProviderError', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 503));
    const p = new DojahScreeningProvider(env());
    await expect(p.screen({ firstName: 'Ada', lastName: 'Obi' })).rejects.toBeInstanceOf(ScreeningProviderError);
  });
});
