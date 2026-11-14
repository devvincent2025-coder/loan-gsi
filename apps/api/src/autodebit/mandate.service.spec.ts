import { MandateService, pseudoPercent } from './mandate.service';

const mockEnv = { NIBSS_EMANDATE_PROVIDER: 'mock' as const };

function svc(): MandateService {
  return new MandateService({} as never, {} as never, {} as never, {} as never, mockEnv as never);
}

describe('pseudoPercent', () => {
  it('is deterministic for the same seed', () => {
    expect(pseudoPercent('debit:loan1:inst1:DUE_AM')).toBe(pseudoPercent('debit:loan1:inst1:DUE_AM'));
  });
  it('differs across seeds (not a constant)', () => {
    const values = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => pseudoPercent(s)));
    expect(values.size).toBeGreaterThan(1);
  });
  it('always within [0, 100)', () => {
    for (const s of ['x', 'y', 'z', 'debit:1:2:3']) {
      const p = pseudoPercent(s);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(100);
    }
  });
});

describe('MandateService.debit (mock)', () => {
  it('is deterministic: the same idempotency key always produces the same outcome', async () => {
    const s = svc();
    const a = await s.debit({ providerRef: 'NIBSS-MOCK-x', amountKobo: 5000, idempotencyKey: 'debit:loanA:instB:DUE_AM' });
    const b = await s.debit({ providerRef: 'NIBSS-MOCK-x', amountKobo: 5000, idempotencyKey: 'debit:loanA:instB:DUE_AM' });
    expect(a).toEqual(b);
  });

  it('collects the full amount on SUCCESS and nothing (or a partial amount) otherwise', async () => {
    const s = svc();
    const outcomes = await Promise.all(
      Array.from({ length: 50 }, (_, i) => s.debit({ providerRef: 'ref', amountKobo: 10_000, idempotencyKey: `key-${i}` })),
    );
    for (const o of outcomes) {
      if (o.status === 'SUCCESS') expect(o.collectedKobo).toBe(10_000);
      else if (o.status === 'PARTIAL') expect(o.collectedKobo).toBeGreaterThan(0);
      else expect(o.collectedKobo).toBe(0);
    }
    // roughly 90% success given the documented mock split, over a reasonably sized sample
    const successes = outcomes.filter((o) => o.status === 'SUCCESS').length;
    expect(successes).toBeGreaterThan(30);
  });
});

describe('MandateService.createNibssEmandate / tokenizeCard (mock)', () => {
  it('e-mandate registration is always ACTIVE in mock mode, with a stable providerRef for the same inputs', async () => {
    const s = svc();
    const r1 = await s.createNibssEmandate({ accountNumber: '0123456789', bankCode: '058', bvn: '12345678901' });
    const r2 = await s.createNibssEmandate({ accountNumber: '0123456789', bankCode: '058', bvn: '12345678901' });
    expect(r1.status).toBe('ACTIVE');
    expect(r1.providerRef).toBe(r2.providerRef);
  });

  it('card tokenization returns a fake last4/bin deterministically', async () => {
    const s = svc();
    const r = await s.tokenizeCard({ authorizationRef: 'AUTH-123' });
    expect(r.status).toBe('ACTIVE');
    expect(r.cardLast4).toHaveLength(4);
    expect(r.cardBin).toHaveLength(6);
  });
});
