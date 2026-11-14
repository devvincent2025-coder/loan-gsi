import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  CONSENT_PURPOSES, CONSENT_TEXTS, ConsentPurpose, DocumentKind, KYC_TIER_REQUIREMENTS, KycTier, maskEmail, maskPhone, OnboardingState, OnboardingStep,
  PortalConsentsDto, PortalMe, ConsentDto,
} from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { requestContext } from '../common/request-context';
import { ConsentService } from '../consent/consent.module';
import { CustomerPii } from '../kyc/customer-pii';
import { KycTierService } from '../kyc/kyc-tier.service';
import { consentDto } from '../kyc/mappers';
import { PrismaService } from '../prisma/prisma.service';

export const profileSchema = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd').refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600_000);
    return age >= 18 && age <= 100;
  }, 'You must be 18 or older'),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  address: z.object({ line1: z.string().trim().min(5).max(200), city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(40), landmark: z.string().trim().max(120).optional() }),
  employment: z.object({
    status: z.enum(['EMPLOYED', 'SELF_EMPLOYED', 'CIVIL_SERVANT', 'STUDENT', 'UNEMPLOYED', 'RETIRED']),
    employer: z.string().trim().max(120).optional(),
    monthlyIncomeKobo: z.number().int().min(0).max(100_000_000_000_00),
    salaryDay: z.number().int().min(1).max(31).optional(),
  }),
});
export const consentGrantSchema = z.object({ purpose: z.enum(CONSENT_PURPOSES), textVersion: z.string().min(1).max(64) });

type Latest = Record<string, { status: string; details: unknown } | undefined>;

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService, private audit: AuditService, private pii: CustomerPii, private consent: ConsentService, private tiers: KycTierService) {}

  async me(customerId: string): Promise<PortalMe> {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const tier = c.kycTier as KycTier;
    const phone = this.pii.dec(c.id, 'phone', c.phoneEnc);
    const email = this.pii.dec(c.id, 'email', c.emailEnc);
    const st = await this.state(customerId, c);
    return {
      id: c.id, firstName: c.firstName, lastName: c.lastName, phone: maskPhone(phone), email: email ? maskEmail(email) : null,
      phoneVerified: !!c.phoneVerifiedAt, emailVerified: !!c.emailVerifiedAt, kycTier: tier, maxLoanKobo: await this.tiers.maxLoanKobo(tier), onboardingComplete: st.completed,
    };
  }

  async state(customerId: string, preloaded?: Awaited<ReturnType<PrismaService['customer']['findUniqueOrThrow']>>): Promise<OnboardingState> {
    const c = preloaded ?? (await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } }));
    const [vers, docs, bureauConsent, kycConsent] = await Promise.all([
      this.prisma.kycVerification.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.kycDocument.findMany({ where: { customerId, deletedAt: null, scanStatus: 'CLEAN', reviewStatus: { not: 'REJECTED' } }, select: { kind: true } }),
      this.consent.hasValidConsent(customerId, 'BUREAU_PULL'),
      this.consent.hasValidConsent(customerId, 'KYC_VERIFICATION'),
    ]);
    // latest result per type; a PASSED anywhere wins (a later retry must not hide a pass)
    const latest: Latest = {};
    for (const v of [...vers].reverse()) latest[v.type] = { status: v.status, details: v.details };
    for (const v of vers) if (v.status === 'PASSED') latest[v.type] = { status: 'PASSED', details: v.details };
    const kinds = new Set(docs.map((d) => d.kind as DocumentKind));
    const tier = c.kycTier as KycTier;

    const bvnDone = !!c.bvnVerifiedAt;
    const profileDone = !!(c.dobEnc && c.addressEnc && c.employmentStatus && c.monthlyIncomeKobo !== null);
    const fromVer = (type: string, doneFlag: boolean, ok: string, failMsg: string, reviewMsg: string): Pick<OnboardingStep, 'status' | 'detail'> => {
      if (doneFlag) return { status: 'DONE', detail: ok };
      const l = latest[type];
      if (l?.status === 'FAILED') return { status: 'FAILED', detail: failMsg };
      if (l?.status === 'REVIEW') return { status: 'REVIEW', detail: reviewMsg };
      if (l?.status === 'PENDING') return { status: 'TODO', detail: 'Started: finish the selfie check' };
      return { status: 'TODO', detail: null };
    };
    const locked = (s: Pick<OnboardingStep, 'status' | 'detail'>, cond: boolean, why: string): Pick<OnboardingStep, 'status' | 'detail'> => (!cond && s.status === 'TODO' ? { status: 'LOCKED', detail: why } : s);

    const steps: OnboardingStep[] = [
      { key: 'ACCOUNT', label: 'Create your account', description: 'Verify your phone number with a one-time code.', required: true, status: c.phoneVerifiedAt ? 'DONE' : 'TODO', detail: null },
      { key: 'EMAIL', label: 'Verify your email', description: 'Recommended: we send statements and offers here.', required: false, status: c.emailVerifiedAt ? 'DONE' : 'OPTIONAL', detail: c.emailEnc ? null : 'Add an email address to verify it' },
      { key: 'PROFILE', label: 'Tell us about you', description: 'Date of birth, address and employment or income.', required: true, status: profileDone ? 'DONE' : 'TODO', detail: null },
      {
        key: 'BVN', label: 'Verify your BVN', description: 'Your Bank Verification Number confirms who you are (Tier 1).', required: true,
        ...locked(fromVer('BVN', bvnDone, 'BVN verified', 'We could not match your BVN. Check the details and retry', 'Our team is reviewing your BVN'), kycConsent, 'Accept the identity verification consent first'),
      },
      {
        key: 'NIN', label: 'Add your NIN or government ID', description: 'Needed for Tier 2 (higher loan limits).', required: false,
        ...locked(c.ninVerifiedAt ? { status: 'DONE', detail: 'NIN verified' } : latest.GOV_ID?.status === 'PASSED' ? { status: 'DONE', detail: 'Government ID verified' } : fromVer('NIN', false, '', 'We could not verify your NIN', 'Our team is reviewing your NIN'), bvnDone, 'Verify your BVN first'),
      },
      {
        key: 'FACE', label: 'Take a selfie', description: 'A quick liveness check matched to your BVN photo (Tier 2).', required: false,
        ...locked(fromVer('FACE', latest.FACE?.status === 'PASSED', 'Selfie verified', 'Selfie check failed. You can try again', 'Your selfie is under review'), bvnDone, 'Verify your BVN first'),
      },
      {
        key: 'BANK_ACCOUNT', label: 'Add your bank account', description: 'Where your loan is paid and repayments are collected.', required: false,
        ...locked(fromVer('BANK_ACCOUNT', !!c.bankVerifiedAt, 'Account verified', 'The account name did not match yours', 'Our team is reviewing your account'), bvnDone, 'Verify your BVN first'),
      },
      {
        key: 'DOCUMENTS', label: 'Upload documents', description: 'ID and proof of address (payslip or bank statement for some loans).', required: false,
        status: kinds.has('ID_CARD') && kinds.has('PROOF_OF_ADDRESS') ? 'DONE' : 'OPTIONAL',
        detail: kinds.size ? `Uploaded: ${[...kinds].join(', ')}` : null,
      },
      {
        key: 'ADDRESS', label: 'Verify your address', description: 'Optional: unlocks Tier 3 (highest limits).', required: false,
        ...locked(fromVer('ADDRESS', !!c.addressVerifiedAt || latest.ADDRESS?.status === 'PASSED', 'Address verified', 'We could not verify that address', 'Address verification in progress'), tier >= 2, 'Complete Tier 2 first'),
      },
      { key: 'BUREAU_CONSENT', label: 'Credit check consent', description: 'Required before you can apply: lets us check your credit report.', required: true, status: bureauConsent ? 'DONE' : 'TODO', detail: null },
    ];
    for (const s of steps) if (!s.required && s.status === 'TODO') s.status = 'OPTIONAL';
    const firstRequired = steps.find((s) => s.required && s.status !== 'DONE');
    if (firstRequired && firstRequired.status === 'TODO') firstRequired.status = 'CURRENT';
    const completed = steps.filter((s) => s.required).every((s) => s.status === 'DONE');
    const currentStep = firstRequired?.key ?? steps.find((s) => s.status === 'OPTIONAL' || s.status === 'FAILED' || s.status === 'REVIEW')?.key ?? null;

    const caps = await Promise.all([1, 2, 3].map((t) => this.tiers.maxLoanKobo(t)));
    return {
      steps, currentStep, kycTier: tier, maxLoanKobo: await this.tiers.maxLoanKobo(tier), completed,
      tiers: KYC_TIER_REQUIREMENTS.map((t, i) => ({ ...t, maxLoanKobo: caps[i], achieved: tier >= t.tier })),
    };
  }

  async updateProfile(customerId: string, p: z.infer<typeof profileSchema>): Promise<PortalMe> {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const dobLocked = !!c.bvnVerifiedAt; // the verified BVN date of birth is authoritative
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(dobLocked ? {} : { dobEnc: this.pii.enc(customerId, 'dob', p.dateOfBirth), birthYear: Number(p.dateOfBirth.slice(0, 4)) }),
        ...(p.gender && !c.gender ? { gender: p.gender } : {}),
        addressEnc: this.pii.enc(customerId, 'address', JSON.stringify(p.address)), city: p.address.city, state: p.address.state,
        employmentStatus: p.employment.status, employer: p.employment.employer ?? null, monthlyIncomeKobo: BigInt(p.employment.monthlyIncomeKobo), salaryDay: p.employment.salaryDay ?? null,
      },
    });
    await this.audit.record({ action: 'portal.profile_updated', resourceType: 'Customer', resourceId: customerId, branchId: c.branchId, after: { employmentStatus: p.employment.status, state: p.address.state } });
    return this.me(customerId);
  }

  /* ───────── consents ───────── */
  async consents(customerId: string): Promise<PortalConsentsDto> {
    const rows = await this.consent.list(customerId);
    return { texts: CONSENT_TEXTS, consents: rows.map(consentDto) };
  }

  async grant(customerId: string, b: z.infer<typeof consentGrantSchema>): Promise<ConsentDto> {
    const text = CONSENT_TEXTS.find((t) => t.purpose === b.purpose && t.version === b.textVersion);
    if (!text) throw new BadRequestException({ message: 'That consent wording is not current. Reload and try again', code: 'UNKNOWN_CONSENT' });
    const existing = await this.prisma.consent.findFirst({
      where: { subjectType: 'CUSTOMER', subjectId: customerId, purpose: b.purpose, status: 'GRANTED', textVersion: b.textVersion, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { grantedAt: 'desc' },
    });
    if (existing) return consentDto(existing);
    const ctx = requestContext.get();
    const c = await this.consent.grant(
      { subjectType: 'CUSTOMER', subjectId: customerId, purpose: b.purpose as ConsentPurpose, lawfulBasis: 'CONSENT', textVersion: text.version, channel: 'PORTAL', evidence: text.body },
      null, { ip: ctx?.ip, userAgent: ctx?.userAgent },
    );
    return consentDto(c);
  }

  async revoke(customerId: string, purpose: string): Promise<ConsentDto> {
    if (!(CONSENT_PURPOSES as readonly string[]).includes(purpose)) throw new BadRequestException({ message: 'Unknown consent purpose', code: 'UNKNOWN_CONSENT' });
    const c = await this.prisma.consent.findFirst({ where: { subjectType: 'CUSTOMER', subjectId: customerId, purpose, status: 'GRANTED' }, orderBy: { grantedAt: 'desc' } });
    if (!c) throw new NotFoundException('No active consent to revoke');
    await this.consent.revoke(c.id);
    // revoke any older duplicate grants too so hasValidConsent turns false
    await this.prisma.consent.updateMany({ where: { subjectType: 'CUSTOMER', subjectId: customerId, purpose, status: 'GRANTED' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    return consentDto(await this.prisma.consent.findUniqueOrThrow({ where: { id: c.id } }));
  }
}
