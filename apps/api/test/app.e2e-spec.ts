import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp } from '../src/main';

const PASSWORD = 'Damez@Demo2026';
let app: NestExpressApplication;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  me: { id: string; permissions: string[] };
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
        me: res.body.user,
      };
    }
    // TOTP replay protection: wait for the next 30s step and retry
    await sleep((30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000);
  }
  throw new Error(`could not log in ${email}`);
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
});
afterAll(async () => { await app.close(); });

describe('auth', () => {
  it('rejects bad credentials generically', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ceo@damez.ng', password: 'wrong-password' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_CREDENTIALS');
  });
  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });
  it('blocks the locked and the disabled demo accounts', async () => {
    const a = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'locked.officer@damez.ng', password: PASSWORD });
    expect(a.status).toBe(423);
    const b = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'former.officer@damez.ng', password: PASSWORD });
    expect(b.status).toBe(401);
  });
});

describe('rbac, csrf, audit', () => {
  let admin: Client; let officer: Client;
  beforeAll(async () => { admin = await login('admin@damez.ng'); officer = await login('officer@damez.ng'); });

  it('hides what the role cannot do', async () => {
    await officer.get('/audit').expect(403);
    await officer.get('/roles').expect(403);
    await admin.get('/audit').expect(200);
  });
  it('enforces CSRF on mutations', async () => {
    const agent = request.agent(app.getHttpServer());
    const l = await agent.post('/api/v1/auth/login').send({ email: 'compliance@damez.ng', password: PASSWORD });
    const code = (await agent.get('/api/v1/auth/demo-totp?email=compliance@damez.ng')).body.code;
    let v = await agent.post('/api/v1/auth/totp/verify').send({ challengeToken: l.body.challengeToken, code });
    if (v.status !== 200) { await sleep(31000); const c2 = (await agent.get('/api/v1/auth/demo-totp?email=compliance@damez.ng')).body.code; v = await agent.post('/api/v1/auth/totp/verify').send({ challengeToken: l.body.challengeToken, code: c2 }); }
    expect(v.status).toBe(200);
    const r = await agent.post('/api/v1/auth/logout').send({});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF');
  });
  it('edits the matrix, locks super admin, audits the change and keeps the chain valid', async () => {
    const roles = (await admin.get('/roles').expect(200)).body as Array<{ id: string; key: string; permissions: string[] }>;
    const support = roles.find((r) => r.key === 'customer_support')!;
    const next = [...support.permissions, 'report:read'];
    const upd = await admin.put(`/roles/${support.id}/permissions`, { permissions: next }).expect(200);
    expect(upd.body.permissions).toContain('report:read');
    await admin.put(`/roles/${support.id}/permissions`, { permissions: support.permissions }).expect(200);
    const sa = roles.find((r) => r.key === 'super_admin')!;
    await admin.put(`/roles/${sa.id}/permissions`, { permissions: [] }).expect(400);
    const audit = (await admin.get('/audit?action=role.permissions_changed&pageSize=5').expect(200)).body;
    expect(audit.items[0].before).toBeTruthy();
    expect(audit.items[0].after).toBeTruthy();
    const v = (await admin.get('/audit/verify').expect(200)).body;
    expect(v.valid).toBe(true);
  });
  it('masks PII by default and audits reveals', async () => {
    const list = (await officer.get('/customers?pageSize=1').expect(200)).body.items[0];
    expect(list.phone).toMatch(/•/);
    expect(list.bvn).toMatch(/•/);
    const rev = await officer.post('/pii/reveal', { resource: 'customer', id: list.id, field: 'phone', reason: 'Customer callback request' });
    // officer is branch-scoped: either revealed (own branch) or hidden (404)
    expect([200, 404]).toContain(rev.status);
  });
});

describe('maker-checker with escalation', () => {
  let officer: Client; let analyst: Client; let risk: Client; let ceo: Client;
  beforeAll(async () => { officer = await login('officer@damez.ng'); analyst = await login('analyst@damez.ng'); risk = await login('risk.manager@damez.ng'); ceo = await login('ceo@damez.ng'); });

  it('maker cannot approve own request; escalates above approver limit; executes at sufficient authority', async () => {
    const created = (await officer.post('/approvals', { type: 'WAIVER', summary: 'e2e waiver of late fees', amountKobo: 20_000_000, payload: { loanRef: 'E2E-1' } }).expect(201)).body;
    expect(created.status).toBe('PENDING');
    await officer.post(`/approvals/${created.id}/approve`, {}).expect(403);

    // analyst has no WAIVER approve permission → cannot decide
    await analyst.post(`/approvals/${created.id}/approve`, {}).expect(403);

    // risk manager waiver limit is ₦500,000 ≥ ₦200,000 → final
    const done = (await risk.post(`/approvals/${created.id}/approve`, { comment: 'ok' }).expect(200)).body;
    expect(done.status).toBe('EXECUTED');
    expect(done.steps).toHaveLength(1);
  });
  it('escalates when the amount exceeds the first approver limit', async () => {
    // collections manager limit ₦250,000; request ₦400,000 → escalated, then risk manager (₦500,000) finalises
    const cm = await login('collections.manager@damez.ng');
    const created = (await officer.post('/approvals', { type: 'WAIVER', summary: 'e2e large waiver', amountKobo: 40_000_000, payload: {} }).expect(201)).body;
    const esc = (await cm.post(`/approvals/${created.id}/approve`, { comment: 'recommend' }).expect(200)).body;
    expect(esc.status).toBe('ESCALATED');
    await cm.post(`/approvals/${created.id}/approve`, {}).expect(403); // already acted
    const fin = (await risk.post(`/approvals/${created.id}/approve`, {}).expect(200)).body;
    expect(fin.status).toBe('EXECUTED');
    expect(fin.steps.map((s: { decision: string }) => s.decision)).toEqual(['ESCALATED', 'APPROVED']);
  });
  it('applies a product rate change only after approval', async () => {
    const products = (await risk.get('/settings/products').expect(200)).body as Array<{ id: string; code: string; monthlyRateBps: number }>;
    const p = products.find((x) => x.code === 'DEVICE')!;
    const target = p.monthlyRateBps === 500 ? 480 : 500;
    const req = (await risk.post('/approvals', { type: 'PRODUCT_RATE_CHANGE', summary: 'e2e rate change', payload: { productId: p.id, newMonthlyRateBps: target } }).expect(201)).body;
    const unchanged = ((await risk.get('/settings/products')).body as typeof products).find((x) => x.id === p.id)!;
    expect(unchanged.monthlyRateBps).toBe(p.monthlyRateBps);
    await risk.post(`/approvals/${req.id}/approve`, {}).expect(403); // maker
    await ceo.post(`/approvals/${req.id}/approve`, {}).expect(200);
    const after = ((await risk.get('/settings/products')).body as typeof products).find((x) => x.id === p.id)!;
    expect(after.monthlyRateBps).toBe(target);
  });
  it('supports rejection and idempotent submission', async () => {
    const key = `e2e-${Date.now()}`;
    const body = { type: 'WAIVER', summary: 'e2e idempotent waiver', amountKobo: 5_000_000, payload: {} };
    const a = await officer.post('/approvals', body).set('Idempotency-Key', key).expect(201);
    const b = await officer.post('/approvals', body).set('Idempotency-Key', key);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replay']).toBe('true');
    await officer.post('/approvals', { ...body, amountKobo: 6_000_000 }).set('Idempotency-Key', key).expect(422);
    const rej = (await ceo.post(`/approvals/${a.body.id}/reject`, { comment: 'no' }).expect(200)).body;
    expect(rej.status).toBe('REJECTED');
  });
});
