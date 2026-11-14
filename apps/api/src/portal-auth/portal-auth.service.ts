import { BadRequestException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { CONSENT_TEXTS, maskPhone, OtpChallengeResponse, PortalMe } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { requestContext } from '../common/request-context';
import { APP_ENV, AppEnv } from '../config/config.module';
import { ConsentService } from '../consent/consent.module';
import { FraudService } from '../fraud/fraud.service';
import { CustomerPii, normalizePhone } from '../kyc/customer-pii';
import { KycService } from '../kyc/kyc.service';
import { KycTierService } from '../kyc/kyc-tier.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { PortalSessionService } from '../portal/portal-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateOtp, hashOtp, otpMatches, otpUsable } from './otp';

export const registerSchema = z.object({
  phone: z.string().trim().regex(/^(?:\+234|0)[789][01]\d{8}$/, 'Enter a valid Nigerian phone number'),
  email: z.string().trim().toLowerCase().email().max(120).optional(),
  firstName: z.string().trim().min(1).max(60).regex(/^[\p{L}][\p{L} '.-]*$/u, 'Letters only'),
  lastName: z.string().trim().min(1).max(60).regex(/^[\p{L}][\p{L} '.-]*$/u, 'Letters only'),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'You must accept the privacy notice' }) }),
});
export const loginSchema = z.object({ phone: registerSchema.shape.phone });
export const resendSchema = z.object({ challengeId: z.string().min(8).max(64) });
export const verifySchema = z.object({ challengeId: z.string().min(8).max(64), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const emailVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

const MAX_RESENDS = 3;
/** Per destination (phone / email hash) challenges per hour, counted for unknown numbers too so throttling reveals nothing. */
const MAX_CHALLENGES_PER_HOUR = 8;
const EMAIL_TTL_SECONDS = 600;
const GENERIC_INVALID = { message: 'That code is incorrect or has expired. Request a new one.', code: 'OTP_INVALID' };

type Kind = 'REGISTER' | 'LOGIN' | 'EMAIL_VERIFY';
/** The masked destination rides inside `purpose` ("LOGIN|0803•••4567") so a resend can answer identically for unknown numbers. */
const packPurpose = (k: Kind, mask: string) => `${k}|${mask}`;
const unpackPurpose = (p: string) => { const [kind, ...rest] = p.split('|'); return { kind: kind as Kind, mask: rest.join('|') }; };

@Injectable()
export class PortalAuthService implements OnModuleInit {
  private log = new Logger('PortalAuth');

  constructor(
    @Inject(APP_ENV) private env: AppEnv, private prisma: PrismaService, private audit: AuditService, private pii: CustomerPii, private notifications: NotificationsService,
    private sessions: PortalSessionService, private consent: ConsentService, private fraud: FraudService, private kyc: KycService, private tiers: KycTierService,
    private onboarding: OnboardingService,
  ) {}

  /** Self-seed the templates this flow needs (idempotent; never overwrites edits made in Settings → Templates). */
  async onModuleInit(): Promise<void> {
    const tpls = [
      { key: 'otp', channel: 'SMS' as const, name: 'One-time code', subject: null, body: 'Your Damez verification code is {{code}}. It expires in 5 minutes. Never share it.', variables: ['code'] },
      { key: 'email_verify', channel: 'EMAIL' as const, name: 'Email verification code', subject: 'Verify your email', body: 'Your Damez email verification code is {{code}}. It expires in 10 minutes. If you did not request it, ignore this email.', variables: ['code'] },
    ];
    for (const t of tpls) {
      try {
        const exists = await this.prisma.notificationTemplate.findUnique({ where: { key_channel: { key: t.key, channel: t.channel } } });
        if (!exists) await this.prisma.notificationTemplate.create({ data: t });
      } catch (e) { this.log.warn(`template seed ${t.key} failed: ${(e as Error).message}`); }
    }
  }

  private get demo(): boolean { return this.env.DEMO_MODE && this.env.NODE_ENV !== 'production'; }
  private ctx() { const c = requestContext.get(); return { ip: c?.ip ?? null, userAgent: c?.userAgent ?? null, fingerprint: c?.deviceFingerprint ?? null }; }

  /* ───────── challenges ───────── */
  private async issue(a: {
    kind: Kind; customerId: string | null; destinationHash: string; mask: string; ttl: number; resendCount?: number;
    send?: { channel: 'SMS' | 'EMAIL'; to: string; templateKey: string };
  }): Promise<OtpChallengeResponse> {
    const since = new Date(Date.now() - 3600_000);
    const recent = await this.prisma.otpChallenge.count({ where: { destinationHash: a.destinationHash, createdAt: { gte: since } } });
    if (recent >= MAX_CHALLENGES_PER_HOUR) throw new HttpException({ message: 'Too many codes requested. Please try again later.', code: 'OTP_THROTTLED' }, 429);

    const id = randomUUID();
    const code = generateOtp();
    await this.prisma.otpChallenge.create({
      data: {
        id, purpose: packPurpose(a.kind, a.mask), customerId: a.customerId, destinationHash: a.destinationHash, codeHash: hashOtp(this.pii.cipher, id, code),
        resendCount: a.resendCount ?? 0, ip: this.ctx().ip, expiresAt: new Date(Date.now() + a.ttl * 1000),
      },
    });
    if (a.send) {
      try { await this.notifications.send({ channel: a.send.channel, to: a.send.to, templateKey: a.send.templateKey, variables: { code } }); } catch (e) {
        this.log.error(`could not send ${a.send.templateKey}: ${(e as Error).message}`); // never surfaced: the response must not reveal delivery state
      }
    }
    return { challengeId: id, expiresInSeconds: a.ttl, resendAfterSeconds: this.env.OTP_RESEND_SECONDS, destination: a.mask, ...(this.demo ? { demoCode: code } : {}) };
  }

  /* ───────── register / login / resend ───────── */
  async register(b: z.infer<typeof registerSchema>): Promise<OtpChallengeResponse> {
    const phone = normalizePhone(b.phone);
    const phoneHash = this.pii.hash(phone, 'phone');
    let c = await this.prisma.customer.findUnique({ where: { phoneHash } });
    if (c?.erasedAt) c = null;
    const mask = maskPhone(phone);
    if (!c) {
      const id = randomUUID();
      const branch = await this.prisma.branch.findFirst({ where: { isHeadOffice: true, isActive: true }, select: { id: true } });
      try {
        c = await this.prisma.customer.create({
          data: {
            id, firstName: b.firstName, lastName: b.lastName, branchId: branch?.id ?? null, phoneEnc: this.pii.enc(id, 'phone', phone), phoneHash,
            emailEnc: b.email ? this.pii.enc(id, 'email', b.email) : null, emailHash: b.email ? this.pii.hash(b.email, 'email') : null,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        c = await this.prisma.customer.findUnique({ where: { phoneHash } });
      }
    }
    if (c && !c.portalRegisteredAt && !(await this.consent.hasValidConsent(c.id, 'DATA_PROCESSING'))) {
      const text = CONSENT_TEXTS.find((t) => t.purpose === 'DATA_PROCESSING')!;
      const ctx = this.ctx();
      await this.consent.grant({ subjectType: 'CUSTOMER', subjectId: c.id, purpose: 'DATA_PROCESSING', lawfulBasis: 'CONSENT', textVersion: text.version, channel: 'PORTAL', evidence: text.body }, null, { ip: ctx.ip, userAgent: ctx.userAgent });
    }
    if (c) await this.fraud.checkRegistrationVelocity(c.id, this.ctx().fingerprint, this.ctx().ip);
    return this.issue({
      kind: 'REGISTER', customerId: c?.id ?? null, destinationHash: phoneHash, mask, ttl: this.env.OTP_TTL_SECONDS,
      send: c ? { channel: 'SMS', to: phone, templateKey: 'otp' } : undefined,
    });
  }

  async login(rawPhone: string): Promise<OtpChallengeResponse> {
    const phone = normalizePhone(rawPhone);
    const phoneHash = this.pii.hash(phone, 'phone');
    const c = await this.prisma.customer.findUnique({ where: { phoneHash } });
    const known = !!c && !c.erasedAt;
    // unknown numbers get an identical response and a real (never-verifiable) challenge: no enumeration
    return this.issue({
      kind: 'LOGIN', customerId: known ? c.id : null, destinationHash: phoneHash, mask: maskPhone(phone), ttl: this.env.OTP_TTL_SECONDS,
      send: known ? { channel: 'SMS', to: phone, templateKey: 'otp' } : undefined,
    });
  }

  async resend(challengeId: string): Promise<OtpChallengeResponse> {
    const ch = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!ch || ch.purpose.startsWith('EMAIL_VERIFY')) throw new BadRequestException(GENERIC_INVALID);
    const { kind, mask } = unpackPurpose(ch.purpose);
    const wait = this.env.OTP_RESEND_SECONDS - Math.floor((Date.now() - ch.createdAt.getTime()) / 1000);
    if (wait > 0) throw new HttpException({ message: `Please wait ${wait}s before requesting another code.`, code: 'RESEND_TOO_SOON', retryAfterSeconds: wait }, 429);
    if (ch.resendCount >= MAX_RESENDS) throw new HttpException({ message: 'Too many resends. Start again.', code: 'OTP_THROTTLED' }, 429);
    await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    let send: { channel: 'SMS'; to: string; templateKey: string } | undefined;
    if (ch.customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: ch.customerId } });
      const phone = c && !c.erasedAt ? this.pii.dec(c.id, 'phone', c.phoneEnc) : null;
      if (phone) send = { channel: 'SMS', to: phone, templateKey: 'otp' };
    }
    return this.issue({ kind, customerId: ch.customerId, destinationHash: ch.destinationHash, mask, ttl: this.env.OTP_TTL_SECONDS, resendCount: ch.resendCount + 1, send });
  }

  /** Atomically spends one attempt, compares in constant time and consumes the challenge on success. Returns the challenge or throws a generic error. */
  private async spend(id: string, code: string, where: { customerId?: string }): Promise<{ customerId: string | null }> {
    const ch = await this.prisma.otpChallenge.findUnique({ where: { id } });
    if (!ch || (where.customerId && ch.customerId !== where.customerId)) throw new BadRequestException(GENERIC_INVALID);
    const usable = otpUsable(ch, this.env.OTP_MAX_ATTEMPTS);
    if (usable === 'LOCKED') throw new HttpException({ message: 'Too many wrong attempts. Request a new code.', code: 'OTP_LOCKED' }, 429);
    if (usable !== 'OK') throw new BadRequestException(GENERIC_INVALID);
    const took = await this.prisma.otpChallenge.updateMany({
      where: { id, consumedAt: null, attempts: { lt: this.env.OTP_MAX_ATTEMPTS }, expiresAt: { gt: new Date() } }, data: { attempts: { increment: 1 } },
    });
    if (took.count === 0) throw new BadRequestException(GENERIC_INVALID);
    if (!ch.customerId || !otpMatches(this.pii.cipher, id, code, ch.codeHash)) throw new BadRequestException(GENERIC_INVALID);
    const used = await this.prisma.otpChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (used.count === 0) throw new BadRequestException(GENERIC_INVALID);
    return { customerId: ch.customerId };
  }

  async verifyOtp(b: z.infer<typeof verifySchema>): Promise<{ customer: PortalMe; session: { token: string; csrf: string; expiresAt: Date } }> {
    const { customerId } = await this.spend(b.challengeId, b.code, {});
    const c = await this.prisma.customer.findUnique({ where: { id: customerId! } });
    if (!c || c.erasedAt) throw new BadRequestException(GENERIC_INVALID);
    const now = new Date();
    const first = !c.portalRegisteredAt;
    await this.prisma.customer.update({ where: { id: c.id }, data: { phoneVerifiedAt: c.phoneVerifiedAt ?? now, portalRegisteredAt: c.portalRegisteredAt ?? now } });
    const { ip, userAgent, fingerprint } = this.ctx();
    const session = await this.sessions.create(c.id, { ip, userAgent, deviceHash: fingerprint ? createHash('sha256').update(fingerprint).digest('hex') : null });
    await this.kyc.recordPhoneVerified(c.id);
    await this.fraud.recordDevice(c.id, fingerprint, ip, userAgent);
    await this.fraud.scanDuplicates(c.id);
    await this.tiers.refreshTier(c.id);
    await this.audit.record({
      action: first ? 'portal.registered' : 'portal.login', resourceType: 'Customer', resourceId: c.id, branchId: c.branchId,
      actorId: c.id, actorName: 'Customer', actorRole: 'Customer (portal)', metadata: { deviceKnown: !!fingerprint },
    });
    return { customer: await this.onboarding.me(c.id), session };
  }

  async logout(customerId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.record({ action: 'portal.logout', resourceType: 'Customer', resourceId: customerId });
  }

  /* ───────── email ───────── */
  async sendEmailCode(customerId: string, newEmail?: string): Promise<{ sent: true; demoCode?: string }> {
    let c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    // email is optional at registration: let the customer add one here (only while none is on file / unverified)
    if (newEmail && (!c.emailEnc || !c.emailVerifiedAt)) {
      const e = newEmail.trim().toLowerCase();
      c = await this.prisma.customer.update({ where: { id: customerId }, data: { emailEnc: this.pii.enc(c.id, 'email', e), emailHash: this.pii.hash(e, 'email'), emailVerifiedAt: null } });
      await this.audit.record({ action: 'portal.email_set', resourceType: 'Customer', resourceId: customerId });
    }
    const email = this.pii.dec(c.id, 'email', c.emailEnc);
    if (!email || !c.emailHash) throw new BadRequestException({ message: 'Add an email address first', code: 'NO_EMAIL' });
    const last = await this.prisma.otpChallenge.findFirst({ where: { customerId, purpose: { startsWith: 'EMAIL_VERIFY' } }, orderBy: { createdAt: 'desc' } });
    if (last) {
      const wait = this.env.OTP_RESEND_SECONDS - Math.floor((Date.now() - last.createdAt.getTime()) / 1000);
      if (wait > 0) throw new HttpException({ message: `Please wait ${wait}s before requesting another code.`, code: 'RESEND_TOO_SOON', retryAfterSeconds: wait }, 429);
    }
    const r = await this.issue({ kind: 'EMAIL_VERIFY', customerId, destinationHash: c.emailHash, mask: email.replace(/^(.).*(@.*)$/, '$1•••$2'), ttl: EMAIL_TTL_SECONDS, send: { channel: 'EMAIL', to: email, templateKey: 'email_verify' } });
    return { sent: true, ...(r.demoCode ? { demoCode: r.demoCode } : {}) };
  }

  async verifyEmail(customerId: string, code: string): Promise<PortalMe> {
    const ch = await this.prisma.otpChallenge.findFirst({ where: { customerId, purpose: { startsWith: 'EMAIL_VERIFY' }, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!ch) throw new BadRequestException(GENERIC_INVALID);
    await this.spend(ch.id, code, { customerId });
    await this.prisma.customer.update({ where: { id: customerId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record({ action: 'portal.email_verified', resourceType: 'Customer', resourceId: customerId });
    return this.onboarding.me(customerId);
  }

  async me(customerId: string): Promise<PortalMe> {
    const exists = await this.prisma.customer.findFirst({ where: { id: customerId, erasedAt: null }, select: { id: true } });
    if (!exists) throw new NotFoundException('Account not found');
    return this.onboarding.me(customerId);
  }
}
