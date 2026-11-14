import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { maskPhone, type AcceptOfferDto, type CreateOfferDto, type LoanOfferDto, type OfferStatus } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import type { ActorRef } from '../applications/application-transitions';
import { ApplicationTransitions } from '../applications/application-transitions';
import { readPricing } from '../applications/mappers';
import type { AuthUser } from '../common/auth-user';
import { canSeeBranch } from '../common/auth-user';
import { APP_ENV, AppEnv } from '../config/config.module';
import { FieldCipher } from '../crypto/field-cipher';
import { generateOtp, hashOtp, otpMatches, otpUsable } from '../portal-auth/otp';
import { NotificationsService } from '../notifications/notifications.service';
import { OBJECT_STORAGE, ObjectStorage } from '../storage/object-storage';
import { PrismaService } from '../prisma/prisma.service';
import { computeOffer } from './offer-schedule';
import { renderOfferLetterPdf } from './offer-letter';

const OPEN_OFFER_STATUSES: OfferStatus[] = ['DRAFT', 'SENT'];
/** Application statuses from which a new offer (incl. a counter-offer) may be created. */
const OFFER_CREATABLE_STATUSES = ['APPROVED', 'OFFER_SENT'];
const OTP_TTL_SECONDS = 300;
const OTP_PURPOSE = (offerId: string) => `OFFER_ACCEPTANCE:${offerId}`;

type OfferRow = Prisma.LoanOfferGetPayload<{ include: { application: { include: { product: true; customer: true } }; acceptance: true } }>;
const include = { application: { include: { product: true, customer: true } }, acceptance: true } satisfies Prisma.LoanOfferInclude;

const staffActor = (u: AuthUser): ActorRef => ({ type: 'STAFF', id: u.id, name: u.fullName, permissions: u.permissions, branchId: u.branchId });

@Injectable()
export class OffersService {
  private log = new Logger('OffersService');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private transitions: ApplicationTransitions,
    private notifications: NotificationsService,
    private cipher: FieldCipher,
    @Inject(APP_ENV) private env: AppEnv,
    @Inject(OBJECT_STORAGE) private storage: ObjectStorage,
  ) {}

  /* ───────── mapping ───────── */
  toDto(r: OfferRow): LoanOfferDto {
    return {
      id: r.id, applicationId: r.applicationId, offerNumber: r.offerNumber, isCounterOffer: r.isCounterOffer,
      principalKobo: Number(r.principalKobo), tenorMonths: r.tenorMonths, monthlyRateBps: r.monthlyRateBps, interestMethod: r.interestMethod,
      totalInterestKobo: Number(r.totalInterestKobo), totalFeesKobo: Number(r.totalFeesKobo), totalCostOfCreditKobo: Number(r.totalCostOfCreditKobo),
      totalRepayableKobo: Number(r.totalRepayableKobo), gsiBps: r.gsiBps, schedule: r.scheduleJson as unknown as LoanOfferDto['schedule'],
      autodebitConsentRequired: r.autodebitConsentRequired, gsiConsentRequired: r.gsiConsentRequired, coolingOffHours: r.coolingOffHours,
      status: r.status as OfferStatus, sentAt: r.sentAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null,
      acceptedAt: r.acceptedAt?.toISOString() ?? null, declinedAt: r.declinedAt?.toISOString() ?? null, declineReason: r.declineReason,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** <year>-<application-seq>-<offer-seq>, e.g. OFR-2026-000123-1 */
  private async nextOfferNumber(reference: string, applicationId: string, tx: Prisma.TransactionClient): Promise<string> {
    const count = await tx.loanOffer.count({ where: { applicationId } });
    return `OFR-${reference.replace(/^APP-/, '')}-${count + 1}`;
  }

  private async expireIfDue(o: { id: string; status: string; expiresAt: Date | null }): Promise<OfferStatus> {
    if (o.status === 'SENT' && o.expiresAt && o.expiresAt.getTime() <= Date.now()) {
      await this.prisma.loanOffer.updateMany({ where: { id: o.id, status: 'SENT' }, data: { status: 'EXPIRED' } });
      return 'EXPIRED';
    }
    return o.status as OfferStatus;
  }

  /* ───────── staff ───────── */

  async listForApplication(user: AuthUser, applicationId: string): Promise<LoanOfferDto[]> {
    const app = await this.prisma.loanApplication.findUnique({ where: { id: applicationId } });
    if (!app || !canSeeBranch(user, app.branchId)) throw new NotFoundException('Application not found');
    const rows = await this.prisma.loanOffer.findMany({ where: { applicationId }, include, orderBy: { createdAt: 'desc' } });
    await Promise.all(rows.map((r) => this.expireIfDue(r)));
    return rows.map((r) => this.toDto(r));
  }

  async createOffer(user: AuthUser, applicationId: string, input: Omit<CreateOfferDto, 'applicationId'>): Promise<LoanOfferDto> {
    const app = await this.prisma.loanApplication.findUnique({ where: { id: applicationId }, include: { product: true } });
    if (!app || !canSeeBranch(user, app.branchId)) throw new NotFoundException('Application not found');
    if (!OFFER_CREATABLE_STATUSES.includes(app.status)) {
      throw new ConflictException({ message: `An offer cannot be created while the application is ${app.status}`, code: 'ILLEGAL_STATE' });
    }
    const pricing = readPricing(app.pricing);
    const computed = computeOffer({ principalKobo: input.principalKobo, tenorMonths: input.tenorMonths, pricing, monthlyRateBps: input.monthlyRateBps });

    const row = await this.prisma.$transaction(async (tx) => {
      const withdrawn = await tx.loanOffer.updateMany({ where: { applicationId, status: { in: OPEN_OFFER_STATUSES } }, data: { status: 'WITHDRAWN' } });
      const offerNumber = await this.nextOfferNumber(app.reference, applicationId, tx);
      const now = new Date();
      const created = await tx.loanOffer.create({
        data: {
          applicationId, offerNumber, isCounterOffer: input.isCounterOffer ?? (app.status === 'OFFER_SENT' || withdrawn.count > 0),
          principalKobo: BigInt(input.principalKobo), tenorMonths: input.tenorMonths, monthlyRateBps: computed.monthlyRateBps, interestMethod: computed.interestMethod,
          totalInterestKobo: BigInt(computed.totalInterestKobo), totalFeesKobo: BigInt(computed.totalFeesKobo), totalPenaltyProjectedKobo: BigInt(computed.totalPenaltyProjectedKobo),
          totalCostOfCreditKobo: BigInt(computed.totalCostOfCreditKobo), totalRepayableKobo: BigInt(computed.totalRepayableKobo), gsiBps: 0,
          scheduleJson: computed.schedule as unknown as Prisma.InputJsonValue, autodebitConsentRequired: true, gsiConsentRequired: true,
          coolingOffHours: this.env.OFFER_COOLING_OFF_HOURS, expiresAt: new Date(now.getTime() + this.env.OFFER_EXPIRY_HOURS * 3600_000), status: 'DRAFT', createdById: user.id,
        },
        include,
      });
      await this.audit.record({
        action: 'offer.created', resourceType: 'LoanOffer', resourceId: created.id, branchId: app.branchId,
        after: { applicationId, principalKobo: input.principalKobo, tenorMonths: input.tenorMonths, isCounterOffer: created.isCounterOffer, offerNumber }, metadata: { note: input.note ?? null },
      }, tx);
      return created;
    });
    return this.toDto(row);
  }

  async getOfferForStaff(user: AuthUser, offerId: string): Promise<OfferRow> {
    const o = await this.prisma.loanOffer.findUnique({ where: { id: offerId }, include });
    if (!o || !canSeeBranch(user, o.application.branchId)) throw new NotFoundException('Offer not found');
    return o;
  }

  async sendOffer(user: AuthUser, offerId: string): Promise<LoanOfferDto> {
    const o = await this.getOfferForStaff(user, offerId);
    if (o.status !== 'DRAFT') throw new ConflictException({ message: `Only a draft offer can be sent (this one is ${o.status})`, code: 'ILLEGAL_STATE' });

    const pdf = await renderOfferLetterPdf({
      borrowerName: `${o.application.customer.firstName} ${o.application.customer.lastName}`,
      reference: o.application.reference, offerNumber: o.offerNumber, isCounterOffer: o.isCounterOffer, productName: o.application.product.name,
      principalKobo: Number(o.principalKobo), tenorMonths: o.tenorMonths, monthlyRateBps: o.monthlyRateBps, interestMethod: o.interestMethod,
      totalInterestKobo: Number(o.totalInterestKobo), totalFeesKobo: Number(o.totalFeesKobo), totalCostOfCreditKobo: Number(o.totalCostOfCreditKobo),
      totalRepayableKobo: Number(o.totalRepayableKobo), schedule: o.scheduleJson as unknown as LoanOfferDto['schedule'], expiresAt: o.expiresAt ?? new Date(),
      coolingOffHours: o.coolingOffHours, autodebitConsentRequired: o.autodebitConsentRequired, gsiConsentRequired: o.gsiConsentRequired, generatedAt: new Date(),
    });
    const key = `offers/${o.applicationId}/${o.id}.pdf`;
    await this.storage.put(key, pdf);

    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const sent = await tx.loanOffer.update({ where: { id: o.id }, data: { status: 'SENT', sentAt: now, pdfStorageKey: key }, include });
      await this.audit.record({ action: 'offer.sent', resourceType: 'LoanOffer', resourceId: o.id, branchId: o.application.branchId, before: { status: 'DRAFT' }, after: { status: 'SENT' } }, tx);
      return sent;
    });
    // first offer on this application moves it to OFFER_SENT; a later counter-offer while already OFFER_SENT is a no-op transition
    if (o.application.status === 'APPROVED') {
      await this.transitions.apply(o.applicationId, 'OFFER_SENT', staffActor(user));
    }
    return this.toDto(row);
  }

  async letterPdf(offerId: string, forStaff: AuthUser | null, forCustomerId: string | null): Promise<{ bytes: Buffer; fileName: string }> {
    const o = await this.prisma.loanOffer.findUnique({ where: { id: offerId }, include });
    if (!o) throw new NotFoundException('Offer not found');
    if (forStaff && !canSeeBranch(forStaff, o.application.branchId)) throw new NotFoundException('Offer not found');
    if (forCustomerId && o.application.customerId !== forCustomerId) throw new NotFoundException('Offer not found');
    if (!o.pdfStorageKey) throw new ConflictException({ message: 'This offer has not been sent yet', code: 'OFFER_NOT_SENT' });
    const bytes = await this.storage.get(o.pdfStorageKey);
    return { bytes, fileName: `${o.offerNumber}.pdf` };
  }

  /* ───────── portal ───────── */

  private async ownOffer(customerId: string, offerId: string): Promise<OfferRow> {
    const o = await this.prisma.loanOffer.findUnique({ where: { id: offerId }, include });
    if (!o || o.application.customerId !== customerId) throw new NotFoundException('Offer not found');
    return o;
  }

  async latestForApplicationPortal(customerId: string, applicationId: string): Promise<LoanOfferDto | null> {
    const app = await this.prisma.loanApplication.findFirst({ where: { id: applicationId, customerId } });
    if (!app) throw new NotFoundException('Application not found');
    const o = await this.prisma.loanOffer.findFirst({ where: { applicationId, status: { not: 'WITHDRAWN' } }, include, orderBy: { createdAt: 'desc' } });
    if (!o) return null;
    await this.expireIfDue(o);
    const fresh = await this.prisma.loanOffer.findUniqueOrThrow({ where: { id: o.id }, include });
    return this.toDto(fresh);
  }

  /** Issues (or re-issues, respecting the resend cooldown) the OTP the customer must supply to accept. */
  async requestAcceptanceOtp(customerId: string, offerId: string, ctx: { ip: string | null }): Promise<{ expiresInSeconds: number; destination: string; demoCode?: string }> {
    const o = await this.ownOffer(customerId, offerId);
    if (o.status !== 'SENT') throw new ConflictException({ message: `Cannot accept an offer that is ${o.status.toLowerCase()}`, code: 'ILLEGAL_STATE' });
    if (o.expiresAt && o.expiresAt.getTime() <= Date.now()) { await this.expireIfDue(o); throw new ConflictException({ message: 'This offer has expired', code: 'OFFER_EXPIRED' }); }
    const phone = this.decryptVerifiedPhone(o.application.customer, o.application.customerId);
    if (!phone) throw new BadRequestException({ message: 'A verified phone number is required to accept an offer', code: 'PHONE_NOT_VERIFIED' });

    const id = randomUUID();
    const code = generateOtp();
    await this.prisma.otpChallenge.create({
      data: { id, purpose: OTP_PURPOSE(o.id), customerId, destinationHash: o.application.customer.phoneHash, codeHash: hashOtp(this.cipher, id, code), ip: ctx.ip, expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000) },
    });
    try { await this.notifications.send({ channel: 'SMS', to: phone, templateKey: 'otp', variables: { code } }); } catch (e) { this.log.error(`offer OTP send failed: ${(e as Error).message}`); }
    const demo = this.env.DEMO_MODE && this.env.NODE_ENV !== 'production';
    return { expiresInSeconds: OTP_TTL_SECONDS, destination: maskPhone(phone), ...(demo ? { demoCode: code } : {}) };
  }

  private decryptVerifiedPhone(c: { phoneEnc: string; phoneVerifiedAt: Date | null }, customerId: string): string | null {
    if (!c.phoneVerifiedAt) return null;
    try { return this.cipher.decrypt(c.phoneEnc, `customer:${customerId}:phone`); } catch { return null; }
  }

  /** Minimum linked, VERIFIED accounts required before an offer may be accepted (primary + configured minimum). Local query — no cross-module import. */
  private async linkedAccountsVerified(customerId: string): Promise<boolean> {
    const verified = await this.prisma.linkedAccount.count({ where: { customerId, status: 'VERIFIED' } });
    return verified >= this.env.AUTODEBIT_MIN_LINKED_ACCOUNTS + 1;
  }

  async acceptOffer(customerId: string, offerId: string, input: AcceptOfferDto, ctx: { ip: string | null; userAgent: string | null }): Promise<LoanOfferDto> {
    const o = await this.ownOffer(customerId, offerId);
    if (o.status !== 'SENT') throw new ConflictException({ message: `Cannot accept an offer that is ${o.status.toLowerCase()}`, code: 'ILLEGAL_STATE' });
    if (!o.expiresAt || o.expiresAt.getTime() <= Date.now()) { await this.expireIfDue(o); throw new ConflictException({ message: 'This offer has expired', code: 'OFFER_EXPIRED' }); }
    if (!(await this.linkedAccountsVerified(customerId))) {
      throw new ForbiddenException({ message: `Link and verify at least ${this.env.AUTODEBIT_MIN_LINKED_ACCOUNTS + 1} bank accounts (including your primary) before accepting`, code: 'LINKED_ACCOUNTS_REQUIRED' });
    }

    const challenge = await this.prisma.otpChallenge.findFirst({ where: { customerId, purpose: OTP_PURPOSE(offerId), consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!challenge) throw new BadRequestException({ message: 'Request a one-time code before accepting', code: 'OTP_NOT_REQUESTED' });
    const usable = otpUsable(challenge, 5);
    if (usable === 'LOCKED') throw new ForbiddenException({ message: 'Too many wrong attempts. Request a new code.', code: 'OTP_LOCKED' });
    if (usable !== 'OK' || !otpMatches(this.cipher, challenge.id, input.otpCode, challenge.codeHash)) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException({ message: 'That code is incorrect or has expired', code: 'OTP_INVALID' });
    }

    const now = new Date();
    const coolingOffEndsAt = new Date(now.getTime() + o.coolingOffHours * 3600_000);
    const eSignatureHash = createHash('sha256').update(`${o.id}:${input.eSignatureName.trim().toLowerCase()}:${now.toISOString()}`).digest('hex');

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.offerAcceptance.create({
        data: {
          offerId: o.id, otpChallengeId: challenge.id, eSignatureName: input.eSignatureName.trim(), eSignatureHash, acceptedTermsVersion: input.acceptedTermsVersion,
          ip: ctx.ip, userAgent: ctx.userAgent, coolingOffEndsAt, coolingOffWaived: !!input.waiveCoolingOff, coolingOffWaivedReason: input.waiveCoolingOff ? 'Customer waived at acceptance' : null,
        },
      });
      const updated = await tx.loanOffer.update({ where: { id: o.id }, data: { status: 'ACCEPTED', acceptedAt: now }, include });
      await this.audit.record({
        action: 'offer.accepted', resourceType: 'LoanOffer', resourceId: o.id, branchId: o.application.branchId,
        actorId: customerId, actorName: 'Customer', actorRole: 'Customer (portal)',
        after: { status: 'ACCEPTED', eSignatureHash, coolingOffEndsAt: coolingOffEndsAt.toISOString() },
      }, tx);
      return updated;
    });

    await this.transitions.apply(o.applicationId, 'OFFER_ACCEPTED', { type: 'CUSTOMER', id: customerId, name: input.eSignatureName.trim() });
    return this.toDto(row);
  }

  /**
   * Decline: we leave the application at OFFER_SENT rather than forcing it to REJECTED. A decline usually means the
   * customer wants different terms (amount/tenor/rate), and staff can see the decline reason on the application and
   * issue a COUNTER_OFFER without re-running the whole underwriting decision. Moving straight to REJECTED would throw
   * away that path and force the customer to start a brand-new application for a minor renegotiation.
   */
  async declineOffer(customerId: string, offerId: string, reason: string | undefined): Promise<LoanOfferDto> {
    const o = await this.ownOffer(customerId, offerId);
    if (o.status !== 'SENT') throw new ConflictException({ message: `Cannot decline an offer that is ${o.status.toLowerCase()}`, code: 'ILLEGAL_STATE' });
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.loanOffer.update({ where: { id: o.id }, data: { status: 'DECLINED', declinedAt: now, declineReason: reason?.trim() || null }, include });
      await this.audit.record({
        action: 'offer.declined', resourceType: 'LoanOffer', resourceId: o.id, branchId: o.application.branchId,
        actorId: customerId, actorName: 'Customer', actorRole: 'Customer (portal)', after: { status: 'DECLINED', reason: reason ?? null },
      }, tx);
      return updated;
    });
    return this.toDto(row);
  }
}
