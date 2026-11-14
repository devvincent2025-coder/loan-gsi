import { canonical, computeHash, GENESIS_HASH } from './audit-chain';

describe('audit chain', () => {
  it('canonical JSON is key-order independent', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it('hash changes when any field is altered', () => {
    const base = { seq: 1n, createdAt: new Date('2026-01-01T00:00:00Z'), actorId: 'u1', action: 'x', resourceType: 'R', resourceId: '1', before: { a: 1 }, after: { a: 2 }, outcome: 'SUCCESS', ip: '1.1.1.1', prevHash: GENESIS_HASH };
    const h = computeHash(base);
    expect(computeHash({ ...base })).toBe(h);
    expect(computeHash({ ...base, after: { a: 3 } })).not.toBe(h);
    expect(computeHash({ ...base, prevHash: 'f'.repeat(64) })).not.toBe(h);
  });
});
