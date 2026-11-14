import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Idempotent, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DisbursementService } from './disbursement.service';

const manualSchema = z.object({ reason: z.string().trim().min(5).max(500) });

const SIGNATURE_HEADERS: Record<string, string> = {
  paystack: 'x-paystack-signature',
  flutterwave: 'verif-hash',
  mono: 'mono-webhook-secret',
};

@Controller('loans/applications')
export class DisbursementController {
  constructor(private svc: DisbursementService) {}

  @Post(':id/disburse')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('loan:disburse')
  disburse(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.svc.initiateAutomated(id, u.id);
  }

  @Post(':id/disburse-manual')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission('loan:disburse_manual')
  disburseManual(@Param('id') id: string, @Body(new ZodPipe(manualSchema)) b: z.infer<typeof manualSchema>, @CurrentUser() u: AuthUser) {
    return this.svc.initiateManual(id, u, b.reason);
  }

  @Get(':id/disbursement')
  @RequirePermission('loan:read')
  get(@Param('id') id: string) {
    return this.svc.getForApplication(id);
  }
}

@Controller('webhooks/disbursement')
class DisbursementWebhookController {
  constructor(private svc: DisbursementService) {}

  /**
   * One route handles all three payout vendors (`:provider` in paystack|flutterwave|mono). The signature header
   * name differs per vendor (see SIGNATURE_HEADERS); verification itself happens inside the service against the
   * raw body, never the parsed JSON. `rawBody` is populated by `NestFactory.create(..., { rawBody: true })` in
   * main.ts (same mechanism the Dojah KYC webhook in `apps/api/src/kyc/kyc.module.ts` relies on).
   */
  @Public() @Post(':provider') @HttpCode(200)
  async handle(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    if (!req.rawBody) throw new BadRequestException({ message: 'Empty body', code: 'EMPTY_BODY' });
    const headerName = SIGNATURE_HEADERS[provider];
    const signature = headerName ? (req.headers[headerName] as string | undefined) : undefined;
    return this.svc.handleWebhook(provider, req.rawBody, signature);
  }
}

export { DisbursementWebhookController };
