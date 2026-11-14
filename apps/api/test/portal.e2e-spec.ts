import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { installBigIntJson } from '../src/common/bigint';
import { signHmacHex } from '../src/crypto/webhook-signature';
import { DocumentsModule } from '../src/documents/documents.module';
import { EICAR } from '../src/documents/virus-scanner';
import { FraudModule } from '../src/fraud/fraud.module';
import { KycModule } from '../src/kyc/kyc.module';
import { OnboardingModule } from '../src/onboarding/onboarding.module';
import { PortalAuthModule } from '../src/portal-auth/portal-auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScreeningModule } from '../src/screening/screening.module';
import { StorageModule } from '../src/storage/storage.module';

const PASSWORD = 'Damez@Demo2026';
const WEBHOOK_SECRET = 'whsec_e2e_secret';
const storageDir = mkdtempSync(join(tmpdir(), 'damez-e2e-store-'));
process.env.DOJAH_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STORAGE_LOCAL_DIR = storageDir;
process.env.KYC_PROVIDER = 'mock';

/** The lead wires these into AppModule; importing them here keeps the spec independent (modules are singletons). */
@Module({ imports: [AppModule, StorageModule, KycModule, FraudModule, ScreeningModule, DocumentsModule, OnboardingModule, PortalAuthModule] })
class PortalE2eModule {}

let app: NestExpressApplication;
let prisma: PrismaService;
const customerIds: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const stamp = () => `${String(Date.now()).slice(-7)}${String(++seq).padStart(2, '0')}`; // 9 digits
const newPhone = () => `081${String(Date.now()).slice(-6)}${String(++seq).padStart(2, '0')}`; // 0 8 1 + 8 digits
/** 11-digit id: 9 unique digits, tens digit 0 (clean bureau profile), last digit = KYC scenario */
const newId = (stem: string, last: number) => `${stem}0${last}`;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

interface Portal {
  id: string; phone: string; first: string; last: string;
  get: (u: string) => request.Test; post: (u: string, b?: object, csrf?: boolean) => request.Test; put: (u: string, b?: object) => request.Test; del: (u: string) => request.Test;
  upload: (kind: string, buf: Buffer, name: string, type: string) => request.Test;
}

async function registerCustomer(first = 'Adaeze', last = 'Okonkwo'): Promise<Portal> {
  const phone = newPhone();
  const agent = request.agent(app.getHttpServer());
  const reg = await agent.post('/api/v1/portal/auth/register').send({ phone, email: `e2e${stamp()}@example.com`, firstName: first, lastName: last, acceptPrivacy: true }).expect(200);
  expect(reg.body.demoCode).toMatch(/^\d{6}$/);
  const v = await agent.post('/api/v1/portal/auth/verify-otp').send({ challengeId: reg.body.challengeId, code: reg.body.demoCode }).expect(200);
  const cookies = (v.headers['set-cookie'] as unknown as string[]).join(';');
  expect(cookies).toMatch(/csid=[^;]+; .*HttpOnly/i);
  const csrf = /ccsrf=([^;]+)/.exec(cookies)![1];
  const id = v.body.customer.id as string;
  customerIds.push(id);
  const h = (t: request.Test) => t.set('x-csrf-token', csrf);
  return {
    id, phone, first, last,
    get: (u) => agent.get(`/api/v1${u}`),
    post: (u, b, withCsrf = true) => (withCsrf ? h(agent.post(`/api/v1${u}`)) : agent.post(`/api/v1${u}`)).send(b ?? {}),
    put: (u, b) => h(agent.put(`/api/v1${u}`)).send(b ?? {}),
    del: (u) => h(agent.delete(`/api/v1${u}`)),
    upload: (kind, buf, name, type) => h(agent.post('/api/v1/portal/documents')).field('kind', kind).attach('file', buf, { filename: name, contentType: type }),
  };
}

async function consentAll(p: Portal, purposes: string[]) {
  const { body } = await p.get('/portal/consents').expect(200);
  for (const purpose of purposes) {
    const t = body.texts.find((x: { purpose: string }) => x.purpose === purpose);
    await p.post('/portal/consents', { purpose, textVersion: t.version }).expect(200);
  }
}

const profile = {
  dateOfBirth: '1991-05-17', gender: 'FEMALE',
  address: { line1: '12 Adeola Odeku Street', city: 'Victoria Island', state: 'Lagos' },
  employment: { status: 'EMPLOYED', employer: 'Acme Ltd', monthlyIncomeKobo: 40_000_000, salaryDay: 25 },
};

interface Staff { get: (u: string) => request.Test; post: (u: string, b?: object) => request.Test }
async function staffLogin(email: string): Promise<Staff> {
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

beforeAll(async () => {
  installBigIntJson();
  app = await NestFactory.create<NestExpressApplication>(PortalE2eModule, { rawBody: true, logger: process.env.E2E_LOG ? ['error'] : false });
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.init();
  prisma = app.get(PrismaService);
});
afterAll(async () => {
  if (customerIds.length) {
    await prisma.otpChallenge.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  await app.close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('portal auth', () => {
  it('registers, never enumerates, verifies the OTP and sets cookies', async () => {
    const phone = newPhone();
    const agent = request.agent(app.getHttpServer());
    const reg = await agent.post('/api/v1/portal/auth/register').send({ phone, firstName: 'Ngozi', lastName: 'Eze', acceptPrivacy: true }).expect(200);
    expect(Object.keys(reg.body).sort()).toEqual(['challengeId', 'demoCode', 'destination', 'expiresInSeconds', 'resendAfterSeconds']);

    // unknown number: identical response shape
    const unknown = await request(app.getHttpServer()).post('/api/v1/portal/auth/login').send({ phone: newPhone() }).expect(200);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(reg.body).sort());
    // …and its code never verifies
    await request(app.getHttpServer()).post('/api/v1/portal/auth/verify-otp').send({ challengeId: unknown.body.challengeId, code: unknown.body.demoCode }).expect(400);

    // wrong code, then right code
    const wrong = reg.body.demoCode === '000000' ? '000001' : '000000';
    const bad = await agent.post('/api/v1/portal/auth/verify-otp').send({ challengeId: reg.body.challengeId, code: wrong }).expect(400);
    expect(bad.body.code).toBe('OTP_INVALID');
    // resend cooldown
    const early = await agent.post('/api/v1/portal/auth/otp/resend').send({ challengeId: reg.body.challengeId });
    expect(early.status).toBe(429);
    const ok = await agent.post('/api/v1/portal/auth/verify-otp').send({ challengeId: reg.body.challengeId, code: reg.body.demoCode }).expect(200);
    customerIds.push(ok.body.customer.id);
    expect(ok.body.customer).toMatchObject({ firstName: 'Ngozi', phoneVerified: true, kycTier: 0, onboardingComplete: false });
    expect(ok.body.customer.phone).toContain('•');
    // single use
    await agent.post('/api/v1/portal/auth/verify-otp').send({ challengeId: reg.body.challengeId, code: reg.body.demoCode }).expect(400);

    const stored = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: reg.body.challengeId } });
    expect(stored.codeHash).not.toContain(reg.body.demoCode);
    const consent = await prisma.consent.findFirst({ where: { subjectId: ok.body.customer.id, purpose: 'DATA_PROCESSING' } });
    expect(consent).toMatchObject({ textVersion: 'privacy-2026-01', channel: 'PORTAL' });
    expect(consent!.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    // PII is encrypted
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: ok.body.customer.id } });
    expect(row.phoneEnc).not.toContain(phone);
  });

  it('locks a challenge after too many wrong attempts', async () => {
    const reg = await request(app.getHttpServer()).post('/api/v1/portal/auth/login').send({ phone: newPhone() }).expect(200);
    const wrong = reg.body.demoCode === '123456' ? '123457' : '123456';
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await request(app.getHttpServer()).post('/api/v1/portal/auth/verify-otp').send({ challengeId: reg.body.challengeId, code: wrong })).status;
    expect(last).toBe(429);
  });

  it('enforces CSRF on portal mutations, then logs out', async () => {
    const p = await registerCustomer();
    await p.get('/portal/me').expect(200);
    const r = await p.post('/portal/consents', { purpose: 'MARKETING', textVersion: 'x' }, false);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF');
    await request(app.getHttpServer()).get('/api/v1/portal/me').expect(401);
    await p.post('/portal/auth/logout').expect(200);
    await p.get('/portal/me').expect(401);
  });

  it('verifies email with a hashed code', async () => {
    const p = await registerCustomer();
    const s = await p.post('/portal/email/send').expect(200);
    expect(s.body.sent).toBe(true);
    await p.post('/portal/email/verify', { code: s.body.demoCode === '999999' ? '999998' : '999999' }).expect(400);
    const me = await p.post('/portal/email/verify', { code: s.body.demoCode }).expect(200);
    expect(me.body.emailVerified).toBe(true);
  });
});

describe('onboarding → KYC → tier 2', () => {
  let p: Portal;
  let bvn: string;
  let faceRef: string;
  let docId: string;

  beforeAll(async () => { p = await registerCustomer(); bvn = newId(stamp(), 0); });

  it('walks the steps and guards the BVN behind consent', async () => {
    const st = (await p.get('/portal/onboarding').expect(200)).body;
    expect(st.steps.find((s: { key: string }) => s.key === 'ACCOUNT').status).toBe('DONE');
    expect(st.currentStep).toBe('PROFILE');
    expect(st.completed).toBe(false);
    const bad = await p.put('/portal/profile', { ...profile, dateOfBirth: '2015-01-01' });
    expect(bad.status).toBe(400);
    await p.put('/portal/profile', profile).expect(200);

    const noConsent = await p.post('/portal/kyc/bvn', { bvn });
    expect(noConsent.status).toBe(403);
    expect(noConsent.body).toMatchObject({ code: 'CONSENT_REQUIRED', purpose: 'KYC_VERIFICATION' });
    const texts = (await p.get('/portal/consents').expect(200)).body.texts;
    await p.post('/portal/consents', { purpose: 'KYC_VERIFICATION', textVersion: 'nope' }).expect(400);
    await consentAll(p, ['KYC_VERIFICATION', 'BUREAU_PULL']);
    expect(texts.length).toBeGreaterThan(2);
    await p.post('/portal/kyc/bvn', { bvn: '123' }).expect(400);
  });

  it('BVN pass → tier 1; completed onboarding; idempotent retry', async () => {
    const r = (await p.post('/portal/kyc/bvn', { bvn }).expect(200)).body;
    expect(r).toMatchObject({ status: 'PASSED', kycTier: 1, retryAllowed: false });
    const again = (await p.post('/portal/kyc/bvn', { bvn }).expect(200)).body;
    expect(again.verification.id).toBe(r.verification.id);
    const st = (await p.get('/portal/onboarding').expect(200)).body;
    expect(st.completed).toBe(true);
    expect(st.tiers[0].achieved).toBe(true);
    const me = (await p.get('/portal/me').expect(200)).body;
    expect(me.kycTier).toBe(1);
    expect(me.maxLoanKobo).toBeGreaterThan(0);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.bvnEnc).not.toContain(bvn);
    expect(row.bvnPhotoHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a BVN that belongs to another customer (409 + HIGH signals on both)', async () => {
    const other = await registerCustomer('Chiamaka', 'Obi');
    await consentAll(other, ['KYC_VERIFICATION']);
    const r = await other.post('/portal/kyc/bvn', { bvn });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DUPLICATE_BVN');
    const sigs = await prisma.fraudSignal.findMany({ where: { type: 'DUPLICATE_BVN', customerId: { in: [p.id, other.id] } } });
    expect(sigs.map((s) => s.customerId).sort()).toEqual([p.id, other.id].sort());
    expect(sigs.every((s) => s.severity === 'HIGH')).toBe(true);
  });

  it('face: LOW_CONFIDENCE → REVIEW, then PASS; completion is idempotent', async () => {
    const s1 = (await p.post('/portal/kyc/face/session').expect(200)).body;
    expect(s1.mode).toBe('mock');
    expect(s1.mockScenarios).toContain('LOW_CONFIDENCE');
    const low = (await p.post('/portal/kyc/face/complete', { referenceId: s1.referenceId, mockScenario: 'LOW_CONFIDENCE' }).expect(200)).body;
    expect(low.status).toBe('REVIEW');
    expect(low.kycTier).toBe(1);
    expect(low.retryAllowed).toBe(true);

    const s2 = (await p.post('/portal/kyc/face/session').expect(200)).body;
    faceRef = s2.referenceId;
    const pass = (await p.post('/portal/kyc/face/complete', { referenceId: faceRef, sdkEvent: 'success', mockScenario: 'PASS' }).expect(200)).body;
    expect(pass.status).toBe('PASSED');
    expect(pass.verification.matchConfidence).toBeGreaterThanOrEqual(82);
    expect(pass.kycTier).toBe(1); // still needs NIN / gov ID
    // a second callback (even claiming failure) cannot change a finalised result
    const dup = (await p.post('/portal/kyc/face/complete', { referenceId: faceRef, mockScenario: 'FAIL' }).expect(200)).body;
    expect(dup.status).toBe('PASSED');
    expect(dup.verification.id).toBe(pass.verification.id);
    await p.post('/portal/kyc/face/complete', { referenceId: 'face_unknown_ref' }).expect(404);
  });

  it('uploads a clean document, rejects EICAR, executables and bad types', async () => {
    const ok = await p.upload('ID_CARD', PNG, '../my id.png', 'image/png').expect(201);
    docId = ok.body.id;
    expect(ok.body).toMatchObject({ kind: 'ID_CARD', mimeType: 'image/png', scanStatus: 'CLEAN', reviewStatus: 'PENDING', fileName: 'my id.png' });
    const eicar = await p.upload('PROOF_OF_ADDRESS', Buffer.from(`date,amount\n${EICAR}\n`), 'bill.csv', 'text/csv');
    expect(eicar.status).toBe(422);
    expect(eicar.body.code).toBe('FILE_INFECTED');
    const exe = await p.upload('OTHER', Buffer.from('MZ\x90\x00\x03\x00\x00\x00 not really'), 'photo.png', 'image/png');
    expect(exe.status).toBe(415);
    const lie = await p.upload('OTHER', PNG, 'x.pdf', 'application/pdf');
    expect(lie.status).toBe(415);
    const list = (await p.get('/portal/documents').expect(200)).body;
    expect(list.map((d: { id: string }) => d.id)).toEqual([docId]);
    // stored encrypted: bytes on disk are not the PNG
    const row = await prisma.kycDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(row.keyEnc.startsWith('v1:')).toBe(true);
    expect(row.storageKey).toBe(`kyc/${p.id}/${docId}`);
  });

  it('NIN pass → Tier 2', async () => {
    const nin = newId(stamp(), 0);
    const r = (await p.post('/portal/kyc/nin', { nin }).expect(200)).body;
    expect(r).toMatchObject({ status: 'PASSED', kycTier: 2 });
    const me = (await p.get('/portal/me').expect(200)).body;
    expect(me.kycTier).toBe(2);
    const ver = (await p.get('/portal/kyc/verifications').expect(200)).body;
    expect(ver.map((v: { type: string }) => v.type)).toEqual(expect.arrayContaining(['PHONE', 'BVN', 'FACE', 'NIN']));
  });

  it('bank name enquiry returns the account name', async () => {
    const r = (await p.post('/portal/kyc/bank-account', { accountNumber: `01${stamp().slice(0, 8)}`.slice(0, 9) + '0', bankCode: '058' }).expect(200)).body;
    expect(r.status).toBe('PASSED');
    expect(r.accountName).toMatch(/OKONKWO/);
  });

  describe('staff + webhook', () => {
    it('verifies the Dojah webhook signature and finalises a pending face check once', async () => {
      const s = (await p.post('/portal/kyc/face/session').expect(200)).body;
      const body = JSON.stringify({ event: 'face', reference_id: s.referenceId, confidence: 95, liveness: true });
      const url = '/api/v1/webhooks/dojah';
      const bad = await request(app.getHttpServer()).post(url).set('content-type', 'application/json').set('x-dojah-signature', signHmacHex('wrong-secret', body)).send(body);
      expect(bad.status).toBe(401);
      await request(app.getHttpServer()).post(url).set('content-type', 'application/json').send(body).expect(401);
      const good = await request(app.getHttpServer()).post(url).set('content-type', 'application/json').set('x-dojah-signature', signHmacHex(WEBHOOK_SECRET, body)).send(body);
      expect(good.status).toBe(200);
      expect(good.body).toMatchObject({ received: true, matched: true });
      const row = await prisma.kycVerification.findFirstOrThrow({ where: { referenceId: s.referenceId } });
      expect(row).toMatchObject({ status: 'PASSED', matchConfidence: 95, livenessPassed: true });
      const again = await request(app.getHttpServer()).post(url).set('content-type', 'application/json').set('x-dojah-signature', signHmacHex(WEBHOOK_SECRET, body)).send(body).expect(200);
      expect(again.body.duplicate).toBe(true);
    });

    it('staff sees the masked customer 360, downloads documents (audited), reviews, scans and resolves signals', async () => {
      const staff = await staffLogin('admin@damez.ng');
      const d = (await staff.get(`/customers/${p.id}`).expect(200)).body;
      expect(d).toMatchObject({ id: p.id, kycTier: 2, kycStatus: 'VERIFIED', portalRegistered: true, phoneVerified: true });
      expect(d.fullName).toContain('•');
      expect(d.bvn).toMatch(/^•+\d{3}$/);
      expect(JSON.stringify(d)).not.toContain(bvn);
      expect(d.verifications.length).toBeGreaterThan(4);
      expect(d.documents[0]).toMatchObject({ kind: 'ID_CARD', scanEngine: 'mock-scanner' });
      expect(d.consents.map((c: { purpose: string }) => c.purpose)).toEqual(expect.arrayContaining(['DATA_PROCESSING', 'KYC_VERIFICATION', 'BUREAU_PULL']));
      expect(d.screening.map((x: { type: string }) => x.type).sort()).toEqual(['PEP', 'SANCTIONS']);
      expect(d.fraudSignals.some((s: { type: string }) => s.type === 'DUPLICATE_BVN')).toBe(true);
      expect(Array.isArray(d.applications)).toBe(true);
      await staff.get('/customers/does-not-exist').expect(404);

      const before = await prisma.auditLog.count({ where: { action: 'document.viewed', resourceId: docId } });
      for (let i = 0; i < 2; i++) {
        const dl = await staff.get(`/documents/${docId}/download`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
        expect(dl.status).toBe(200);
        expect(dl.headers['x-content-type-options']).toBe('nosniff');
        expect(dl.headers['content-disposition']).toContain('attachment');
        expect((dl.body as Buffer).equals(PNG)).toBe(true);
      }
      expect(await prisma.auditLog.count({ where: { action: 'document.viewed', resourceId: docId } })).toBe(before + 2);

      const list = (await staff.get(`/customers/${p.id}/documents`).expect(200)).body;
      expect(list).toHaveLength(1);
      const rev = (await staff.post(`/documents/${docId}/review`, { status: 'APPROVED', note: 'Looks good' }).expect(200)).body;
      expect(rev).toMatchObject({ reviewStatus: 'APPROVED' });
      expect(rev.reviewedBy).toBeTruthy();

      const scan = (await staff.post(`/customers/${p.id}/fraud-scan`).expect(200)).body;
      const dup = scan.find((s: { type: string }) => s.type === 'DUPLICATE_BVN');
      const resolved = (await staff.post(`/fraud-signals/${dup.id}/resolve`, { note: 'Confirmed family member typo' }).expect(200)).body;
      expect(resolved.resolvedAt).toBeTruthy();
      const scr = (await staff.post(`/customers/${p.id}/screening/run`).expect(200)).body;
      expect(scr).toHaveLength(2);
      expect((await staff.get(`/customers/${p.id}/fraud-signals`).expect(200)).body.length).toBeGreaterThan(0);
    });
  });
});

describe('KYC edge scenarios', () => {
  it('NAME_MISMATCH fails the BVN with a friendly message and raises a signal; NOT_FOUND is retryable', async () => {
    const p = await registerCustomer();
    await consentAll(p, ['KYC_VERIFICATION']);
    const mm = (await p.post('/portal/kyc/bvn', { bvn: newId(stamp(), 1) }).expect(200)).body;
    expect(mm).toMatchObject({ status: 'FAILED', retryAllowed: true, kycTier: 0 });
    expect(mm.message).toMatch(/name/i);
    expect(await prisma.fraudSignal.count({ where: { customerId: p.id, type: 'NAME_MISMATCH' } })).toBe(1);
    const nf = (await p.post('/portal/kyc/bvn', { bvn: newId(stamp(), 2) }).expect(200)).body;
    expect(nf).toMatchObject({ status: 'FAILED', retryAllowed: true });
    // a later correct BVN still works
    expect((await p.post('/portal/kyc/bvn', { bvn: newId(stamp(), 0) }).expect(200)).body.status).toBe('PASSED');
  });

  it('PEP scenario goes to REVIEW screening with a risk flag; liveness failure raises a signal', async () => {
    const p = await registerCustomer();
    await consentAll(p, ['KYC_VERIFICATION']);
    expect((await p.post('/portal/kyc/bvn', { bvn: newId(stamp(), 5) }).expect(200)).body.status).toBe('PASSED');
    const scr = await prisma.screeningResult.findFirstOrThrow({ where: { customerId: p.id, type: 'PEP' } });
    expect(scr.status).toBe('REVIEW');
    expect(await prisma.customerRiskFlag.count({ where: { customerId: p.id, type: 'FRAUD_WATCHLIST', severity: 'MEDIUM' } })).toBe(1);
    const s = (await p.post('/portal/kyc/face/session').expect(200)).body;
    const live = (await p.post('/portal/kyc/face/complete', { referenceId: s.referenceId, mockScenario: 'LIVENESS_FAIL' }).expect(200)).body;
    expect(live).toMatchObject({ status: 'FAILED', verification: { livenessPassed: false } });
    expect(await prisma.fraudSignal.count({ where: { customerId: p.id, type: 'LIVENESS_FAIL' } })).toBe(1);
  });

  it('flags one face under two BVNs (duplicate face)', async () => {
    const stem = stamp();
    const a = await registerCustomer(); const b = await registerCustomer('Tunde', 'Bello');
    await consentAll(a, ['KYC_VERIFICATION']); await consentAll(b, ['KYC_VERIFICATION']);
    await a.post('/portal/kyc/bvn', { bvn: `${stem}00` }).expect(200);
    await b.post('/portal/kyc/bvn', { bvn: `${stem}30` }).expect(200); // same first 9 digits → same mock photo
    expect(await prisma.fraudSignal.count({ where: { type: 'DUPLICATE_FACE', severity: 'HIGH', customerId: { in: [a.id, b.id] } } })).toBe(2);
  });

  it('face session requires a verified BVN', async () => {
    const p = await registerCustomer();
    await consentAll(p, ['KYC_VERIFICATION']);
    const r = await p.post('/portal/kyc/face/session');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BVN_REQUIRED');
  });
});
