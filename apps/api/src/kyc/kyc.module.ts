import { Body, Controller, Get, Global, Headers, HttpCode, Module, Post, Req, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { NIGERIAN_BANKS } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentCustomer, PortalAuth, Public } from '../common/decorators';
import { APP_ENV, AppEnv } from '../config/config.module';
import { KYC_TIER_PORT } from '../contracts/ports';
import { verifyHmacHexSignature } from '../crypto/webhook-signature';
import type { PortalUser } from '../portal/portal-session.service';
import { CustomerPii } from './customer-pii';
import { DojahKycProvider } from './dojah-kyc.provider';
import { KYC_PROVIDER, KycProvider } from './kyc-provider';
import { KycService } from './kyc.service';
import { KycTierService } from './kyc-tier.service';
import { Inject } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';

const digits = (n: number, label: string) => z.string().trim().regex(new RegExp(`^\\d{${n}}$`), `${label} must be ${n} digits`);
const bvnSchema = z.object({ bvn: digits(11, 'BVN'), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd').optional() });
const ninSchema = z.object({ nin: digits(11, 'NIN') });
const bankSchema = z.object({ accountNumber: digits(10, 'Account number'), bankCode: z.string().trim().refine((c) => NIGERIAN_BANKS.some((b) => b.code === c), 'Choose a supported bank') });
const govIdSchema = z.object({ idType: z.enum(['DRIVERS_LICENSE', 'VOTERS_CARD', 'INTL_PASSPORT']), idNumber: z.string().trim().regex(/^[A-Za-z0-9-]{6,24}$/, 'Enter the ID number exactly as printed') });
const addressSchema = z.object({ line1: z.string().trim().min(5).max(200), city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(40), landmark: z.string().trim().max(120).optional() });
const faceCompleteSchema = z.object({ referenceId: z.string().min(6).max(100), sdkEvent: z.string().max(200).optional() });

const LIMIT = Number(process.env.AUTH_THROTTLE_LIMIT ?? 10);
/** Provider calls cost money: tight per-IP limit on top of the per-customer daily caps. */
const kycThrottle = { default: { limit: Math.max(LIMIT, 20), ttl: 60_000 } };

@Controller('portal/kyc')
@PortalAuth()
class PortalKycController {
  constructor(private svc: KycService) {}

  @Post('bvn') @HttpCode(200) @Throttle(kycThrottle)
  bvn(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(bvnSchema)) b: z.infer<typeof bvnSchema>) { return this.svc.verifyBvn(c.id, b); }

  @Post('nin') @HttpCode(200) @Throttle(kycThrottle)
  nin(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(ninSchema)) b: z.infer<typeof ninSchema>) { return this.svc.verifyNin(c.id, b); }

  @Post('bank-account') @HttpCode(200) @Throttle(kycThrottle)
  bank(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(bankSchema)) b: z.infer<typeof bankSchema>) { return this.svc.verifyBank(c.id, b); }

  @Post('gov-id') @HttpCode(200) @Throttle(kycThrottle)
  govId(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(govIdSchema)) b: z.infer<typeof govIdSchema>) { return this.svc.verifyGovId(c.id, b); }

  @Post('address') @HttpCode(200) @Throttle(kycThrottle)
  address(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(addressSchema)) b: z.infer<typeof addressSchema>) { return this.svc.verifyAddress(c.id, b); }

  @Get('address') @Throttle(kycThrottle)
  addressStatus(@CurrentCustomer() c: PortalUser) { return this.svc.pollAddress(c.id); }

  @Get('verifications')
  list(@CurrentCustomer() c: PortalUser) { return this.svc.list(c.id); }

  @Post('face/session') @HttpCode(200) @Throttle(kycThrottle)
  faceSession(@CurrentCustomer() c: PortalUser) { return this.svc.startFace(c.id); }

  @Post('face/complete') @HttpCode(200) @Throttle(kycThrottle)
  faceComplete(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(faceCompleteSchema)) b: z.infer<typeof faceCompleteSchema>) { return this.svc.completeFace(c.id, b); }
}

@Controller('webhooks')
class WebhooksController {
  constructor(private svc: KycService, private audit: AuditService, @Inject(APP_ENV) private env: AppEnv) {}

  /** Dojah → us. HMAC-SHA256 of the RAW body (DOJAH_WEBHOOK_SECRET), hex, header x-dojah-signature. Fails closed when no secret is set. */
  @Public() @Post('dojah') @HttpCode(200)
  async dojah(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    if (!req.rawBody) throw new BadRequestException({ message: 'Empty body', code: 'EMPTY_BODY' });
    const sig = headers['x-dojah-signature'];
    const v = verifyHmacHexSignature({ secret: this.env.DOJAH_WEBHOOK_SECRET, signature: Array.isArray(sig) ? sig[0] : sig, rawBody: req.rawBody });
    if (!v.ok) {
      await this.audit.record({ action: 'webhook.rejected', resourceType: 'Webhook', resourceId: 'dojah', outcome: 'DENIED', actorName: 'Dojah webhook', metadata: { reason: v.reason } });
      throw new UnauthorizedException({ message: 'Invalid signature', code: 'INVALID_SIGNATURE' });
    }
    return this.svc.handleWebhook(req.rawBody, headers);
  }
}

/** Provides KYC_TIER_PORT; also exports CustomerPii + KycService for the other onboarding modules. */
@Global()
@Module({
  controllers: [PortalKycController, WebhooksController],
  providers: [
    CustomerPii, KycTierService, KycService,
    { provide: KYC_TIER_PORT, useExisting: KycTierService },
    { provide: KYC_PROVIDER, inject: [APP_ENV], useFactory: (env: AppEnv): KycProvider => new DojahKycProvider(env) },
  ],
  exports: [CustomerPii, KycTierService, KycService, KYC_TIER_PORT, KYC_PROVIDER],
})
export class KycModule {}
