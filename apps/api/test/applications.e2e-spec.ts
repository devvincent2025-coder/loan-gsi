/**
 * Applications e2e: portal flow + staff console + state machine + portfolio port.
 * Collaborating modules (eligibility, KYC tier, documents, fraud, bureau) are replaced by controllable fakes so the
 * suite does not depend on which other Phase-2 modules are wired yet. Only data created here is touched.
 */
import { Global, Module } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { ApplicationsModule } from '../src/applications/applications.module';
import { toEligibilityResultDto } from '../src/applications/mappers';
import { installBigIntJson } from '../src/common/bigint';
import { BUREAU_PORT, DOCUMENTS_PORT, ELIGIBILITY_PORT, FRAUD_PORT, KYC_TIER_PORT, LOAN_PORTFOLIO_PORT, LoanPortfolioPort } from '../src/contracts/ports';
import { FieldCipher } from '../src/crypto/field-cipher';
import { PortalSessionService } from '../src/portal/portal-session.service';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Damez@Demo2026';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (n: number) => Array.from(randomBytes(n)).map((b) => b % 10).join('');

let app: NestExpressApplication;
let prisma: PrismaService;
let cipher: FieldCipher;
const docs = new Set<string>();
const control = { outcome: 'ELIGIBLE' as 'ELIGIBLE' | 'CONDITIONAL' | 'INELIGIBLE', decline: false, assessCalls: 0 };

const fakeEligibility = {
  async assess(a: { customerId: string; productId: string; amountKobo: number; tenorMonths: number; applicationId?: string | null }) {
    control.assessCalls++;
    const row = await prisma.eligibilityAssessment.create({
      data: {
        customerId: a.customerId, applicationId: a.applicationId ?? null, productId: a.productId, scorecardId: 'e2e-scorecard', requestedAmountKobo: BigInt(a.amountKobo), tenorMonths: a.tenorMonths,
        outcome: control.outcome, score: 640, scoreBand: 'GOOD', maxAmountKobo: BigInt(a.amountKobo), maxRepaymentKobo: 1_000_000n, requestedRepaymentKobo: 500_000n, dtiBps: 2500,
        recognisedIncomeKobo: 50_000_000n, externalObligationsKobo: 0n, kycTier: 1, kycCapKobo: 10_000_000n,
        reasons: control.decline ? [{ code: 'WRITE_OFF', severity: 'BLOCKER', customerMessage: 'A recent write-off appears on your credit record', officerMessage: 'Write-off 24m' }] : [{ code: 'OK', severity: 'POSITIVE', customerMessage: 'Good repayment history', officerMessage: 'ok' }],
        suggestions: [{ type: 'REDUCE_AMOUNT', customerMessage: 'Try a smaller amount', officerMessage: 'internal note', amountKobo: 100_000 }],
        alternatives: [], factors: [], firedRules: control.decline ? [{ code: 'WRITE_OFF', action: 'DECLINE' }] : [], facts: {},
      },
    });
    return toEligibilityResultDto(row, null);
  },
};
const FAKE_PROVIDERS = [
    { provide: ELIGIBILITY_PORT, useValue: fakeEligibility },
    { provide: KYC_TIER_PORT, useValue: { refreshTier: async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).kycTier, maxLoanKobo: async () => 100_000_000 } },
    { provide: DOCUMENTS_PORT, useValue: { satisfiedKinds: async () => new Set(docs), readContent: async () => { throw new Error('n/a'); }, listIds: async () => [], attachToApplication: async () => undefined } },
    { provide: FRAUD_PORT, useValue: { unresolvedCounts: async () => ({ high: 0, medium: 0, low: 0 }), onApplicationSubmitted: async () => undefined } },
    { provide: BUREAU_PORT, useValue: { latestSummary: async () => null, ensureReport: async () => { throw new Error('n/a'); }, getReport: async () => { throw new Error('n/a'); }, ensureFreshForDisbursement: async () => { throw new Error('n/a'); } } },
];
@Global()
@Module({ providers: FAKE_PROVIDERS, exports: [ELIGIBILITY_PORT, KYC_TIER_PORT, DOCUMENTS_PORT, FRAUD_PORT, BUREAU_PORT] })
class FakePortsModule {}

interface Staff { get: (u: string) => request.Test; post: (u: string, b?: object) => request.Test }
async function login(email: string): Promise<Staff> {
  const agent = request.agent(app.getHttpServer());
  const l = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { body } = await agent.get(`/api/v1/auth/demo-totp?email=${email}`).expect(200);
    const res = await agent.post('/api/v1/auth/totp/verify').send({ challengeToken: l.body.challengeToken, code: body.code });
    if (res.status === 200) {
      const csrf = /csrf=([^;]+)/.exec((res.headers['set-cookie'] as unknown as string[]).join(';'))![1];
      return { get: (u) => agent.get(`/api/v1${u}`), post: (u, b) => agent.post(`/api/v1${u}`).set('x-csrf-token', csrf).send(b ?? {}) };
    }
    await sleep((30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000);
  }
  throw new Error(`could not log in ${email}`);
}

async function newCustomer(branchId: string | null) {
  const id = `e2e${rand(10)}`;
  const phone = `080${rand(8)}`;
  const bvn = `22${rand(9)}`;
  const f = {
    phoneEnc: cipher.encrypt(phone, `customer:${id}:phone`), phoneHash: cipher.blindIndex(phone, 'phone'), bvnEnc: cipher.encrypt(bvn, `customer:${id}:bvn`), bvnHash: cipher.blindIndex(bvn, 'bvn'),
  };
  await prisma.customer.create({ data: { id, firstName: 'Adaeze', lastName: 'Okonkwo', ...f, branchId, kycTier: 1, phoneVerifiedAt: new Date() } });
  const s = await app.get(PortalSessionService).create(id, { ip: '127.0.0.1', userAgent: 'e2e' });
  const cookie = `csid=${s.token}; ccsrf=${s.csrf}`;
  const portal = {
    id, bvn,
    get: (u: string) => request(app.getHttpServer()).get(`/api/v1/portal${u}`).set('Cookie', cookie),
    post: (u: string, b?: object) => request(app.getHttpServer()).post(`/api/v1/portal${u}`).set('Cookie', cookie).set('x-csrf-token', s.csrf).send(b ?? {}),
  };
  return portal;
}
const grantConsent = (customerId: string) => prisma.consent.create({ data: { subjectType: 'CUSTOMER', subjectId: customerId, purpose: 'BUREAU_PULL', textVersion: 'bureau-2026-01', channel: 'E2E' } });

let admin: Staff; let officer: Staff; let officerAbuja: Staff;
let productId: string; let ikjBranchId: string;
let cust: Awaited<ReturnType<typeof newCustomer>>;
let other: Awaited<ReturnType<typeof newCustomer>>;
const AMOUNT = 5_000_000; // ₦50,000

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';
  installBigIntJson();
  const mod = await Test.createTestingModule({ imports: [AppModule, ApplicationsModule, FakePortsModule] })
    // the real Phase-2 providers are wired in AppModule now: force the fakes so this suite isolates the application layer
    .overrideProvider(ELIGIBILITY_PORT).useValue(fakeEligibility)
    .overrideProvider(KYC_TIER_PORT).useValue(FAKE_PROVIDERS[1].useValue)
    .overrideProvider(DOCUMENTS_PORT).useValue(FAKE_PROVIDERS[2].useValue)
    .overrideProvider(FRAUD_PORT).useValue(FAKE_PROVIDERS[3].useValue)
    .overrideProvider(BUREAU_PORT).useValue(FAKE_PROVIDERS[4].useValue)
    .compile();
  app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.init();
  prisma = app.get(PrismaService);
  cipher = app.get(FieldCipher);
  ikjBranchId = (await prisma.branch.findUniqueOrThrow({ where: { code: 'LOS-IKJ' } })).id;
  const p = await prisma.loanProduct.create({
    data: { code: `E2E-${rand(6)}`, name: 'E2E Personal Loan', minAmountKobo: 1_000_000n, maxAmountKobo: 50_000_000n, monthlyRateBps: 450, minTenorMonths: 1, maxTenorMonths: 12, isActive: true, minKycTier: 1, requiredDocs: ['PAYSLIP'], interestMethod: 'FLAT' },
  });
  productId = p.id;
  cust = await newCustomer(ikjBranchId);
  other = await newCustomer(ikjBranchId);
  [admin, officer, officerAbuja] = [await login('admin@damez.ng'), await login('officer@damez.ng'), await login('officer.abuja@damez.ng')];
});
afterAll(async () => {
  // Hard-delete everything this suite created so it never pollutes the dev/demo dataset.
  // Order matters: Loan.applicationId -> LoanApplication is ON DELETE RESTRICT, so loans
  // must go first; the rest (sessions, consents, eligibility assessments, guarantors,
  // offers, application events, ...) cascade from Customer/LoanApplication deletion.
  if (prisma) {
    const customerIds = [cust?.id, other?.id].filter((id): id is string => !!id);
    if (customerIds.length) {
      await prisma.loan.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.loanApplication.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
    if (productId) await prisma.loanProduct.delete({ where: { id: productId } }).catch(() => undefined);
  }
  await app?.close();
});

describe('portal: products, quotes, eligibility preview', () => {
  it('lists the product as available for a Tier 1 customer with a fees summary', async () => {
    const r = await cust.get('/products').expect(200);
    const p = (r.body as { id: string; available: boolean; feesSummary: string; requiredDocs: string[] }[]).find((x) => x.id === productId)!;
    expect(p.available).toBe(true);
    expect(p.feesSummary).toBe('1% management + 0.5% insurance, deducted upfront');
    expect(p.requiredDocs).toEqual(['PAYSLIP']);
  });
  it('requires a session and CSRF', async () => {
    await request(app.getHttpServer()).get('/api/v1/portal/products').expect(401);
    await request(app.getHttpServer()).post('/api/v1/portal/loans/schedule-preview').send({}).expect(401);
  });
  it('returns a schedule and validates bounds', async () => {
    const q = (await cust.post('/loans/schedule-preview', { productId, amountKobo: AMOUNT, tenorMonths: 3 }).expect(200)).body;
    expect(q.schedule).toHaveLength(3);
    expect(q.cost.principalKobo).toBe(AMOUNT);
    expect(q.cost.managementFeeKobo).toBe(50_000);
    await cust.post('/loans/schedule-preview', { productId, amountKobo: 1, tenorMonths: 3 }).expect(400);
    const t = await cust.post('/loans/schedule-preview', { productId, amountKobo: AMOUNT, tenorMonths: 99 });
    expect(t.status).toBe(400);
  });
  it('blocks eligibility preview without bureau consent', async () => {
    const r = await cust.post('/eligibility/preview', { productId, amountKobo: AMOUNT, tenorMonths: 3 }).expect(403);
    expect(r.body.code).toBe('CONSENT_REQUIRED');
    expect(r.body.purpose).toBe('BUREAU_PULL');
    expect(control.assessCalls).toBe(0);
  });
});

describe('portal application lifecycle', () => {
  let appId: string; let reference: string;
  it('requires acceptDisclosure', async () => {
    await cust.post('/applications', { productId, amountKobo: AMOUNT, tenorMonths: 3, purpose: 'Stock' }).expect(400);
    await cust.post('/applications', { productId, amountKobo: AMOUNT, tenorMonths: 3, purpose: 'Stock', acceptDisclosure: false }).expect(400);
  });
  it('creates + submits, then waits for the required document', async () => {
    const r = await cust.post('/applications', { productId, amountKobo: AMOUNT, tenorMonths: 3, purpose: 'Stock for my shop', acceptDisclosure: true }).expect(201);
    appId = r.body.id; reference = r.body.reference;
    expect(reference).toMatch(/^APP-\d{4}-\d{6}$/);
    expect(r.body.status).toBe('SUBMITTED');
    expect(r.body.statusMessage).toMatch(/documents/i);
    expect(r.body.nextAction.type).toBe('UPLOAD_DOCUMENT');
    expect(r.body.requiredDocs).toEqual([{ kind: 'PAYSLIP', satisfied: false }]);
    expect(r.body.quote.schedule).toHaveLength(3);
  });
  it('rejects a second open application for the same product', async () => {
    const r = await cust.post('/applications', { productId, amountKobo: AMOUNT, tenorMonths: 3, purpose: 'Again', acceptDisclosure: true }).expect(409);
    expect(r.body.code).toBe('OPEN_APPLICATION_EXISTS');
  });
  it('advance is idempotent while documents are still missing', async () => {
    const r = await cust.post(`/applications/${appId}/advance`).expect(200);
    expect(r.body.status).toBe('SUBMITTED');
  });
  it('after the upload it reaches BUREAU_CHECK and waits for consent', async () => {
    docs.add('PAYSLIP');
    const r = await cust.post(`/applications/${appId}/advance`).expect(200);
    expect(r.body.status).toBe('BUREAU_CHECK');
    expect(r.body.statusMessage).toBe('Waiting for your consent to check your credit report');
    expect(r.body.nextAction.type).toBe('GIVE_CONSENT');
    expect(control.assessCalls).toBe(0);
  });
  it('after consent it completes the credit check and goes UNDER_REVIEW (once)', async () => {
    await grantConsent(cust.id);
    // lazy advance: a plain GET moves the waiting application forward
    const polled = await cust.get(`/applications/${appId}`).expect(200);
    expect(polled.body.status).toBe('UNDER_REVIEW');
    const r = await cust.post(`/applications/${appId}/advance`).expect(200);
    expect(r.body.status).toBe('UNDER_REVIEW');
    expect(r.body.nextAction).toBeNull();
    expect(r.body.eligibility.outcome).toBe('ELIGIBLE');
    expect(JSON.stringify(r.body.eligibility)).not.toMatch(/officerMessage|internal note/);
    const calls = control.assessCalls;
    const again = await cust.post(`/applications/${appId}/advance`).expect(200);
    expect(again.body.status).toBe('UNDER_REVIEW');
    expect(control.assessCalls).toBe(calls);
    const events = await prisma.applicationEvent.findMany({ where: { applicationId: appId }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.toStatus)).toEqual(['DRAFT', 'SUBMITTED', 'BUREAU_CHECK', 'UNDER_REVIEW']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'application.transition', resourceId: appId }, orderBy: { seq: 'desc' } });
    expect(audit).toBeTruthy();
  });
  it('lists own applications only and hides others as 404', async () => {
    const mine = (await cust.get('/applications').expect(200)).body as { id: string }[];
    expect(mine.map((x) => x.id)).toContain(appId);
    expect(((await other.get('/applications').expect(200)).body as unknown[]).length).toBe(0);
    await other.get(`/applications/${appId}`).expect(404);
    await other.post(`/applications/${appId}/cancel`).expect(404);
    await other.post(`/applications/${appId}/advance`).expect(404);
    await cust.get(`/applications/${appId}`).expect(200);
  });
  it('previews eligibility with consent (customer wording only)', async () => {
    const r = (await other.post('/eligibility/preview', { productId, amountKobo: AMOUNT, tenorMonths: 3 })).status;
    expect(r).toBe(403);
    await grantConsent(other.id);
    const ok = await other.post('/eligibility/preview', { productId, amountKobo: AMOUNT, tenorMonths: 3 }).expect(200);
    expect(ok.body.outcome).toBe('ELIGIBLE');
    expect(ok.body.headline).toBeTruthy();
    expect(ok.body.suggestions[0].officerMessage).toBeUndefined();
  });
  it('lets the customer cancel (state machine) and then cannot cancel again', async () => {
    const c = await cust.post(`/applications/${appId}/cancel`, { reason: 'Changed my mind' }).expect(200);
    expect(c.body.status).toBe('CANCELLED');
    await cust.post(`/applications/${appId}/cancel`).expect(409);
    await cust.post(`/applications/${appId}/advance`).expect(200).then((r) => expect(r.body.status).toBe('CANCELLED'));
  });
});

describe('staff console: list, detail, transitions, permissions', () => {
  let appId: string;
  beforeAll(async () => {
    const c = (await admin.post('/applications', { customerId: cust.id, productId, amountKobo: AMOUNT, tenorMonths: 6, purpose: 'Working capital' })).body;
    appId = c.id;
  });
  it('creates a DRAFT on behalf of a customer (branch channel), masked name', async () => {
    const d = (await admin.get(`/applications/${appId}`).expect(200)).body;
    expect(d.status).toBe('DRAFT');
    expect(d.channel).toBe('BRANCH');
    expect(d.customer.name).toBe('Adaeze O•••');
    expect(d.branch.code).toBe('LOS-IKJ');
    expect(d.allowedTransitions.map((t: { to: string }) => t.to)).toEqual(expect.arrayContaining(['SUBMITTED', 'CANCELLED']));
    expect(d.quote.schedule).toHaveLength(6);
  });
  it('state machine endpoint exposes all 16 states', async () => {
    const sm = (await admin.get('/applications/state-machine').expect(200)).body;
    expect(sm.states).toHaveLength(16);
    expect(sm.transitions.find((t: { from: string; to: string }) => t.from === 'UNDER_REVIEW' && t.to === 'APPROVED').implemented).toBe(true);
  });
  it('submits through the pipeline to UNDER_REVIEW', async () => {
    const d = (await admin.post(`/applications/${appId}/submit`).expect(200)).body;
    expect(d.status).toBe('UNDER_REVIEW');
    expect(d.eligibility.outcome).toBe('ELIGIBLE');
    expect(d.requiredDocs).toEqual([{ kind: 'PAYSLIP', satisfied: true }]);
    expect(d.events.map((e: { to: string }) => e.to)).toEqual(['DRAFT', 'SUBMITTED', 'BUREAU_CHECK', 'UNDER_REVIEW']);
    expect(d.events[3].actor.type).toBe('SYSTEM');
  });
  it('lists with filters and branch scope', async () => {
    const all = (await admin.get(`/applications?status=UNDER_REVIEW&productId=${productId}&outcome=ELIGIBLE&q=APP-`).expect(200)).body;
    expect(all.items.map((i: { id: string }) => i.id)).toContain(appId);
    expect(all.items[0].customer.name).toMatch(/•/);
    const ikj = (await officer.get(`/applications?productId=${productId}`).expect(200)).body;
    expect(ikj.items.map((i: { id: string }) => i.id)).toContain(appId);
    const abj = (await officerAbuja.get(`/applications?productId=${productId}`).expect(200)).body;
    expect(abj.items).toHaveLength(0);
    await officerAbuja.get(`/applications/${appId}`).expect(404);
    await officerAbuja.post(`/applications/${appId}/transition`, { to: 'CANCELLED', reason: 'x' }).expect(404);
  });
  it('schedule preview works for staff', async () => {
    const q = (await officer.post('/loans/schedule-preview', { productId, amountKobo: AMOUNT, tenorMonths: 3 }).expect(200)).body;
    expect(q.cost.tenorMonths).toBe(3);
  });
  it('enforces per-transition permissions, legality and 501', async () => {
    // loan officer has no loan:reject
    const forbidden = await officer.post(`/applications/${appId}/transition`, { to: 'REJECTED', reason: 'no' }).expect(403);
    expect(forbidden.body.required).toEqual(['loan:reject']);
    await admin.post(`/applications/${appId}/transition`, { to: 'REJECTED' }).expect(400); // reason required
    // APPROVED (and every other prompt-3 state) has its own flow (maker-checker / offer / disbursement / servicing)
    // and is rejected by the generic transition endpoint rather than silently bypassing it.
    const na = await admin.post(`/applications/${appId}/transition`, { to: 'APPROVED' }).expect(409);
    expect(na.body.code).toBe('USE_DEDICATED_ENDPOINT');
    const bad = await admin.post(`/applications/${appId}/transition`, { to: 'KYC_PENDING', reason: 'x' }).expect(409);
    expect(bad.body.code).toBe('ILLEGAL_TRANSITION');
    await admin.post(`/applications/${appId}/transition`, { to: 'ACTIVE' }).expect(409);
  });
  it('reassess refreshes the assessment without changing status', async () => {
    const before = control.assessCalls;
    control.outcome = 'INELIGIBLE'; control.decline = true; // would auto-reject in the pipeline, but reassess must not
    const d = (await admin.post(`/applications/${appId}/reassess`).expect(200)).body;
    control.outcome = 'ELIGIBLE'; control.decline = false;
    expect(control.assessCalls).toBe(before + 1);
    expect(d.status).toBe('UNDER_REVIEW');
    expect(d.eligibility.outcome).toBe('INELIGIBLE');
    await officer.post(`/applications/${appId}/reassess`).expect(200); // loan_officer holds eligibility:run
    await (await login('support@damez.ng')).post(`/applications/${appId}/reassess`).expect(403);
  });
  it('rejects with a reason (loan:reject), records it, and the state is final', async () => {
    const d = (await admin.post(`/applications/${appId}/transition`, { to: 'REJECTED', reason: 'Income not verifiable' }).expect(200)).body;
    expect(d.status).toBe('REJECTED');
    expect(d.statusReason).toBe('Income not verifiable');
    expect(d.allowedTransitions).toEqual([]);
    await admin.post(`/applications/${appId}/transition`, { to: 'CANCELLED', reason: 'x' }).expect(409);
    const p = (await cust.get(`/applications/${appId}`).expect(200)).body;
    expect(p.status).toBe('REJECTED');
    expect(p.statusMessage).toMatch(/Income not verifiable/);
  });
  it('staff can cancel with application:update + reason', async () => {
    const c = (await admin.post('/applications', { customerId: cust.id, productId, amountKobo: AMOUNT, tenorMonths: 3 })).body;
    await officer.post(`/applications/${c.id}/transition`, { to: 'CANCELLED' }).expect(400);
    const d = (await officer.post(`/applications/${c.id}/transition`, { to: 'CANCELLED', reason: 'Customer asked by phone' }).expect(200)).body;
    expect(d.status).toBe('CANCELLED');
    expect(d.events.at(-1).actor.type).toBe('STAFF');
  });
});

describe('auto-decline', () => {
  it('rejects automatically when INELIGIBLE with a DECLINE rule, using the customer-facing reason', async () => {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'application.auto_decline_enabled' } });
    if (setting?.value === false) return; // another run flipped it; nothing to assert
    control.outcome = 'INELIGIBLE'; control.decline = true;
    try {
      const r = await cust.post('/applications', { productId, amountKobo: AMOUNT, tenorMonths: 3, purpose: 'Bills', acceptDisclosure: true }).expect(201);
      expect(r.body.status).toBe('REJECTED');
      expect(r.body.statusMessage).toMatch(/write-off appears on your credit record/);
      const ev = await prisma.applicationEvent.findMany({ where: { applicationId: r.body.id }, orderBy: { createdAt: 'asc' } });
      expect(ev.map((e) => e.toStatus)).toEqual(['DRAFT', 'SUBMITTED', 'BUREAU_CHECK', 'REJECTED']);
    } finally { control.outcome = 'ELIGIBLE'; control.decline = false; }
  });
});

describe('loan portfolio port (ledger-backed, prompt 3)', () => {
  it('derives performance and internal history from a booked Loan + LoanInstallment rows', async () => {
    const port = app.get<LoanPortfolioPort>(LOAN_PORTFOLIO_PORT);
    const c = await newCustomer(ikjBranchId);
    const created = (await admin.post('/applications', { customerId: c.id, productId, amountKobo: AMOUNT, tenorMonths: 6 })).body;
    const disbursedAt = new Date(Date.now() - 95 * 86_400_000);
    const loan = await prisma.loan.create({
      data: {
        applicationId: created.id, customerId: c.id, productId, reference: created.reference,
        principalKobo: AMOUNT, disbursedAmountKobo: AMOUNT, tenorMonths: 6, monthlyRateBps: 450, interestMethod: 'FLAT',
        totalCostOfCreditKobo: 500_000, status: 'Unpaid', disbursedAt, maturityDate: new Date(disbursedAt.getTime() + 180 * 86_400_000),
        outstandingPrincipalKobo: Math.round(AMOUNT / 3), dpd: 35,
      },
    });
    const perInstalmentKobo = Math.round(AMOUNT / 6);
    await prisma.loanInstallment.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        loanId: loan.id, seq: i + 1, dueDate: new Date(disbursedAt.getTime() + (i + 1) * 30 * 86_400_000),
        principalKobo: perInstalmentKobo, interestKobo: 50_000, feeKobo: 0, totalKobo: perInstalmentKobo + 50_000,
        paidKobo: i < 4 ? perInstalmentKobo + 50_000 : 0, status: i < 4 ? ('PAID' as const) : ('OVERDUE' as const),
      })),
    });
    expect(await port.listActiveBorrowerIds()).toContain(c.id);
    const period = new Date().toISOString().slice(0, 7);
    const rec = (await port.listPerformance(period)).find((r) => r.customerId === c.id)!;
    expect(rec.bvn).toBe(c.bvn);
    expect(rec.facilityRef).toBe(created.reference);
    expect(rec.status).toBe('Unpaid');
    expect(rec.dpd).toBe(35);
    expect(rec.amountGrantedKobo).toBe(AMOUNT);
    expect(rec.outstandingKobo).toBeLessThan(AMOUNT);
    expect(rec.outstandingKobo).toBeGreaterThan(0);
    expect(await port.internalHistory(c.id)).toEqual({ completedLoans: 0, lateInstalments: 2, activeLoan: true, writtenOff: false });
    await prisma.loan.update({ where: { id: loan.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    const closed = (await port.listPerformance(period)).find((r) => r.customerId === c.id)!;
    expect(closed).toMatchObject({ status: 'CLOSED', outstandingKobo: 0, dpd: 0 });
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(await port.listActiveBorrowerIds()).not.toContain(c.id);
    expect(await port.internalHistory(c.id)).toMatchObject({ completedLoans: 1, activeLoan: false });
  });
});
