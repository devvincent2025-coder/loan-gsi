/* Phase 2 seed: product pricing, KYC tiers/verifications, consents, screening, fraud signals, document metadata,
 * demo portal customers, bureau reports + pull log/costs, applications in every state (via the REAL pipeline), furnishing and
 * monitoring history. Boots the Nest application context so seeded data goes through the same services as production.
 * Idempotent: guarded by "already has applications". Run after prisma/seed.ts (npm run db:seed does both). */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { APPROVAL_ACTION_TYPES, DEFAULT_TIER_LOAN_CAPS_KOBO } from '@damez/shared';
import { AppModule } from '../src/app.module';
import { ApplicationPipeline } from '../src/applications/application-pipeline';
import { ApplicationsService } from '../src/applications/applications.service';
import { pricingFromProduct } from '../src/applications/mappers';
import { BureauFurnishingService } from '../src/bureau/bureau-furnishing';
import { BureauMonitoringService } from '../src/bureau/bureau-monitoring';
import { BureauService } from '../src/bureau/bureau.service';
import { FieldCipher } from '../src/crypto/field-cipher';
import { EligibilityService } from '../src/eligibility/eligibility.service';
import { CustomerPii } from '../src/kyc/customer-pii';
import { PrismaService } from '../src/prisma/prisma.service';

let seed = 77001;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRODUCT_PRICING: Record<string, Record<string, unknown>> = {
  'SAL-ADV': { description: 'A small advance on your salary, repaid within 1-3 months.', interestMethod: 'FLAT', monthlyRateBps: 400, managementFeeBps: 100, insuranceFeeBps: 50, penaltyBpsPerDay: 25, penaltyGraceDays: 3, minKycTier: 1, requiredDocs: ['ID_CARD', 'PAYSLIP'], maxAge: 60, allowGuarantor: false },
  PERS: { description: 'Flexible personal loan for life\'s plans, repaid monthly on reducing balance.', interestMethod: 'REDUCING_BALANCE', monthlyRateBps: 450, managementFeeBps: 100, insuranceFeeBps: 50, penaltyBpsPerDay: 25, penaltyGraceDays: 3, minKycTier: 1, requiredDocs: ['ID_CARD', 'PROOF_OF_ADDRESS'], allowGuarantor: true },
  'CIVIL-GSI': { description: 'Low-rate loan for civil servants, repaid by standing instruction on salary.', interestMethod: 'REDUCING_BALANCE', monthlyRateBps: 350, managementFeeBps: 75, insuranceFeeBps: 50, penaltyBpsPerDay: 20, penaltyGraceDays: 5, minKycTier: 2, requiredDocs: ['ID_CARD', 'PAYSLIP', 'PROOF_OF_ADDRESS'], allowGuarantor: true },
  'SME-WC': { description: 'Working capital for small businesses with 6 months of bank statements.', interestMethod: 'REDUCING_BALANCE', monthlyRateBps: 500, managementFeeBps: 150, insuranceFeeBps: 50, processingFeeBps: 50, penaltyBpsPerDay: 30, penaltyGraceDays: 3, minKycTier: 2, requiredDocs: ['ID_CARD', 'PROOF_OF_ADDRESS', 'BANK_STATEMENT'], allowGuarantor: true, allowCollateral: true },
  DEVICE: { description: 'Buy a phone or laptop today and pay over 3-9 months.', interestMethod: 'FLAT', monthlyRateBps: 500, managementFeeBps: 100, insuranceFeeBps: 100, penaltyBpsPerDay: 25, penaltyGraceDays: 3, minKycTier: 1, requiredDocs: ['ID_CARD'], allowGuarantor: false },
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const cipher = app.get(FieldCipher);
  const pii = app.get(CustomerPii);
  const bureau = app.get(BureauService);
  const applications = app.get(ApplicationsService);
  const pipeline = app.get(ApplicationPipeline);
  const eligibility = app.get(EligibilityService);

  // ── products (idempotent upsert of the Phase 2 fields) ──
  for (const [code, data] of Object.entries(PRODUCT_PRICING)) {
    await prisma.loanProduct.updateMany({ where: { code }, data: data as Prisma.LoanProductUpdateManyMutationInput });
  }
  // approval policies for any newly added types (SCORECARD_ACTIVATION)
  for (const t of APPROVAL_ACTION_TYPES) await prisma.approvalPolicy.upsert({ where: { type: t }, create: { type: t, thresholdKobo: 0n, enabled: true }, update: {} });

  if ((await prisma.loanApplication.count()) > 0) {
    console.log('Phase 2 seed: applications already present, skipping demo data.');
    await app.close();
    return;
  }
  console.log('Seeding Phase 2 demo data…');
  const products = await prisma.loanProduct.findMany();
  const prodByCode = new Map(products.map((p) => [p.code, p]));
  const branches = await prisma.branch.findMany();
  const ikeja = branches.find((b) => b.code === 'LOS-IKJ')!;
  const officer = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'officer@damez.ng' } });
  const analyst = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'analyst@damez.ng' } });
  const bureauCosts = ((await prisma.systemSetting.findUnique({ where: { key: 'bureau.costs_kobo' } }))?.value ?? { CRC: 15000, FIRSTCENTRAL: 12000, CREDITREGISTRY: 10000 }) as Record<string, number>;

  // ── KYC enrichment for existing customers ──
  const customers = await prisma.customer.findMany({ orderBy: { id: 'asc' } });
  const STATE_CITY: Record<string, string> = { Lagos: 'Ikeja', Ogun: 'Abeokuta', FCT: 'Abuja', Nasarawa: 'Karu', Rivers: 'Port Harcourt', Bayelsa: 'Yenagoa', Oyo: 'Ibadan', Osun: 'Osogbo', Enugu: 'Enugu', Anambra: 'Awka', Kano: 'Kano', Katsina: 'Katsina', Kaduna: 'Kaduna', Niger: 'Minna' };
  const tiers = new Map<string, number>();
  for (const [i, c] of customers.entries()) {
    const verified = c.kycStatus === 'VERIFIED';
    const tier = verified ? [1, 2, 2, 3][i % 4] : 0;
    tiers.set(c.id, tier);
    const age = between(23, 57);
    const dob = `${new Date().getUTCFullYear() - age}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`;
    const emp = c.employer ?? '';
    const employmentStatus = /Self-employed/.test(emp) ? 'SELF_EMPLOYED' : /Government|Civil|SUBEB|Police/.test(emp) ? 'CIVIL_SERVANT' : 'EMPLOYED';
    const bvn = c.bvnEnc ? cipher.decrypt(c.bvnEnc, `customer:${c.id}:bvn`) : '';
    const t0 = c.createdAt;
    await prisma.customer.update({
      where: { id: c.id },
      data: {
        kycTier: tier, gender: i % 2 ? 'FEMALE' : 'MALE', dobEnc: cipher.encrypt(dob, `customer:${c.id}:dob`), birthYear: new Date().getUTCFullYear() - age,
        addressEnc: cipher.encrypt(JSON.stringify({ line1: `${between(1, 90)} ${pick(['Adeola', 'Allen', 'Ahmadu Bello', 'Aba', 'Herbert Macaulay', 'Zik'])} Road`, city: STATE_CITY[c.state ?? 'Lagos'] ?? 'Lagos', state: c.state ?? 'Lagos' }), `customer:${c.id}:address`),
        city: STATE_CITY[c.state ?? 'Lagos'] ?? null, employmentStatus, phoneVerifiedAt: t0, portalRegisteredAt: i % 2 === 0 ? t0 : null,
        bvnVerifiedAt: tier >= 1 ? t0 : null, bvnPhotoHash: bvn ? sha(bvn.slice(0, 9)) : null, ninVerifiedAt: tier >= 2 ? t0 : null,
        faceVerifiedAt: tier >= 2 ? t0 : null, addressVerifiedAt: tier >= 3 ? t0 : null, bankVerifiedAt: tier >= 1 ? t0 : null, emailVerifiedAt: i % 3 === 0 ? t0 : null,
      },
    });
    const v = (type: string, status: string, summary: string, extra: Partial<{ conf: number; live: boolean; provider: string }> = {}) =>
      prisma.kycVerification.create({ data: { customerId: c.id, type, provider: extra.provider ?? 'dojah-mock', status, summary, referenceId: `seed-${c.id}-${type}`, matchConfidence: extra.conf ?? null, livenessPassed: extra.live ?? null, createdAt: t0, completedAt: t0 } });
    await v('PHONE', 'PASSED', 'Phone number verified by one-time code', { provider: 'otp' });
    if (tier >= 1) { await v('BVN', 'PASSED', 'BVN verified; name matches', { conf: between(92, 100) }); await v('BANK_ACCOUNT', 'PASSED', 'Account name matches'); }
    else if (c.kycStatus === 'REJECTED') await v('BVN', 'FAILED', 'BVN name does not match the registered name', { conf: between(30, 55) });
    if (tier >= 2) { await v('NIN', 'PASSED', 'NIN verified'); await v('FACE', 'PASSED', 'Liveness passed; face matches BVN photo', { conf: between(84, 98), live: true }); }
    if (tier >= 3) await v('ADDRESS', 'PASSED', 'Address verified');
    if (tier >= 1) {
      for (const [purpose, version] of [['DATA_PROCESSING', 'privacy-2026-01'], ['KYC_VERIFICATION', 'kyc-2026-01']] as const) {
        if (!(await prisma.consent.findFirst({ where: { subjectId: c.id, purpose } }))) await prisma.consent.create({ data: { subjectId: c.id, purpose, textVersion: version, channel: 'PORTAL', grantedAt: t0 } });
      }
      if (i % 5 !== 0 && !(await prisma.consent.findFirst({ where: { subjectId: c.id, purpose: 'BUREAU_PULL' } }))) {
        await prisma.consent.create({ data: { subjectId: c.id, purpose: 'BUREAU_PULL', textVersion: 'bureau-2026-01', channel: 'PORTAL', grantedAt: t0, expiresAt: new Date(Date.now() + 365 * DAY) } });
      }
      await prisma.screeningResult.create({ data: { customerId: c.id, type: 'SANCTIONS', provider: 'screening-mock', status: 'CLEAR', createdAt: t0 } });
      await prisma.screeningResult.create({ data: { customerId: c.id, type: 'PEP', provider: 'screening-mock', status: i % 37 === 0 ? 'REVIEW' : 'CLEAR', matchCount: i % 37 === 0 ? 1 : 0, createdAt: t0 } });
    }
    const doc = (kind: string, review: string) =>
      prisma.kycDocument.create({ data: { customerId: c.id, kind, fileName: `${kind.toLowerCase()}.pdf`, mimeType: 'application/pdf', sizeBytes: between(80_000, 900_000), sha256: sha(`${c.id}${kind}`), storageKey: 'seed/no-file', keyEnc: cipher.encrypt('seed', `doc:${c.id}`), scanStatus: 'CLEAN', scanEngine: 'mock-av', reviewStatus: review, reviewedById: review === 'PENDING' ? null : analyst.id, reviewedAt: review === 'PENDING' ? null : t0, uploadedAt: t0 } });
    if (tier >= 1) await doc('ID_CARD', 'APPROVED');
    if (tier >= 2) await doc('PAYSLIP', i % 3 === 0 ? 'PENDING' : 'APPROVED');
    if (tier >= 3) await doc('PROOF_OF_ADDRESS', 'APPROVED');
    if (tier >= 2 && i % 4 === 0) await doc('BANK_STATEMENT', 'APPROVED');
    if (c.portalRegisteredAt === null && i % 2 === 0) { /* noop */ }
    if (i % 2 === 0) await prisma.deviceFingerprint.create({ data: { customerId: c.id, fingerprint: sha(`device-${i}`).slice(0, 32), ip: `102.89.${between(1, 250)}.${between(1, 250)}`, userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/126', firstSeenAt: t0, lastSeenAt: t0 } });
  }

  // fraud signals (a believable handful)
  const verifiedIds = customers.filter((c) => (tiers.get(c.id) ?? 0) >= 1).map((c) => c.id);
  const [fa, fb, fc, fd, fe] = [verifiedIds[3], verifiedIds[9], verifiedIds[14], verifiedIds[21], verifiedIds[27]];
  await prisma.fraudSignal.createMany({
    data: [
      { customerId: fa, type: 'DUPLICATE_FACE', severity: 'HIGH', detail: 'The BVN photo matches another customer registered under a different BVN.', relatedCustomerId: fb, createdAt: ago(3) },
      { customerId: fb, type: 'DUPLICATE_FACE', severity: 'HIGH', detail: 'The BVN photo matches another customer registered under a different BVN.', relatedCustomerId: fa, createdAt: ago(3) },
      { customerId: fc, type: 'SHARED_DEVICE', severity: 'MEDIUM', detail: 'The same device was used to register 3 different customers.', createdAt: ago(5) },
      { customerId: fd, type: 'VELOCITY_REGISTRATION', severity: 'MEDIUM', detail: '4 registrations from one IP address within an hour.', createdAt: ago(8) },
      { customerId: fe, type: 'PHONE_BVN_MISMATCH', severity: 'LOW', detail: 'The phone on the BVN record differs from the verified phone.', createdAt: ago(10), resolvedAt: ago(9), resolvedById: analyst.id, resolutionNote: 'Customer changed SIM; confirmed by call-back.' },
    ],
  });

  // ── demo portal customers (see README) ──
  const mkDemo = async (o: { id: string; first: string; last: string; phone: string; email?: string; bvn?: string; nin?: string; tier: number; employer?: string; income?: number; salaryDay?: number; emp?: string; consentAll?: boolean }) => {
    const c = await prisma.customer.create({
      data: {
        id: o.id, branchId: ikeja.id, firstName: o.first, lastName: o.last, phoneEnc: pii.enc(o.id, 'phone', o.phone), phoneHash: pii.phoneHash(o.phone),
        emailEnc: o.email ? pii.enc(o.id, 'email', o.email) : null, emailHash: o.email ? pii.hash(o.email, 'email') : null,
        bvnEnc: o.bvn ? pii.enc(o.id, 'bvn', o.bvn) : null, bvnHash: o.bvn ? pii.hash(o.bvn, 'bvn') : null,
        ninEnc: o.nin ? pii.enc(o.id, 'nin', o.nin) : null, ninHash: o.nin ? pii.hash(o.nin, 'nin') : null,
        bvnPhotoHash: o.bvn ? sha(o.bvn.slice(0, 9)) : null, state: 'Lagos', city: 'Ikeja', employer: o.employer ?? null, employmentStatus: o.emp ?? null,
        monthlyIncomeKobo: o.income ? BigInt(o.income * 100) : null, salaryDay: o.salaryDay ?? null, kycTier: o.tier, kycStatus: o.tier ? 'VERIFIED' : 'PENDING', gender: 'FEMALE',
        dobEnc: o.tier ? pii.enc(o.id, 'dob', '1991-05-14') : null, addressEnc: o.tier ? pii.enc(o.id, 'address', JSON.stringify({ line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' })) : null, birthYear: o.tier ? 1991 : null, phoneVerifiedAt: new Date(), portalRegisteredAt: new Date(),
        emailVerifiedAt: o.email && o.tier ? new Date() : null, bvnVerifiedAt: o.tier ? new Date() : null, ninVerifiedAt: o.tier >= 2 ? new Date() : null, faceVerifiedAt: o.tier >= 2 ? new Date() : null,
        bankVerifiedAt: o.tier ? new Date() : null, retentionUntil: new Date(Date.now() + 6 * 365 * DAY),
      },
    });
    const ver = (type: string, summary: string, conf?: number) => prisma.kycVerification.create({ data: { customerId: c.id, type, provider: 'dojah-mock', status: 'PASSED', summary, referenceId: `demo-${c.id}-${type}`, matchConfidence: conf ?? null, livenessPassed: type === 'FACE' ? true : null, completedAt: new Date() } });
    await ver('PHONE', 'Phone number verified by one-time code');
    if (o.tier >= 1) { await ver('BVN', 'BVN verified; name matches', 100); await ver('BANK_ACCOUNT', 'Account name matches'); }
    if (o.tier >= 2) { await ver('NIN', 'NIN verified'); await ver('FACE', 'Liveness passed; face matches BVN photo', 93); }
    if (o.consentAll) {
      for (const [purpose, version] of [['DATA_PROCESSING', 'privacy-2026-01'], ['KYC_VERIFICATION', 'kyc-2026-01'], ['BUREAU_PULL', 'bureau-2026-01']] as const) {
        await prisma.consent.create({ data: { subjectId: c.id, purpose, textVersion: version, channel: 'PORTAL' } });
      }
    } else await prisma.consent.create({ data: { subjectId: c.id, purpose: 'DATA_PROCESSING', textVersion: 'privacy-2026-01', channel: 'PORTAL' } });
    if (o.tier >= 2) for (const kind of ['ID_CARD', 'PAYSLIP']) {
      await prisma.kycDocument.create({ data: { customerId: c.id, kind, fileName: `${kind.toLowerCase()}.pdf`, mimeType: 'application/pdf', sizeBytes: 250_000, sha256: sha(c.id + kind), storageKey: 'seed/no-file', keyEnc: cipher.encrypt('seed', `doc:${c.id}`), scanStatus: 'CLEAN', scanEngine: 'mock-av', reviewStatus: 'APPROVED', reviewedById: analyst.id, reviewedAt: new Date() } });
    }
    return c;
  };
  const adaeze = await mkDemo({ id: 'cust_demo_adaeze', first: 'Adaeze', last: 'Okafor', phone: '08030000001', email: 'adaeze.okafor@example.ng', bvn: '22000000000', nin: '33000000000', tier: 2, employer: 'MTN Nigeria', income: 450_000, salaryDay: 25, emp: 'EMPLOYED', consentAll: true });
  await mkDemo({ id: 'cust_demo_tunde', first: 'Tunde', last: 'Bakare', phone: '08030000002', tier: 0 });

  // ── bureau: pull (via the real service, cache + cost rules apply) for everyone with consent ──
  const consented = await prisma.consent.findMany({ where: { purpose: 'BUREAU_PULL', status: 'GRANTED' }, select: { subjectId: true } });
  let pulled = 0;
  for (const { subjectId } of consented) {
    try { await bureau.ensureReport(subjectId, { reason: 'APPLICATION', requestedById: null }); pulled++; } catch (e) { console.warn('bureau pull skipped', subjectId, (e as Error).message.slice(0, 60)); }
  }
  console.log(`  bureau reports: ${pulled}`);

  // ── applications through the REAL pipeline ──
  const eligible = customers.filter((c) => (tiers.get(c.id) ?? 0) >= 1);
  const flowCustomers = [...eligible.slice(0, 38), adaeze];
  const outcomes: Record<string, number> = {};
  for (const [i, c] of flowCustomers.entries()) {
    const tier = c.id === adaeze.id ? 2 : (tiers.get(c.id) ?? 1);
    const usable = products.filter((p) => p.isActive && p.minKycTier <= tier);
    const p = c.id === adaeze.id ? prodByCode.get('PERS')! : pick(usable);
    const capK = DEFAULT_TIER_LOAN_CAPS_KOBO[String(Math.min(3, Math.max(1, tier))) as '1' | '2' | '3'];
    const maxK = Math.min(Number(p.maxAmountKobo), Math.round(capK * 1.3));
    const amount = Math.max(Number(p.minAmountKobo), Math.round((between(30, 100) / 100) * maxK / 100_000) * 100_000);
    const tenor = Math.min(p.maxTenorMonths, Math.max(p.minTenorMonths, between(p.minTenorMonths, p.maxTenorMonths)));
    // most applicants have uploaded what the product requires (a few don't, to show the "missing documents" path)
    if (i % 6 !== 5) {
      const have = new Set((await prisma.kycDocument.findMany({ where: { customerId: c.id }, select: { kind: true } })).map((d) => d.kind));
      for (const kind of ((p.requiredDocs as string[] | null) ?? ['ID_CARD'])) {
        if (have.has(kind)) continue;
        await prisma.kycDocument.create({ data: { customerId: c.id, kind, fileName: `${kind.toLowerCase()}.pdf`, mimeType: 'application/pdf', sizeBytes: between(90_000, 700_000), sha256: sha(c.id + kind), storageKey: 'seed/no-file', keyEnc: cipher.encrypt('seed', `doc:${c.id}`), scanStatus: 'CLEAN', scanEngine: 'mock-av', reviewStatus: 'APPROVED', reviewedById: analyst.id, reviewedAt: new Date() } });
      }
    }
    try {
      const draft = await applications.create({ customerId: c.id, productId: p.id, amountKobo: Math.min(amount, Number(p.maxAmountKobo)), tenorMonths: tenor, purpose: pick(['Rent', 'School fees', 'Business stock', 'Medical', 'Personal']) }, { customerId: c.id });
      if (i % 9 === 4) continue; // leave a few as DRAFT
      const done = await applications.submit(draft.id, { type: 'CUSTOMER', id: c.id, name: 'Customer' });
      outcomes[done.status] = (outcomes[done.status] ?? 0) + 1;
      if (i % 11 === 7) await pipeline.advance(done.id).catch(() => undefined);
      // backdate the whole application timeline
      const off = between(0, 24) * DAY + between(0, 20) * 3_600_000;
      const evs = await prisma.applicationEvent.findMany({ where: { applicationId: done.id } });
      for (const e of evs) await prisma.applicationEvent.update({ where: { id: e.id }, data: { createdAt: new Date(e.createdAt.getTime() - off) } });
      await prisma.loanApplication.update({ where: { id: done.id }, data: { createdAt: new Date(done.createdAt.getTime() - off), submittedAt: done.submittedAt ? new Date(done.submittedAt.getTime() - off) : null } });
    } catch (e) { console.warn('application skipped:', (e as Error).message.slice(0, 80)); }
  }
  // a cancelled one for the list
  console.log('  pipeline outcomes:', JSON.stringify(outcomes));

  // ── booked-loan states (implemented in prompt 3; seeded directly so portfolio/bureau jobs have a book) ──
  const booked: Array<[string, number]> = [['ACTIVE', 8], ['Unpaid', 4], ['CLOSED', 4], ['WRITTEN_OFF', 2], ['RESTRUCTURED', 1], ['DISBURSED', 1], ['APPROVED', 2], ['OFFER_SENT', 2]];
  const pool = eligible.slice(38);
  let ref = (await prisma.loanApplication.count()) + 1;
  const chain: Record<string, string[]> = {
    APPROVED: ['DRAFT', 'SUBMITTED', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED'], OFFER_SENT: ['DRAFT', 'SUBMITTED', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT'],
    DISBURSED: ['DRAFT', 'SUBMITTED', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'DISBURSED'],
  };
  let n = 0;
  for (const [status, count] of booked) {
    for (let k = 0; k < count && n < pool.length; k++, n++) {
      const c = pool[n];
      const p = pick(products.filter((x) => x.minKycTier <= (tiers.get(c.id) ?? 1) && x.code !== 'SAL-ADV'));
      const amount = Math.round(between(20, 80) / 100 * Math.min(Number(p.maxAmountKobo), DEFAULT_TIER_LOAN_CAPS_KOBO['2']) / 100_000) * 100_000 || Number(p.minAmountKobo);
      const tenor = Math.min(p.maxTenorMonths, Math.max(p.minTenorMonths, 6));
      const age = status === 'ACTIVE' || status === 'Unpaid' || status === 'CLOSED' || status === 'WRITTEN_OFF' || status === 'RESTRUCTURED' ? between(45, 150) : between(1, 6);
      const created = ago(age);
      const pricing = { ...pricingFromProduct(p), ...(status === 'Unpaid' ? { simulatedDpd: pick([35, 65, 95]) } : {}), ...(status === 'WRITTEN_OFF' ? { simulatedDpd: 140 } : {}) };
      const a = await prisma.loanApplication.create({
        data: {
          reference: `APP-${new Date().getUTCFullYear()}-${String(ref++).padStart(6, '0')}`, customerId: c.id, productId: p.id, branchId: c.branchId, channel: 'PORTAL',
          requestedAmountKobo: BigInt(Math.max(amount, Number(p.minAmountKobo))), tenorMonths: tenor, purpose: 'Personal', status, statusReason: `Seeded ${status.toLowerCase().replace('_', ' ')} loan`,
          pricing: pricing as unknown as Prisma.InputJsonValue, kycTierAtSubmission: tiers.get(c.id) ?? 2, submittedAt: created, decidedAt: new Date(created.getTime() + 2 * DAY), createdAt: created,
        },
      });
      const path = chain[status] ?? ['DRAFT', 'SUBMITTED', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'DISBURSED', 'ACTIVE', ...(status === 'ACTIVE' ? [] : [status])];
      let prev: string | null = null;
      for (const [idx, s] of path.entries()) {
        await prisma.applicationEvent.create({ data: { applicationId: a.id, fromStatus: prev, toStatus: s, actorType: ['DRAFT', 'SUBMITTED'].includes(s) ? 'CUSTOMER' : idx < 5 ? 'SYSTEM' : 'STAFF', actorId: idx < 5 ? null : officer.id, actorName: ['DRAFT', 'SUBMITTED'].includes(s) ? 'Customer' : idx < 5 ? 'System' : officer.fullName, createdAt: new Date(created.getTime() + idx * 6 * 3_600_000) } });
        prev = s;
      }
      await eligibility.assess({ customerId: c.id, productId: p.id, amountKobo: Number(a.requestedAmountKobo), tenorMonths: tenor, applicationId: a.id, noPull: true }).catch(() => undefined);
    }
  }
  console.log(`  booked loans seeded: ${n}`);

  // ── bureau jobs: monitoring + furnishing history ──
  try { const m = await app.get(BureauMonitoringService).run({}); console.log(`  monitoring: checked ${m.checked}, alerts ${m.alerts}`); } catch (e) { console.warn('monitoring skipped', (e as Error).message.slice(0, 80)); }
  const fz = app.get(BureauFurnishingService);
  for (const back of [2, 1]) {
    const d = new Date(); d.setUTCMonth(d.getUTCMonth() - back);
    try { await fz.run({ period: d.toISOString().slice(0, 7) }); } catch (e) { console.warn('furnishing skipped', (e as Error).message.slice(0, 80)); }
  }

  // ── spread the pull log over 60 days + add synthetic traffic for the spend dashboard ──
  const reasons = ['APPLICATION', 'APPLICATION', 'APPLICATION', 'ON_DEMAND', 'MONITORING', 'PRE_DISBURSEMENT'];
  for (const p of await prisma.bureauPull.findMany()) await prisma.bureauPull.update({ where: { id: p.id }, data: { createdAt: ago(between(0, 45)) } });
  const custIds = consented.map((x) => x.subjectId);
  const extra: Prisma.BureauPullCreateManyInput[] = [];
  for (let i = 0; i < 160; i++) {
    const bn = pick(['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY']);
    const r = rnd();
    const status = r < 0.72 ? 'SUCCESS' : r < 0.82 ? 'NO_HIT' : r < 0.92 ? 'CACHED' : r < 0.96 ? 'FAILED' : 'BLOCKED_NO_CONSENT';
    const billable = status === 'SUCCESS' || status === 'NO_HIT';
    extra.push({ customerId: pick(custIds), bureau: status === 'CACHED' || status === 'BLOCKED_NO_CONSENT' ? 'ALL' : bn, reason: pick(reasons), status, costKobo: billable ? BigInt(bureauCosts[bn] ?? 12000) : 0n, durationMs: between(350, 3800), requestedById: i % 4 === 0 ? analyst.id : null, error: status === 'FAILED' ? 'Upstream timeout after 3 attempts' : null, createdAt: ago(between(0, 59)) });
  }
  await prisma.bureauPull.createMany({ data: extra });

  await sleep(300);
  console.log('Phase 2 seed complete. Portal demo logins: 08030000001 (Adaeze, Tier 2, ready to apply) and 08030000002 (Tunde, new). OTP shown in demo mode.');
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
