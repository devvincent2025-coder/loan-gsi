import { BureauAggregator, withRetry } from './bureau-aggregator';
import { BureauNotConfiguredError, BureauProviderError, CreditBureauProvider, RawBureauResult } from './bureau.types';
import { BureauProviders } from './providers';

const NOW = new Date(Date.UTC(2026, 9, 9));
const hit = (notFound = false): RawBureauResult => ({
  bureau: 'INTERSWITCH', notFound, score: notFound ? null : 640, minScore: 300, maxScore: 850,
  facilities: notFound ? [] : [{
    lender: 'GTBank', productType: 'Personal loan', amountGrantedKobo: 50_000_00, outstandingKobo: 20_000_00, status: 'PERFORMING',
    tenorMonths: 12, monthlyPaymentKobo: 5_000_00, openedAt: NOW, closedAt: null, lastPaymentAt: null, legalAction: false,
    soldToCollections: false, isGuarantor: false, history: [], worstDpd: 0,
  }], enquiries: [], flags: [], thinFile: notFound,
});
class Flaky implements CreditBureauProvider {
  readonly bureau = 'INTERSWITCH' as const;
  calls = 0;
  constructor(private failures: number, private result: RawBureauResult = hit(), private retryable = true) {}
  async pull(): Promise<RawBureauResult> {
    this.calls++;
    if (this.calls <= this.failures) throw new BureauProviderError('upstream 503 for 08031234567', 'INTERSWITCH', this.retryable);
    return this.result;
  }
}
const req = { bvn: '22000000030', fullName: 'Ada Obi', phone: '08031234567', reference: 'r' };
const retry = { maxAttempts: 3, baseDelayMs: 100 };

function setup(provider: CreditBureauProvider) {
  const reg = new BureauProviders({} as never);
  reg.override(provider);
  const agg = new BureauAggregator(reg);
  const waits: number[] = [];
  agg.wait = async (ms) => { waits.push(ms); };
  return { agg, waits };
}

describe('withRetry', () => {
  it('backs off exponentially and reports attempts', async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok'; }, retry, async (ms) => { waits.push(ms); });
    expect(r).toEqual({ value: 'ok', attempts: 3 });
    expect(waits).toEqual([100, 200]);
  });
  it('gives up after maxAttempts', async () => {
    await expect(withRetry(async () => { throw new Error('boom'); }, retry, async () => undefined)).rejects.toMatchObject({ attempts: 3 });
  });
  it('does not retry non-retryable errors', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new BureauNotConfiguredError('INTERSWITCH', ['INTERSWITCH_CLIENT_ID']); }, retry, async () => undefined)).rejects.toMatchObject({ attempts: 1 });
    expect(n).toBe(1);
  });
});

describe('BureauAggregator (single bureau: Interswitch)', () => {
  it('queries the bureau and merges', async () => {
    const { agg } = setup(new Flaky(0));
    const { outcomes, merged } = await agg.query(req, 'c1', { bureaus: ['INTERSWITCH'], retry, now: NOW });
    expect(outcomes.map((o) => o.status)).toEqual(['SUCCESS']);
    expect(merged?.bureausQueried).toEqual(['INTERSWITCH']);
    expect(merged?.scores).toHaveLength(1);
  });
  it('retries a flaky pull then succeeds', async () => {
    const provider = new Flaky(2);
    const { agg, waits } = setup(provider);
    const { outcomes } = await agg.query(req, 'c1', { bureaus: ['INTERSWITCH'], retry, now: NOW });
    expect(outcomes[0]).toMatchObject({ status: 'SUCCESS', attempts: 3 });
    expect(provider.calls).toBe(3);
    expect(waits).toEqual([100, 200]);
  });
  it('reports a scrubbed error and merged=null after exhausting retries', async () => {
    const { agg } = setup(new Flaky(99));
    const { outcomes, merged } = await agg.query(req, 'c1', { bureaus: ['INTERSWITCH'], retry, now: NOW });
    const failed = outcomes[0];
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(3);
    expect(failed.error).not.toContain('08031234567');
    expect(merged).toBeNull();
  });
  it('NO_HIT / thin file when there is no record', async () => {
    const { agg } = setup(new Flaky(0, hit(true)));
    const { outcomes, merged } = await agg.query(req, 'c1', { bureaus: ['INTERSWITCH'], retry, now: NOW });
    expect(outcomes[0].status).toBe('NO_HIT');
    expect(merged?.summary.thinFile).toBe(true);
  });
});
