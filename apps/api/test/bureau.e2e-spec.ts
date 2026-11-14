import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BureauModule } from '../src/bureau/bureau.module';
import { installBigIntJson } from '../src/common/bigint';
import { ConsentService } from '../src/consent/consent.module';
import { CustomersService } from '../src/customers/customers.module';
import { FieldCipher } from '../src/crypto/field-cipher';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Damez@Demo2026';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The lead wires BureauModule into AppModule; importing it here too keeps this spec independent of that (modules are singletons). */
@Module({ imports: [AppModule, BureauModule] })
class BureauE2eModule {}

let app: NestExpressApplication;
let prisma: PrismaService;
const created: string[] = [];

interface Client { get: (u: string) => request.Test; post: (u: string, b?: object) => request.Test }
async function login(email: string): Promise<Client> {
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

let seq = 0;
/** BVN = 8 unique digits + hundreds digit 0 + tens digit (selects the bureau profile) + units 0 */
async function makeCustomer(tens: number): Promise<string> {
  const stamp = `${String(Date.now()).slice(-6)}${String(++seq).padStart(2, '0')}`;
  const bvn = `${stamp}0${tens}0`;
  const id = `e2e_bureau_${stamp}_${tens}`;
  const enc = app.get(CustomersService, { strict: false }).encryptFields(id, { phone: `080${stamp}${tens}`, bvn });
  const cipher = app.get(FieldCipher);
  await prisma.customer.create({ data: { id, firstName: 'Bureau', lastName: `Test${tens}`, ...enc, dobEnc: cipher.encrypt('1990-04-12', `customer:${id}:dob`), kycStatus: 'VERIFIED' } });
  created.push(id);
  return id;
}
const grant = (id: string) => app.get(ConsentService).grant({ subjectType: 'CUSTOMER', subjectId: id, purpose: 'BUREAU_PULL', lawfulBasis: 'CONSENT', textVersion: 'bureau-2026-01', channel: 'WEB' }, null);

beforeAll(async () => {
  installBigIntJson();
  app = await NestFactory.create<NestExpressApplication>(BureauE2eModule, { rawBody: true, logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.init();
  prisma = app.get(PrismaService);
});
afterAll(async () => {
  await prisma.customer.deleteMany({ where: { id: { in: created } } }); // cascades pulls, reports, risk flags
  await prisma.consent.deleteMany({ where: { subjectId: { in: created } } });
  await app.close();
});

describe('bureau', () => {
  let manager: Client; let officer: Client;
  beforeAll(async () => { manager = await login('risk.manager@damez.ng'); officer = await login('officer@damez.ng'); });

  it('consent gate, caching, forced re-pull and usage', async () => {
    const id = await makeCustomer(0);
    const blocked = await manager.post(`/customers/${id}/bureau/pull`);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: 'CONSENT_REQUIRED', purpose: 'BUREAU_PULL' });
    let pulls = (await manager.get(`/customers/${id}/bureau/pulls`).expect(200)).body as { bureau: string; status: string; costKobo: number; customerName: string }[];
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({ bureau: 'ALL', status: 'BLOCKED_NO_CONSENT', costKobo: 0 });
    expect(pulls[0].customerName).toBe('Bureau T•••');

    await grant(id);
    const first = (await manager.post(`/customers/${id}/bureau/pull`).expect(200)).body;
    expect(first.reason).toBe('ON_DEMAND');
    expect(first.bureausQueried).toEqual(['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY']);
    expect(first.scores).toHaveLength(3);
    expect(first.summary.thinFile).toBe(false);
    expect(first.facilities[0].history.length).toBeGreaterThan(0);

    const second = (await manager.post(`/customers/${id}/bureau/pull`).expect(200)).body;
    expect(second.id).toBe(first.id);
    const forced = (await manager.post(`/customers/${id}/bureau/pull`, { force: true }).expect(200)).body;
    expect(forced.id).not.toBe(first.id);

    pulls = (await manager.get(`/customers/${id}/bureau/pulls`).expect(200)).body;
    const cached = pulls.filter((p) => p.status === 'CACHED');
    expect(cached).toHaveLength(1);
    expect(cached[0].costKobo).toBe(0);
    const billable = pulls.filter((p) => p.status === 'SUCCESS' || p.status === 'NO_HIT');
    expect(billable).toHaveLength(6);
    const cost = billable.reduce((a, p) => a + p.costKobo, 0);
    expect(cost).toBeGreaterThan(0);

    const usage = (await manager.get('/bureau/usage').expect(200)).body;
    expect(usage.totalCostKobo).toBeGreaterThanOrEqual(cost);
    expect(usage.billablePulls).toBeGreaterThanOrEqual(6);
    expect(usage.cacheHits).toBeGreaterThanOrEqual(1);
    expect(usage.blockedNoConsent).toBeGreaterThanOrEqual(1);
    expect(usage.byBureau.map((b: { bureau: string }) => b.bureau)).toEqual(['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY']);
    expect(Array.isArray(usage.daily)).toBe(true);

    const log = (await manager.get('/bureau/pulls?pageSize=5&status=CACHED').expect(200)).body;
    expect(log.items.every((p: { status: string }) => p.status === 'CACHED')).toBe(true);

    // reads: latest, history, by id; each view is audited with the viewer
    const latest = (await manager.get(`/customers/${id}/bureau`).expect(200)).body;
    expect(latest.id).toBe(forced.id);
    expect((await manager.get(`/customers/${id}/bureau/history`).expect(200)).body).toHaveLength(2);
    await manager.get(`/customers/${id}/bureau/reports/${first.id}`).expect(200);
    await manager.get(`/customers/other-customer/bureau/reports/${first.id}`).expect(404);
    const viewed = await prisma.auditLog.count({ where: { action: 'bureau.report_viewed', resourceId: id } });
    expect(viewed).toBeGreaterThanOrEqual(2);
    expect(await prisma.auditLog.count({ where: { action: 'bureau.pulled', resourceId: id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'bureau.pull_blocked', resourceId: id } })).toBe(1);
  });

  it('profiles drive the summary', async () => {
    const pull = async (tens: number) => { const id = await makeCustomer(tens); await grant(id); return { id, r: (await manager.post(`/customers/${id}/bureau/pull`).expect(200)).body }; };
    const wo = await pull(5);
    expect(wo.r.summary.hasWriteOff24m).toBe(true);
    expect(wo.r.summary.writeOffCount).toBe(1);
    const fraud = await pull(7);
    expect(fraud.r.summary.fraudFlag).toBe(true);
    expect(fraud.r.flags.length).toBeGreaterThan(0);
    expect(await prisma.customerRiskFlag.count({ where: { customerId: fraud.id, type: 'FRAUD_WATCHLIST', source: 'BUREAU_PULL', active: true } })).toBe(1);
    const thin = await pull(2);
    expect(thin.r.summary.thinFile).toBe(true);
    const bad = await pull(4);
    expect(bad.r.summary.elsewhereDefault).toBe(true);
    expect(await prisma.customerRiskFlag.count({ where: { customerId: bad.id, type: 'ELSEWHERE_DEFAULT', active: true } })).toBe(1);
  });

  it('dataset endpoints respond with the contract shapes', async () => {
    const d = (await manager.get('/bureau/distribution').expect(200)).body;
    expect(d.bands.map((b: { label: string }) => b.label)).toEqual(['Poor', 'Fair', 'Good', 'Very good', 'Excellent']);
    expect(d.totalCustomers).toBeGreaterThan(0);
    expect(typeof d.elsewhereDefaultPct).toBe('number');
    const s = (await manager.get('/bureau/submissions').expect(200)).body;
    expect(s).toMatchObject({ page: 1 });
    const a = (await manager.get('/bureau/monitoring/alerts').expect(200)).body;
    expect(Array.isArray(a.items)).toBe(true);
  });

  it('enforces permissions', async () => {
    const id = created[0];
    await officer.post(`/customers/${id}/bureau/pull`).expect(403);
    await officer.get(`/customers/${id}/bureau`).expect(403);
    await officer.get('/bureau/usage').expect(403);
    await officer.post('/bureau/monitoring/run').expect(403);
    await manager.get('/bureau/usage').expect(200);
  });
});
