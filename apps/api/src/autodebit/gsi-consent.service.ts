import { BadRequestException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { OtpChallengeResponse } from '@damez/shared';
import { ConsentService } from '../consent/consent.module';
import { APP_ENV, AppEnv } from '../config/config.module';
import { FieldCipher } from '../crypto/field-cipher';
import { requestContext } from '../common/request-context';
import { NotificationsService } from '../notifications/notifications.service';
import { generateOtp, hashOtp, otpMatches, otpUsable } from '../portal-auth/otp';
import { PrismaService } from '../prisma/prisma.service';

const PURPOSE = 'GSI_CONSENT';
const TTL_SECONDS = 300;
const MAX_PER_HOUR = 5;
const GENERIC_INVALID = { message: 'That code is incorrect or has expired. Request a new one.', code: 'OTP_INVALID' };

/**
 * Records the GSI_AUTODEBIT consent (used to gate mandate activation AND GSI triggers) behind a one-time code,
 * mirroring the portal-auth OTP flow (reusing `OtpChallenge` + its hash/attempt helpers).
 */
@Injectable()
export class GsiConsentService {
  private log = new Logger('GsiConsent');

  constructor(
    private prisma: PrismaService, private cipher: FieldCipher, private consent: ConsentService, private notifications: NotificationsService,
    @Inject(APP_ENV) private env: AppEnv,
  ) {}

  private get demo(): boolean { return this.env.DEMO_MODE && this.env.NODE_ENV !== 'production'; }

  async requestOtp(customerId: string): Promise<OtpChallengeResponse> {
    const since = new Date(Date.now() - 3600_000);
    const recent = await this.prisma.otpChallenge.count({ where: { customerId, purpose: PURPOSE, createdAt: { gte: since } } });
    if (recent >= MAX_PER_HOUR) throw new HttpException({ message: 'Too many codes requested. Please try again later.', code: 'OTP_THROTTLED' }, 429);

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { phoneEnc: true, phoneVerifiedAt: true, phoneHash: true } });
    const id = randomUUID();
    const code = generateOtp();
    await this.prisma.otpChallenge.create({
      data: { id, purpose: PURPOSE, customerId, destinationHash: customer?.phoneHash ?? customerId, codeHash: hashOtp(this.cipher, id, code), expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) },
    });
    if (customer?.phoneVerifiedAt && customer.phoneEnc) {
      const phone = this.cipher.decrypt(customer.phoneEnc, `customer:${customerId}:phone`);
      try { await this.notifications.send({ channel: 'SMS', to: phone, templateKey: 'otp', variables: { code } }); } catch (e) { this.log.warn(`could not send GSI consent OTP: ${(e as Error).message}`); }
    }
    return { challengeId: id, expiresInSeconds: TTL_SECONDS, resendAfterSeconds: 45, destination: 'your registered phone', ...(this.demo ? { demoCode: code } : {}) };
  }

  async verifyAndGrant(customerId: string, args: { challengeId?: string; otpCode: string; acknowledged: boolean }): Promise<{ granted: boolean }> {
    if (!args.acknowledged) throw new BadRequestException({ message: 'You must acknowledge the GSI authorization terms', code: 'ACKNOWLEDGEMENT_REQUIRED' });
    const ch = args.challengeId
      ? await this.prisma.otpChallenge.findUnique({ where: { id: args.challengeId } })
      : await this.prisma.otpChallenge.findFirst({ where: { customerId, purpose: PURPOSE, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!ch || ch.customerId !== customerId || ch.purpose !== PURPOSE) throw new BadRequestException(GENERIC_INVALID);

    const usable = otpUsable(ch, this.env.OTP_MAX_ATTEMPTS);
    if (usable !== 'OK') throw new BadRequestException(GENERIC_INVALID);
    const took = await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, attempts: { lt: this.env.OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    if (took.count === 0) throw new BadRequestException(GENERIC_INVALID);
    if (!otpMatches(this.cipher, ch.id, args.otpCode, ch.codeHash)) throw new BadRequestException(GENERIC_INVALID);
    const used = await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (used.count === 0) throw new BadRequestException(GENERIC_INVALID);

    const ctx = requestContext.get();
    await this.consent.grant(
      { subjectType: 'CUSTOMER', subjectId: customerId, purpose: 'GSI_AUTODEBIT', lawfulBasis: 'CONSENT', textVersion: 'autodebit-v1', channel: 'PORTAL' },
      null, { ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null },
    );
    return { granted: true };
  }
}
