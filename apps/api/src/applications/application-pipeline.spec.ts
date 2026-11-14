import { ForbiddenException } from '@nestjs/common';
import type { EligibilityResultDto } from '@damez/shared';
import { ApplicationPipeline, MSG_WAIT_CONSENT } from './application-pipeline';
import { resolveTransition } from './state-machine';

/** Minimal in-memory stand-ins: the pipeline only touches these Prisma delegates and the transitions service. */
function setup(over: { tier?: number; hasBvn?: boolean; consent?: boolean; docs?: string[]; requiredDocs?: string[]; autoDecline?: boolean; status?: string; minKycTier?: number } = {}) {
  const state = {
    app: { id: 'a1', reference: 'APP-2026-000001', customerId: 'c1', productId: 'p1', status: over.status ?? 'SUBMITTED', statusReason: null as string | null, requestedAmountKobo: 5_000_000n, tenorMonths: 3, kycTierAtSubmission: null as number | null },
    product: { id: 'p1', minKycTier: over.minKycTier ?? 1, requiredDocs: over.requiredDocs ?? [] },
    customer: { id: 'c1', kycTier: over.tier ?? 1, bvnEnc: over.hasBvn === false ? null : 'enc' },
    consent: over.consent ?? true, docs: new Set(over.docs ?? []), autoDecline: over.autoDecline ?? true,
    events: [] as string[],
  };
  const prisma = {
    loanApplication: { findUnique: jest.fn(async () => ({ ...state.app, product: state.product })), update: jest.fn(async ({ data }: { data: { kycTierAtSubmission: number } }) => { state.app.kycTierAtSubmission = data.kycTierAtSubmission; }) },
    customer: { findUnique: jest.fn(async () => state.customer) },
    consent: { findFirst: jest.fn(async () => (state.consent ? { id: 'k' } : null)) },
    eligibilityAssessment: { updateMany: jest.fn(async () => ({ count: 1 })) },
    systemSetting: { findUnique: jest.fn(async () => ({ value: state.autoDecline })) },
  };
  const transitions = {
    apply: jest.fn(async (_id: string, to: string, actor: { type: 'SYSTEM' }, o: { statusReason?: string; reason?: string }) => {
      resolveTransition(state.app.status as never, to as never, actor.type, o.reason ?? o.statusReason ?? 'x');
      state.events.push(`${state.app.status}>${to}`);
      state.app.status = to; state.app.statusReason = o.statusReason ?? null;
    }),
    setStatusReason: jest.fn(async (_id: string, r: string) => { state.app.statusReason = r; }),
  };
  const result = (o: Partial<EligibilityResultDto>): EligibilityResultDto => ({ id: 'e1', outcome: 'ELIGIBLE', firedRules: [], reasons: [], score: 700, ...o } as EligibilityResultDto);
  const eligibility = { assess: jest.fn(async () => result({})) };
  const kyc = { refreshTier: jest.fn(async () => state.customer.kycTier), maxLoanKobo: jest.fn() };
  const documents = { satisfiedKinds: jest.fn(async () => state.docs), readContent: jest.fn(), listIds: jest.fn(), attachToApplication: jest.fn() };
  const pipeline = new ApplicationPipeline(prisma as never, transitions as never, eligibility as never, kyc as never, documents as never);
  return { state, pipeline, eligibility, transitions, prisma, result, kyc };
}

describe('ApplicationPipeline', () => {
  it('moves SUBMITTED to UNDER_REVIEW when everything is in place', async () => {
    const t = setup();
    const a = await t.pipeline.advance('a1');
    expect(a.status).toBe('UNDER_REVIEW');
    expect(t.state.events).toEqual(['SUBMITTED>BUREAU_CHECK', 'BUREAU_CHECK>UNDER_REVIEW']);
    expect(t.state.app.statusReason).toMatch(/Eligibility check passed/);
    expect(t.eligibility.assess).toHaveBeenCalledWith(expect.objectContaining({ applicationId: 'a1', noPull: false }));
    expect(t.prisma.eligibilityAssessment.updateMany).toHaveBeenCalled();
  });

  it('waits at BUREAU_CHECK for consent, then resumes when consent arrives', async () => {
    const t = setup({ consent: false });
    let a = await t.pipeline.advance('a1');
    expect(a.status).toBe('BUREAU_CHECK');
    expect(a.statusReason).toBe(MSG_WAIT_CONSENT);
    expect(t.eligibility.assess).not.toHaveBeenCalled();
    t.state.consent = true;
    a = await t.pipeline.advance('a1');
    expect(a.status).toBe('UNDER_REVIEW');
  });

  it('treats a CONSENT_REQUIRED from the engine as waiting', async () => {
    const t = setup();
    t.eligibility.assess.mockRejectedValueOnce(new ForbiddenException({ code: 'CONSENT_REQUIRED', purpose: 'BUREAU_PULL' }));
    const a = await t.pipeline.advance('a1');
    expect(a.status).toBe('BUREAU_CHECK');
    expect(a.statusReason).toBe(MSG_WAIT_CONSENT);
  });

  it('goes to KYC_PENDING when the tier is too low, and resumes after the tier rises', async () => {
    const t = setup({ tier: 1, minKycTier: 2 });
    let a = await t.pipeline.advance('a1');
    expect(a.status).toBe('KYC_PENDING');
    expect(a.statusReason).toMatch(/Tier 2/);
    expect(t.eligibility.assess).not.toHaveBeenCalled();
    a = await t.pipeline.advance('a1'); // idempotent while still waiting
    expect(a.status).toBe('KYC_PENDING');
    expect(t.state.events).toEqual(['SUBMITTED>KYC_PENDING']);
    t.state.customer.kycTier = 2;
    a = await t.pipeline.advance('a1');
    expect(a.status).toBe('UNDER_REVIEW');
    expect(t.state.events).toEqual(['SUBMITTED>KYC_PENDING', 'KYC_PENDING>BUREAU_CHECK', 'BUREAU_CHECK>UNDER_REVIEW']);
  });

  it('keeps SUBMITTED with an explanation while required documents are missing', async () => {
    const t = setup({ requiredDocs: ['PAYSLIP', 'ID_CARD'], docs: ['ID_CARD'] });
    let a = await t.pipeline.advance('a1');
    expect(a.status).toBe('SUBMITTED');
    expect(a.statusReason).toMatch(/Latest payslip/);
    expect(a.statusReason).not.toMatch(/Government ID/);
    t.state.docs.add('PAYSLIP');
    a = await t.pipeline.advance('a1');
    expect(a.status).toBe('UNDER_REVIEW');
  });

  it('missing BVN keeps the customer in KYC_PENDING', async () => {
    const t = setup({ hasBvn: false });
    const a = await t.pipeline.advance('a1');
    expect(a.status).toBe('KYC_PENDING');
    expect(a.statusReason).toMatch(/BVN/);
  });

  it('auto-declines INELIGIBLE + DECLINE rule with the top customer reason', async () => {
    const t = setup();
    t.eligibility.assess.mockResolvedValueOnce(t.result({
      outcome: 'INELIGIBLE', firedRules: [{ code: 'WRITE_OFF_24M', action: 'DECLINE' }],
      reasons: [{ code: 'X', severity: 'WARNING', customerMessage: 'w', officerMessage: '' }, { code: 'WRITE_OFF_24M', severity: 'BLOCKER', customerMessage: 'A recent write-off on your credit record', officerMessage: '' }],
    }));
    const a = await t.pipeline.advance('a1');
    expect(a.status).toBe('REJECTED');
    expect(a.statusReason).toBe('A recent write-off on your credit record');
  });

  it('does not auto-decline when the setting is off, or when ineligible without a DECLINE rule', async () => {
    const off = setup({ autoDecline: false });
    off.eligibility.assess.mockResolvedValueOnce(off.result({ outcome: 'INELIGIBLE', firedRules: [{ code: 'R', action: 'DECLINE' }] }));
    expect((await off.pipeline.advance('a1')).status).toBe('UNDER_REVIEW');
    const soft = setup();
    soft.eligibility.assess.mockResolvedValueOnce(soft.result({ outcome: 'INELIGIBLE', firedRules: [] }));
    const a = await soft.pipeline.advance('a1');
    expect(a.status).toBe('UNDER_REVIEW');
    expect(a.statusReason).toMatch(/concerns/);
  });

  it('refers and conditional outcomes go to UNDER_REVIEW with a descriptive reason', async () => {
    const r = setup();
    r.eligibility.assess.mockResolvedValueOnce(r.result({ outcome: 'CONDITIONAL', firedRules: [{ code: 'BIG', action: 'REFER' }] }));
    const a = await r.pipeline.advance('a1');
    expect(a.status).toBe('UNDER_REVIEW');
    expect(a.statusReason).toMatch(/Referred/);
    const c = setup();
    c.eligibility.assess.mockResolvedValueOnce(c.result({ outcome: 'CONDITIONAL' }));
    expect((await c.pipeline.advance('a1')).statusReason).toMatch(/conditions/);
  });

  it('is idempotent: advancing a settled application changes nothing', async () => {
    const t = setup();
    await t.pipeline.advance('a1');
    const calls = t.eligibility.assess.mock.calls.length;
    const events = [...t.state.events];
    const a = await t.pipeline.advance('a1');
    expect(a.status).toBe('UNDER_REVIEW');
    expect(t.eligibility.assess.mock.calls.length).toBe(calls);
    expect(t.state.events).toEqual(events);
    for (const s of ['DRAFT', 'REJECTED', 'CANCELLED', 'APPROVED']) {
      const x = setup({ status: s });
      expect((await x.pipeline.advance('a1')).status).toBe(s);
      expect(x.transitions.apply).not.toHaveBeenCalled();
    }
  });

  it('serialises concurrent advances (one bureau assessment)', async () => {
    const t = setup();
    await Promise.all([t.pipeline.advance('a1'), t.pipeline.advance('a1'), t.pipeline.advance('a1')]);
    expect(t.eligibility.assess).toHaveBeenCalledTimes(1);
    expect(t.state.app.status).toBe('UNDER_REVIEW');
  });

  it('survives an engine failure by waiting with a reason (never stuck silently)', async () => {
    const t = setup();
    t.eligibility.assess.mockRejectedValueOnce(new Error('bureau down'));
    const a = await t.pipeline.advance('a1');
    expect(a.status).toBe('BUREAU_CHECK');
    expect(a.statusReason).toMatch(/retry/);
  });

  it('reassess refreshes the assessment but never changes status', async () => {
    const t = setup({ status: 'UNDER_REVIEW' });
    t.eligibility.assess.mockResolvedValueOnce(t.result({ outcome: 'INELIGIBLE', firedRules: [{ code: 'R', action: 'DECLINE' }] }));
    const r = await t.pipeline.reassess('a1', 'staff1');
    expect(r.outcome).toBe('INELIGIBLE');
    expect(t.transitions.apply).not.toHaveBeenCalled();
    expect(t.state.app.status).toBe('UNDER_REVIEW');
  });
});
