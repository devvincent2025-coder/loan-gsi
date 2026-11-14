import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FACE_MATCH_PASS, FACE_MATCH_REVIEW, FaceSessionDto, KycStepResult, KycVerificationDto, KycVerificationStatus, KycVerificationType, NIGERIAN_BANKS } from '@damez/shared';
import type { Customer, KycVerification, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { requestContext } from '../common/request-context';
import { APP_ENV, AppEnv } from '../config/config.module';
import { ConsentService } from '../consent/consent.module';
import { DocumentsService } from '../documents/documents.service';
import { FraudService } from '../fraud/fraud.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScreeningService } from '../screening/screening.module';
import { CustomerPii, normalizePhone } from './customer-pii';
import { FaceResult, GovIdType, KYC_PROVIDER, KycNotConfiguredError, KycProvider, KycProviderError } from './kyc-provider';
import { KycTierService } from './kyc-tier.service';
import { verificationDto } from './mappers';
import { matchNames } from './name-match';
import { getSetting } from './setting.util';

/** Bounded retries per verification type per rolling 24h (stops BVN/NIN enumeration and provider cost abuse). */
const MAX_ATTEMPTS_PER_DAY = 5;
const MAX_FACE_SESSIONS_PER_DAY = 8;

interface Rec {
  type: KycVerificationType; status: KycVerificationStatus; summary: string;
  referenceId?: string | null; matchConfidence?: number | null; livenessPassed?: boolean | null; details?: Record<string, unknown>;
}

@Injectable()
export class KycService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private pii: CustomerPii, private consent: ConsentService, private tiers: KycTierService,
    private fraud: FraudService, private screening: ScreeningService, private docs: DocumentsService,
    @Inject(KYC_PROVIDER) private provider: KycProvider, @Inject(APP_ENV) private env: AppEnv,
  ) {}

  /* ───────── plumbing ───────── */
  private async load(id: string): Promise<Customer> { return this.prisma.customer.findUniqueOrThrow({ where: { id } }); }

  private async requireConsent(customerId: string): Promise<void> {
    if (!(await this.consent.hasValidConsent(customerId, 'KYC_VERIFICATION'))) {
      throw new ForbiddenException({ message: 'Please accept the identity verification consent first', code: 'CONSENT_REQUIRED', purpose: 'KYC_VERIFICATION' });
    }
  }

  private async guardAttempts(customerId: string, type: KycVerificationType, max = MAX_ATTEMPTS_PER_DAY): Promise<void> {
    const n = await this.prisma.kycVerification.count({ where: { customerId, type, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    if (n >= max) throw new HttpException({ message: 'Too many attempts today. Please try again tomorrow or contact support', code: 'KYC_RETRY_LIMIT' }, 429);
  }

  /** Map provider failures to friendly, retryable HTTP errors (no upstream detail leaks to the customer). */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (e instanceof KycNotConfiguredError) throw new ServiceUnavailableException({ message: 'Identity verification is not available right now', code: 'NOT_CONFIGURED' });
      if (e instanceof KycProviderError) throw new ServiceUnavailableException({ message: 'Our verification partner is busy. Please try again in a few minutes', code: 'KYC_UNAVAILABLE' });
      throw e;
    }
  }

  private async record(customerId: string, r: Rec): Promise<KycVerification> {
    const data = {
      customerId, type: r.type, provider: this.provider.name, status: r.status, referenceId: r.referenceId ?? null, matchConfidence: r.matchConfidence ?? null,
      livenessPassed: r.livenessPassed ?? null, summary: r.summary, details: (r.details ?? {}) as Prisma.InputJsonValue, completedAt: r.status === 'PENDING' ? null : new Date(),
    };
    let v: KycVerification;
    try { v = await this.prisma.kycVerification.create({ data }); } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      v = await this.prisma.kycVerification.create({ data: { ...data, referenceId: null } }); // provider re-used a reference id
    }
    await this.audit.record({
      action: `kyc.${r.type.toLowerCase()}_${r.status.toLowerCase()}`, resourceType: 'Customer', resourceId: customerId, outcome: r.status === 'PASSED' ? 'SUCCESS' : 'FAILURE',
      metadata: { verificationId: v.id, provider: this.provider.name, confidence: r.matchConfidence ?? undefined },
    });
    return v;
  }

  private async result(v: KycVerification, message: string, retryAllowed: boolean, extra?: { accountName?: string }): Promise<KycStepResult> {
    const c = await this.load(v.customerId);
    return { status: v.status as KycVerificationStatus, message, kycTier: c.kycTier as KycStepResult['kycTier'], retryAllowed, verification: verificationDto(v), ...(extra?.accountName ? { accountName: extra.accountName } : {}) };
  }

  async list(customerId: string): Promise<KycVerificationDto[]> {
    const rows = await this.prisma.kycVerification.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(verificationDto);
  }

  /** Called by portal auth the first time a customer proves control of their phone. */
  async recordPhoneVerified(customerId: string): Promise<void> {
    if (await this.prisma.kycVerification.count({ where: { customerId, type: 'PHONE', status: 'PASSED' } })) return;
    await this.record(customerId, { type: 'PHONE', status: 'PASSED', summary: 'Phone number verified by one-time code' });
  }

  /* ───────── BVN ───────── */
  async verifyBvn(customerId: string, input: { bvn: string; dateOfBirth?: string }): Promise<KycStepResult> {
    const c = await this.load(customerId);
    await this.requireConsent(customerId);
    const bvnHash = this.pii.hash(input.bvn, 'bvn');

    if (c.bvnVerifiedAt) {
      if (c.bvnHash !== bvnHash) throw new ConflictException({ message: 'Your BVN is already verified. Contact support to change it', code: 'BVN_ALREADY_VERIFIED' });
      const v = await this.prisma.kycVerification.findFirstOrThrow({ where: { customerId, type: 'BVN', status: 'PASSED' }, orderBy: { createdAt: 'desc' } });
      return this.result(v, 'Your BVN is already verified.', false);
    }
    const dup = await this.prisma.customer.findFirst({ where: { bvnHash, id: { not: customerId }, erasedAt: null }, select: { id: true } });
    if (dup) return this.duplicateBvn(customerId, dup.id);
    await this.guardAttempts(customerId, 'BVN');

    const dob = input.dateOfBirth ?? this.pii.dec(c.id, 'dob', c.dobEnc) ?? undefined;
    const phone = this.pii.dec(c.id, 'phone', c.phoneEnc);
    const rec = await this.call(() => this.provider.lookupBvn(input.bvn));
    if (!rec.found) {
      const v = await this.record(customerId, { type: 'BVN', status: 'FAILED', referenceId: rec.reference, summary: 'BVN not found', details: { reason: 'NOT_FOUND' } });
      await this.tiers.refreshTier(customerId);
      return this.result(v, "We couldn't find that BVN. Check the 11 digits and try again.", true);
    }

    const name = matchNames({ firstName: c.firstName, lastName: c.lastName }, rec);
    const dobOk = !dob || !rec.dateOfBirth || dob === rec.dateOfBirth;
    const phoneOk = !rec.phone || !phone || normalizePhone(rec.phone) === normalizePhone(phone);
    const details = { nameScore: name.score, dobMatched: dobOk, phoneMatched: phoneOk };
    if (!phoneOk) await this.fraud.raise(customerId, 'PHONE_BVN_MISMATCH', 'MEDIUM', 'The phone number on the BVN record differs from the verified phone');

    if (name.status === 'FAIL' || !dobOk) {
      if (name.status === 'FAIL') await this.fraud.raise(customerId, 'NAME_MISMATCH', 'MEDIUM', 'The name on the BVN record does not match the registered name');
      const v = await this.record(customerId, { type: 'BVN', status: 'FAILED', referenceId: rec.reference, matchConfidence: name.score, summary: name.status === 'FAIL' ? 'Name on BVN does not match' : 'Date of birth on BVN does not match', details });
      await this.tiers.refreshTier(customerId);
      return this.result(v, name.status === 'FAIL'
        ? "The name on your BVN doesn't match the name you registered with. Check your details and try again."
        : "The date of birth on your BVN doesn't match what you entered. Check it and try again.", true);
    }
    if (name.status === 'REVIEW') {
      const v = await this.record(customerId, { type: 'BVN', status: 'REVIEW', referenceId: rec.reference, matchConfidence: name.score, summary: 'Name partially matches; manual review needed', details });
      return this.result(v, 'Your name only partly matches your BVN record, so our team needs to take a quick look. We will update you shortly.', false);
    }

    try {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: {
          bvnEnc: this.pii.enc(customerId, 'bvn', input.bvn), bvnHash, bvnPhotoHash: rec.photoHash ?? null, bvnVerifiedAt: new Date(),
          ...(rec.dateOfBirth ? { dobEnc: this.pii.enc(customerId, 'dob', rec.dateOfBirth), birthYear: Number(rec.dateOfBirth.slice(0, 4)) } : {}),
          ...(!c.gender && rec.gender ? { gender: rec.gender } : {}),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const other = await this.prisma.customer.findFirst({ where: { bvnHash, id: { not: customerId } }, select: { id: true } });
        return this.duplicateBvn(customerId, other?.id ?? null);
      }
      throw e;
    }
    const v = await this.record(customerId, { type: 'BVN', status: 'PASSED', referenceId: rec.reference, matchConfidence: name.score, summary: `BVN verified; name matched (${name.score}%)`, details });
    await this.fraud.scanDuplicates(customerId);
    await this.screening.runIfEnabled(customerId);
    await this.tiers.refreshTier(customerId);
    return this.result(v, 'Your BVN is verified.', false);
  }

  private async duplicateBvn(customerId: string, otherId: string | null): Promise<never> {
    await this.record(customerId, { type: 'BVN', status: 'FAILED', summary: 'BVN already registered to another account', details: { reason: 'DUPLICATE_BVN' } });
    if (otherId) await this.fraud.raisePair(customerId, otherId, 'DUPLICATE_BVN', 'HIGH', 'The same BVN is registered to another customer');
    else await this.fraud.raise(customerId, 'DUPLICATE_BVN', 'HIGH', 'The same BVN is registered to another customer');
    await this.tiers.refreshTier(customerId);
    throw new ConflictException({ message: 'This BVN is already linked to another account. Please contact support if you think this is a mistake.', code: 'DUPLICATE_BVN' });
  }

  /* ───────── NIN ───────── */
  async verifyNin(customerId: string, input: { nin: string }): Promise<KycStepResult> {
    const c = await this.load(customerId);
    await this.requireConsent(customerId);
    const ninHash = this.pii.hash(input.nin, 'nin');
    if (c.ninVerifiedAt) {
      const v = await this.prisma.kycVerification.findFirstOrThrow({ where: { customerId, type: 'NIN', status: 'PASSED' }, orderBy: { createdAt: 'desc' } });
      return this.result(v, 'Your NIN is already verified.', false);
    }
    await this.guardAttempts(customerId, 'NIN');
    const rec = await this.call(() => this.provider.lookupNin(input.nin));
    if (!rec.found) {
      const v = await this.record(customerId, { type: 'NIN', status: 'FAILED', referenceId: rec.reference, summary: 'NIN not found', details: { reason: 'NOT_FOUND' } });
      return this.result(v, "We couldn't find that NIN. Check the 11 digits and try again.", true);
    }
    const name = matchNames({ firstName: c.firstName, lastName: c.lastName }, rec);
    if (name.status === 'FAIL') {
      await this.fraud.raise(customerId, 'NAME_MISMATCH', 'MEDIUM', 'The name on the NIN record does not match the registered name');
      const v = await this.record(customerId, { type: 'NIN', status: 'FAILED', referenceId: rec.reference, matchConfidence: name.score, summary: 'Name on NIN does not match' });
      return this.result(v, "The name on your NIN doesn't match the name you registered with. Check your details and try again.", true);
    }
    if (name.status === 'REVIEW') {
      const v = await this.record(customerId, { type: 'NIN', status: 'REVIEW', referenceId: rec.reference, matchConfidence: name.score, summary: 'Name partially matches; manual review needed' });
      return this.result(v, 'Your name only partly matches your NIN record, so our team needs to take a quick look.', false);
    }
    const dup = await this.prisma.customer.findFirst({ where: { ninHash, id: { not: customerId }, erasedAt: null }, select: { id: true } });
    if (dup) {
      await this.fraud.raisePair(customerId, dup.id, 'DUPLICATE_NIN', 'HIGH', 'The same NIN is registered to another customer');
      const v = await this.record(customerId, { type: 'NIN', status: 'REVIEW', referenceId: rec.reference, summary: 'NIN already registered to another account', details: { reason: 'DUPLICATE_NIN' } });
      return this.result(v, 'We need to review this NIN before we can accept it. Our team will be in touch.', false);
    }
    await this.prisma.customer.update({ where: { id: customerId }, data: { ninEnc: this.pii.enc(customerId, 'nin', input.nin), ninHash, ninVerifiedAt: new Date() } });
    const v = await this.record(customerId, { type: 'NIN', status: 'PASSED', referenceId: rec.reference, matchConfidence: name.score, summary: `NIN verified; name matched (${name.score}%)` });
    const tier = await this.tiers.refreshTier(customerId);
    return { ...(await this.result(v, 'Your NIN is verified.', false)), kycTier: tier };
  }

  /* ───────── bank account ───────── */
  async verifyBank(customerId: string, input: { accountNumber: string; bankCode: string }): Promise<KycStepResult> {
    const c = await this.load(customerId);
    await this.requireConsent(customerId);
    await this.guardAttempts(customerId, 'BANK_ACCOUNT');
    const bank = NIGERIAN_BANKS.find((b) => b.code === input.bankCode);
    const rec = await this.call(() => this.provider.nameEnquiry(input));
    if (!rec.found || !rec.accountName) {
      const v = await this.record(customerId, { type: 'BANK_ACCOUNT', status: 'FAILED', referenceId: rec.reference, summary: 'Account not found', details: { bank: bank?.name } });
      return this.result(v, "We couldn't find that account. Check the account number and bank.", true);
    }
    const name = matchNames({ firstName: c.firstName, lastName: c.lastName }, { fullName: rec.accountName });
    const base = { type: 'BANK_ACCOUNT' as const, referenceId: rec.reference, matchConfidence: name.score, details: { bank: bank?.name, nameScore: name.score } };
    if (name.status === 'FAIL') {
      await this.fraud.raise(customerId, 'NAME_MISMATCH', 'LOW', 'The bank account name does not match the registered name');
      const v = await this.record(customerId, { ...base, status: 'FAILED', summary: 'Account name does not match' });
      return this.result(v, "This account isn't in your name. Please use an account that belongs to you.", true, { accountName: rec.accountName });
    }
    if (name.status === 'REVIEW') {
      const v = await this.record(customerId, { ...base, status: 'REVIEW', summary: 'Account name partially matches; manual review needed' });
      return this.result(v, 'The account name only partly matches your name, so our team will take a quick look.', false, { accountName: rec.accountName });
    }
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        accountNumberEnc: this.pii.enc(customerId, 'accountNumber', input.accountNumber), accountNumberHash: this.pii.hash(input.accountNumber, 'account'),
        bankCode: input.bankCode, accountNameEnc: this.pii.enc(customerId, 'accountName', rec.accountName), bankVerifiedAt: new Date(),
      },
    });
    const v = await this.record(customerId, { ...base, status: 'PASSED', summary: `Bank account verified${bank ? ` (${bank.name})` : ''}` });
    await this.tiers.refreshTier(customerId);
    return this.result(v, 'Your bank account is verified.', false, { accountName: rec.accountName });
  }

  /* ───────── government ID ───────── */
  async verifyGovId(customerId: string, input: { idType: GovIdType; idNumber: string }): Promise<KycStepResult> {
    const c = await this.load(customerId);
    await this.requireConsent(customerId);
    await this.guardAttempts(customerId, 'GOV_ID');
    // Dojah's document-analysis product is OCR over the uploaded ID photo, not a bare ID-number lookup.
    const [docId] = await this.docs.listIds(customerId, 'ID_CARD');
    if (!docId) throw new ConflictException({ message: 'Upload a photo of your ID before verifying it', code: 'ID_DOCUMENT_REQUIRED' });
    const { bytes } = await this.docs.readContent(docId);
    const rec = await this.call(() => this.provider.verifyGovId({ ...input, imageBase64: bytes.toString('base64') }));
    const label = { DRIVERS_LICENSE: "driver's licence", VOTERS_CARD: "voter's card", INTL_PASSPORT: 'passport' }[input.idType];
    if (!rec.found) {
      const v = await this.record(customerId, { type: 'GOV_ID', status: 'FAILED', referenceId: rec.reference, summary: `${label} not found`, details: { idType: input.idType } });
      return this.result(v, `We couldn't verify that ${label}. Check the number and try again.`, true);
    }
    const name = matchNames({ firstName: c.firstName, lastName: c.lastName }, rec);
    const base = { type: 'GOV_ID' as const, referenceId: rec.reference, matchConfidence: name.score, details: { idType: input.idType, nameScore: name.score } };
    if (name.status === 'FAIL') {
      await this.fraud.raise(customerId, 'NAME_MISMATCH', 'MEDIUM', 'The name on the government ID does not match the registered name');
      const v = await this.record(customerId, { ...base, status: 'FAILED', summary: 'Name on ID does not match' });
      return this.result(v, `The name on your ${label} doesn't match the name you registered with.`, true);
    }
    if (name.status === 'REVIEW') {
      const v = await this.record(customerId, { ...base, status: 'REVIEW', summary: 'Name partially matches; manual review needed' });
      return this.result(v, `Your name only partly matches your ${label}, so our team will take a quick look.`, false);
    }
    const v = await this.record(customerId, { ...base, status: 'PASSED', summary: `${label} verified; name matched (${name.score}%)` });
    await this.tiers.refreshTier(customerId);
    return this.result(v, `Your ${label} is verified.`, false);
  }

  /* ───────── address (Tier 3) ───────── */
  async verifyAddress(customerId: string, input: { line1: string; city: string; state: string; landmark?: string }): Promise<KycStepResult> {
    await this.load(customerId);
    await this.requireConsent(customerId);
    await this.guardAttempts(customerId, 'ADDRESS');
    const rec = await this.call(() => this.provider.verifyAddress(input));
    const stored = { addressEnc: this.pii.enc(customerId, 'address', JSON.stringify(input)), city: input.city, state: input.state };
    if (rec.status === 'NOT_VERIFIED') {
      const v = await this.record(customerId, { type: 'ADDRESS', status: 'FAILED', referenceId: rec.reference, summary: 'Address could not be verified' });
      return this.result(v, "We couldn't verify that address. Check it, or upload a recent utility bill instead.", true);
    }
    if (rec.status === 'PENDING') {
      await this.prisma.customer.update({ where: { id: customerId }, data: stored });
      const v = await this.record(customerId, { type: 'ADDRESS', status: 'REVIEW', referenceId: rec.reference, summary: 'Address verification in progress' });
      return this.result(v, 'We are verifying your address. This can take a little while and we will update you.', false);
    }
    await this.prisma.customer.update({ where: { id: customerId }, data: { ...stored, addressVerifiedAt: new Date() } });
    const v = await this.record(customerId, { type: 'ADDRESS', status: 'PASSED', referenceId: rec.reference, summary: 'Address verified' });
    await this.tiers.refreshTier(customerId);
    return this.result(v, 'Your address is verified.', false);
  }

  /** Polls a PENDING address check (Dojah's physical/digital address verification is asynchronous). */
  async pollAddress(customerId: string): Promise<KycStepResult> {
    const row = await this.prisma.kycVerification.findFirst({ where: { customerId, type: 'ADDRESS' }, orderBy: { createdAt: 'desc' } });
    if (!row) throw new NotFoundException('No address verification in progress');
    if (row.status !== 'REVIEW' || !row.referenceId) return this.result(row, row.status === 'PASSED' ? 'Your address is verified.' : 'Address verification is not in progress.', false);
    const rec = await this.call(() => this.provider.fetchAddressResult(row.referenceId!));
    if (rec.status === 'PENDING') return this.result(row, 'We are still verifying your address. This can take a little while.', false);
    const status: KycVerificationStatus = rec.status === 'VERIFIED' ? 'PASSED' : 'FAILED';
    await this.prisma.kycVerification.update({ where: { id: row.id }, data: { status, completedAt: new Date(), summary: status === 'PASSED' ? 'Address verified' : 'Address could not be verified' } });
    if (status === 'PASSED') {
      await this.prisma.customer.update({ where: { id: customerId }, data: { addressVerifiedAt: new Date() } });
      await this.tiers.refreshTier(customerId);
    }
    const fresh = await this.prisma.kycVerification.findUniqueOrThrow({ where: { id: row.id } });
    return this.result(fresh, status === 'PASSED' ? 'Your address is verified.' : "We couldn't verify that address. Check it, or upload a recent utility bill instead.", status === 'FAILED');
  }

  /* ───────── face / liveness ───────── */
  async startFace(customerId: string): Promise<FaceSessionDto> {
    const c = await this.load(customerId);
    await this.requireConsent(customerId);
    if (!c.bvnVerifiedAt) throw new ConflictException({ message: 'Verify your BVN before the selfie check', code: 'BVN_REQUIRED' });
    await this.guardAttempts(customerId, 'FACE', MAX_FACE_SESSIONS_PER_DAY);
    const session = await this.call(() => this.provider.startFaceSession({ customerId }));
    await this.record(customerId, { type: 'FACE', status: 'PENDING', referenceId: session.referenceId, summary: 'Selfie check started' });
    return session;
  }

  async completeFace(customerId: string, input: { referenceId: string; sdkEvent?: string }): Promise<KycStepResult> {
    const row = await this.prisma.kycVerification.findFirst({ where: { customerId, type: 'FACE', referenceId: input.referenceId } });
    if (!row) throw new NotFoundException('Selfie session not found');
    if (row.status !== 'PENDING') return this.faceResult(row);
    // The browser callback (sdkEvent) is only a hint: the authoritative result is fetched server-side.
    const face = await this.call(() => this.provider.fetchFaceResult(input.referenceId));
    if (face.state !== 'COMPLETED') {
      return this.result(row, face.state === 'PENDING' ? 'We are still checking your selfie. Please wait a moment.' : "We didn't receive your selfie result. Please try again.", true);
    }
    return this.finalizeFace(row, face, 'client');
  }

  /** Idempotent: only the first caller flips PENDING → final; everyone else just reads the stored result. */
  async finalizeFace(row: KycVerification, face: FaceResult, source: 'client' | 'webhook'): Promise<KycStepResult> {
    const pass = Number(await getSetting(this.prisma, 'kyc.face_match_pass', FACE_MATCH_PASS));
    const review = Number(await getSetting(this.prisma, 'kyc.face_match_review', FACE_MATCH_REVIEW));
    const confidence = Math.max(0, Math.min(100, Math.round(face.confidence ?? 0)));
    const liveness = face.liveness !== false; // unknown liveness is not treated as a failure; explicit false is
    const status: KycVerificationStatus = !liveness ? 'FAILED' : confidence >= pass ? 'PASSED' : confidence >= review ? 'REVIEW' : 'FAILED';
    const summary = !liveness ? 'Liveness check failed' : status === 'PASSED' ? `Selfie matched (${confidence}%)` : status === 'REVIEW' ? `Selfie match needs review (${confidence}%)` : `Selfie did not match (${confidence}%)`;
    const claimed = await this.prisma.kycVerification.updateMany({
      where: { id: row.id, status: 'PENDING' }, data: { status, matchConfidence: confidence, livenessPassed: liveness, summary, completedAt: new Date() },
    });
    const fresh = await this.prisma.kycVerification.findUniqueOrThrow({ where: { id: row.id } });
    if (claimed.count === 0) return this.faceResult(fresh);

    if (status === 'PASSED') await this.prisma.customer.update({ where: { id: row.customerId }, data: { faceVerifiedAt: new Date() } });
    if (!liveness) await this.fraud.raise(row.customerId, 'LIVENESS_FAIL', 'MEDIUM', 'The selfie liveness check failed');
    if (face.selfieImage && (await getSetting(this.prisma, 'kyc.retain_biometrics', false))) {
      await this.docs.storeInternal(row.customerId, 'OTHER', `selfie-${row.referenceId ?? row.id}.jpg`, face.selfieImage);
    }
    await this.audit.record({
      action: 'kyc.face_completed', resourceType: 'Customer', resourceId: row.customerId, outcome: status === 'PASSED' ? 'SUCCESS' : 'FAILURE',
      actorName: source === 'webhook' ? 'Dojah webhook' : undefined, ...(source === 'webhook' ? { actorId: null } : {}),
      metadata: { verificationId: row.id, status, confidence, liveness, source, provider: row.provider },
    });
    await this.tiers.refreshTier(row.customerId);
    return this.faceResult(await this.prisma.kycVerification.findUniqueOrThrow({ where: { id: row.id } }));
  }

  private faceResult(v: KycVerification): Promise<KycStepResult> {
    const live = v.livenessPassed === false;
    const msg: Record<string, string> = {
      PASSED: 'Your selfie is verified.',
      REVIEW: 'Your selfie was close but not clear enough. Retake it in good light, or our team will review it.',
      FAILED: live ? "We couldn't confirm a live selfie. Face the camera in good light, remove glasses or hats, and try again." : "Your selfie didn't match your BVN photo. Please try again in good light.",
      PENDING: 'We are still checking your selfie.',
    };
    return this.result(v, msg[v.status] ?? msg.PENDING, v.status !== 'PASSED');
  }

  /** Signature already verified. Returns quickly; duplicates and unknown references are acknowledged, never errors (providers retry on non-200). */
  async handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ received: true; matched: boolean; duplicate?: boolean }> {
    const ev = this.provider.parseWebhook(rawBody, headers);
    if (ev.kind !== 'FACE') return { received: true, matched: false };
    const row = await this.prisma.kycVerification.findFirst({ where: { type: 'FACE', referenceId: ev.face.referenceId } });
    if (!row) return { received: true, matched: false };
    if (row.status !== 'PENDING') return { received: true, matched: true, duplicate: true };
    if (ev.face.state !== 'COMPLETED') return { received: true, matched: true };
    await requestContext.run({ requestId: 'webhook', ip: null, userAgent: 'dojah-webhook' }, () => this.finalizeFace(row, ev.face, 'webhook'));
    return { received: true, matched: true };
  }
}
