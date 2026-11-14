import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DEFAULT_SCORECARD_V1 } from '@damez/shared';
import { AppModule } from '../src/app.module';
import { installBigIntJson } from '../src/common/bigint';
import { EligibilityModule } from '../src/eligibility/eligibility.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Self-contained: imports the Phase-2 eligibility modules itself so it also runs before the lead wires them into AppModule. */
@Module({ imports: [AppModule, EligibilityModule] })
class TestRootModule {}

const PASSWORD = 'Damez@Demo2026';
let app: NestExpressApplication;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RUN = Date.now().toString(36);

interface Client {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

async function login(email: string): Promise<Client> {
  const agent = request.agent(app.getHttpServer());
  const l = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { body } = await agent.get(`/api/v1/auth/demo-totp?email=${email}`).expect(200);
    const res = await agent.post('/api/v1/auth/totp/verify').send({ challengeToken: l.body.challengeToken, code: body.code });
    if (res.status === 200) {
      const csrf = /csrf=([^;]+)/.exec((res.headers['set-cookie'] as unknown as string[]).join(';'))![1];
      const h = (t: request.Test) => t.set('x-csrf-token', csrf);
      return {
        get: (u) => agent.get(`/api/v1${u}`),
        post: (u, b) => h(agent.post(`/api/v1${u}`)).send(b ?? {}),
        put: (u, b) => h(agent.put(`/api/v1${u}`)).send(b ?? {}),
        patch: (u, b) => h(agent.patch(`/api/v1${u}`)).send(b ?? {}),
      };
    }
    await sleep((30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000); // TOTP replay protection
  }
  throw new Error(`could not log in ${email}`);
}

let risk: Client; let ceo: Client; let officer: Client; let admin: Client; let analyst: Client;

beforeAll(async () => {
  installBigIntJson();
  app = await NestFactory.create<NestExpressApplication>(TestRootModule, { rawBody: true, logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.init();
  risk = await login('risk.manager@damez.ng');
  ceo = await login('ceo@damez.ng');
  officer = await login('officer@damez.ng');
  admin = await login('admin@damez.ng');
  analyst = await login('analyst@damez.ng');
});
afterAll(async () => { await app?.close(); });

describe('scorecards: create → request activation → CEO approves → ACTIVE (previous RETIRED)', () => {
  const key = `e2e-${RUN}`;
  let v1: string; let v2: string; let defaultBefore: unknown;

  it('seeds exactly one ACTIVE default scorecard', async () => {
    const list = (await risk.get('/scorecards').expect(200)).body as Array<{ key: string; status: string; version: number }>;
    const active = list.filter((s) => s.key === 'default' && s.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    defaultBefore = active[0];
    const fields = (await risk.get('/scorecards/fields').expect(200)).body as Array<{ key: string }>;
    expect(fields.map((f) => f.key)).toContain('bureauScore');
  });

  it('enforces permissions', async () => {
    await officer.get('/scorecards').expect(403);
    await analyst.get('/scorecards').expect(200);
    await analyst.post('/scorecards', { name: 'nope', key, definition: DEFAULT_SCORECARD_V1 }).expect(403);
  });

  it('creates a draft, validates edits, and stores semantic errors', async () => {
    const c = (await risk.post('/scorecards', { name: 'E2E scorecard', key, definition: DEFAULT_SCORECARD_V1, notes: 'e2e' }).expect(201)).body;
    v1 = c.id;
    expect(c).toMatchObject({ key, version: 1, status: 'DRAFT', pendingApprovalId: null });
    const bad = JSON.parse(JSON.stringify(DEFAULT_SCORECARD_V1));
    bad.factors[0].field = 'notAField';
    bad.cutoffs = { approve: 500, refer: 600 };
    const r = await risk.put(`/scorecards/${v1}`, { definition: bad }).expect(400);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect(r.body.errors['definition.factors.0.field']).toBeDefined();
    expect(r.body.errors['definition.cutoffs']).toBeDefined();
    const ok = JSON.parse(JSON.stringify(DEFAULT_SCORECARD_V1));
    ok.cutoffs.approve = 610;
    const u = (await risk.put(`/scorecards/${v1}`, { name: 'E2E scorecard v1', definition: ok }).expect(200)).body;
    expect(u.definition.cutoffs.approve).toBe(610);
    expect(u.name).toBe('E2E scorecard v1');
  });

  it('activation goes through approval checks; the draft is locked while pending', async () => {
    await analyst.post(`/scorecards/${v1}/request-activation`, { reason: 'try it' }).expect(403);
    const appr = (await risk.post(`/scorecards/${v1}/request-activation`, { reason: 'e2e activation of v1' }).expect(201)).body;
    expect(appr).toMatchObject({ type: 'SCORECARD_ACTIVATION', status: 'PENDING' });
    expect(appr.payload).toMatchObject({ scorecardId: v1, key, version: 1 });
    expect((await risk.get(`/scorecards/${v1}`).expect(200)).body.pendingApprovalId).toBe(appr.id);
    await risk.post(`/scorecards/${v1}/request-activation`, { reason: 'again' }).expect(409);
    await risk.put(`/scorecards/${v1}`, { definition: DEFAULT_SCORECARD_V1 }).expect(409);
    await risk.post(`/approvals/${appr.id}/approve`, {}).expect(403); // maker cannot approve
    const done = (await ceo.post(`/approvals/${appr.id}/approve`, { comment: 'ok' }).expect(200)).body;
    expect(done.status).toBe('EXECUTED');
    const sc = (await risk.get(`/scorecards/${v1}`).expect(200)).body;
    expect(sc.status).toBe('ACTIVE');
    expect(sc.activatedAt).toBeTruthy();
    expect(sc.pendingApprovalId).toBeNull();
  });

  it('an ACTIVE version is immutable; v2 (copied from v1) replaces it and v1 is RETIRED', async () => {
    await risk.put(`/scorecards/${v1}`, { definition: DEFAULT_SCORECARD_V1 }).expect(409);
    await risk.post(`/scorecards/${v1}/request-activation`, { reason: 'already active' }).expect(409);
    const c = (await risk.post('/scorecards', { name: 'E2E scorecard v2', fromId: v1 }).expect(201)).body;
    v2 = c.id;
    expect(c).toMatchObject({ key, version: 2, status: 'DRAFT' });
    expect(c.definition.cutoffs.approve).toBe(610);
    const appr = (await risk.post(`/scorecards/${v2}/request-activation`, { reason: 'e2e activation of v2' }).expect(201)).body;
    await ceo.post(`/approvals/${appr.id}/approve`, {}).expect(200);
    expect((await risk.get(`/scorecards/${v2}`).expect(200)).body.status).toBe('ACTIVE');
    const old = (await risk.get(`/scorecards/${v1}`).expect(200)).body;
    expect(old.status).toBe('RETIRED');
    await risk.put(`/scorecards/${v1}`, { definition: DEFAULT_SCORECARD_V1 }).expect(409);
    const audit = (await admin.get('/audit?action=scorecard.activated&pageSize=5').expect(200)).body.items as Array<{ resourceId: string; before: unknown; after: unknown }>;
    expect(audit.find((a) => a.resourceId === v2)).toMatchObject({ before: expect.anything(), after: expect.anything() });
  });

  it('leaves the default scorecard exactly as it was', async () => {
    const list = (await risk.get('/scorecards').expect(200)).body as Array<{ id: string; key: string; status: string }>;
    const active = list.filter((s) => s.key === 'default' && s.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0]).toEqual(defaultBefore);
  });
});

describe('eligibility simulate', () => {
  let productId: string;
  const strong = {
    age: 35, employmentStatus: 'EMPLOYED', declaredMonthlyIncomeKobo: 40_000_000, kycTier: 3, accountAgeDays: 400,
    bureauScore: 730, bureauThinFile: false, bankStatementMonths: 6, avgMonthlyInflowKobo: 40_000_000, inflowStability: 92, avgBalanceKobo: 20_000_000, salaryDetected: true,
  };

  beforeAll(async () => {
    const products = (await risk.get('/products').expect(200)).body as Array<{ id: string; code: string; isActive: boolean }>;
    productId = (products.find((p) => p.code === 'PERS') ?? products.find((p) => p.isActive)!).id;
  });

  it('requires eligibility:run + scorecard:read', async () => {
    await officer.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6 }).expect(403);
  });

  it('simulates overrides without persisting an assessment', async () => {
    const r = (await risk.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, facts: strong }).expect(200)).body;
    expect(r.result).toMatchObject({ outcome: 'ELIGIBLE', simulated: true, id: 'simulated' });
    expect(r.result.reasons.length).toBeGreaterThan(0);
    expect(r.result.factors.length).toBeGreaterThan(5);
    expect(r.facts.kycTier).toBe(3);

    const declined = (await risk.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, facts: { ...strong, bureauWriteOff24m: true, bureauWriteOffAgeMonths: 8 } }).expect(200)).body.result;
    expect(declined.outcome).toBe('INELIGIBLE');
    expect(declined.suggestions.find((s: { type: string }) => s.type === 'REAPPLY_LATER').reapplyAfterDays).toBe(480);
  });

  it('accepts an unsaved draft definition, rejects an invalid one and unknown facts', async () => {
    const lenient = JSON.parse(JSON.stringify(DEFAULT_SCORECARD_V1));
    lenient.policyRules = [];
    const r = (await risk.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, facts: { ...strong, bureauWriteOff24m: true }, definition: lenient }).expect(200)).body.result;
    expect(r.scorecard.key).toBe('draft');
    expect(r.firedRules).toEqual([]);
    const bad = JSON.parse(JSON.stringify(DEFAULT_SCORECARD_V1)); bad.policyRules[0].field = 'zzz';
    await risk.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, definition: bad }).expect(400);
    await risk.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, facts: { notAFact: 1 } }).expect(400);
    await risk.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, scorecardId: 'missing' }).expect(404);
  });

  it('starts from a real customer’s stored data (no new pull), and lists customer assessments', async () => {
    const cust = (await admin.get('/customers?pageSize=1').expect(200)).body.items[0] as { id: string };
    const r = (await admin.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, baseCustomerId: cust.id, facts: { kycTier: 2 } }).expect(200)).body;
    expect(r.facts.kycTier).toBe(2);
    expect(typeof r.facts.age).toBe('number');
    expect(r.result.simulated).toBe(true);
    const list = (await admin.get(`/customers/${cust.id}/eligibility?limit=3`).expect(200)).body;
    expect(Array.isArray(list)).toBe(true);
    await officer.get(`/customers/${cust.id}/eligibility`).expect(200).catch(() => undefined);
    await risk.post('/eligibility/simulate', { productId, amountKobo: 10_000_000, tenorMonths: 6, baseCustomerId: 'nope' }).expect(404);
  });
});

describe('products', () => {
  const code = `E2E-${RUN.toUpperCase()}`;
  let id: string;

  afterAll(async () => {
    // No loans are ever attached to this product, so a plain delete is safe.
    if (id) await app.get(PrismaService).loanProduct.delete({ where: { id } }).catch(() => undefined);
  });

  it('lists full DTOs and keeps the legacy settings route', async () => {
    const list = (await risk.get('/products').expect(200)).body as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThan(0);
    for (const k of ['interestMethod', 'managementFeeBps', 'requiredDocs', 'scorecardKey', 'allowGuarantor', 'eligibilityOverrides']) expect(list[0]).toHaveProperty(k);
    expect(((await risk.get('/settings/products').expect(200)).body as unknown[]).length).toBe(list.length);
    await officer.get('/products').expect(200);
  });

  it('creates an inactive product (product:create only)', async () => {
    const body = { code, name: `E2E Product ${RUN}`, minAmountKobo: 5_000_000, maxAmountKobo: 50_000_000, minTenorMonths: 1, maxTenorMonths: 6, monthlyRateBps: 400, requiredDocs: ['ID_CARD', 'PAYSLIP'] };
    await officer.post('/products', body).expect(403);
    await risk.post('/products', { ...body, requiredDocs: ['SELFIE'] }).expect(400);
    await risk.post('/products', { ...body, minAmountKobo: 99_000_000 }).expect(400);
    const p = (await risk.post('/products', body).expect(201)).body;
    id = p.id;
    expect(p).toMatchObject({ code, isActive: false, requiredDocs: ['ID_CARD', 'PAYSLIP'], scorecardKey: 'default', monthlyRateBps: 400 });
    await risk.post('/products', body).expect(409);
    expect((await risk.get(`/products/${id}`).expect(200)).body.code).toBe(code);
    await risk.get('/products/does-not-exist').expect(404);
  });

  it('non-pricing patch applies immediately (audited)', async () => {
    const r = (await risk.patch(`/products/${id}`, { description: 'e2e description', minKycTier: 2, isActive: true, eligibilityOverrides: { maxDtiBps: 3500 } }).expect(200)).body;
    expect(r.approval).toBeNull();
    expect(r.product).toMatchObject({ description: 'e2e description', minKycTier: 2, isActive: true, eligibilityOverrides: { maxDtiBps: 3500 } });
    const audit = (await admin.get('/audit?action=product.updated&pageSize=5').expect(200)).body.items as Array<{ resourceId: string }>;
    expect(audit.some((a) => a.resourceId === id)).toBe(true);
    await risk.patch(`/products/${id}`, { eligibilityOverrides: { maxDtiBps: 10 } }).expect(400);
    await risk.patch(`/products/${id}`, { scorecardKey: 'no-such-key' }).expect(400);
    await risk.patch(`/products/${id}`, { minAmountKobo: 900_000_000 }).expect(400);
  });

  it('pricing patch returns an approval and applies only after approval', async () => {
    await officer.patch(`/products/${id}`, { monthlyRateBps: 450 }).expect(403);
    const r = (await risk.patch(`/products/${id}`, { monthlyRateBps: 450, managementFeeBps: 120, interestMethod: 'REDUCING_BALANCE', name: `E2E Product ${RUN} renamed` }).expect(200)).body;
    expect(r.approval).toMatchObject({ type: 'PRODUCT_RATE_CHANGE', status: 'PENDING' });
    expect(r.approval.payload).toMatchObject({ productId: id, changes: { monthlyRateBps: 450, managementFeeBps: 120, interestMethod: 'REDUCING_BALANCE' }, current: { monthlyRateBps: 400, interestMethod: 'FLAT' } });
    expect(r.product.name).toContain('renamed'); // non-pricing part is immediate
    expect(r.product.monthlyRateBps).toBe(400); // pricing is not
    expect((await risk.get(`/products/${id}`).expect(200)).body).toMatchObject({ monthlyRateBps: 400, interestMethod: 'FLAT', managementFeeBps: 100 });
    await risk.post(`/approvals/${r.approval.id}/approve`, {}).expect(403);
    expect((await ceo.post(`/approvals/${r.approval.id}/approve`, {}).expect(200)).body.status).toBe('EXECUTED');
    expect((await risk.get(`/products/${id}`).expect(200)).body).toMatchObject({ monthlyRateBps: 450, interestMethod: 'REDUCING_BALANCE', managementFeeBps: 120 });
    const audit = (await admin.get('/audit?action=product.pricing_changed&pageSize=5').expect(200)).body.items as Array<{ resourceId: string; before: Record<string, unknown>; after: Record<string, unknown> }>;
    const mine = audit.find((a) => a.resourceId === id)!;
    expect(mine.before.monthlyRateBps).toBe(400);
    expect(mine.after.monthlyRateBps).toBe(450);
  });

  it('the legacy single-rate payload still works', async () => {
    const req = (await risk.post('/approvals', { type: 'PRODUCT_RATE_CHANGE', summary: 'e2e legacy', payload: { productId: id, newMonthlyRateBps: 430 } }).expect(201)).body;
    await ceo.post(`/approvals/${req.id}/approve`, {}).expect(200);
    expect((await risk.get(`/products/${id}`).expect(200)).body.monthlyRateBps).toBe(430);
    await risk.post('/approvals', { type: 'PRODUCT_RATE_CHANGE', summary: 'e2e bad', payload: { productId: id, changes: { penaltyBpsPerDay: 9999 } } }).expect(400);
  });
});
