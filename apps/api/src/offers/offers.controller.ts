import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AcceptOfferDto, CreateOfferDto, LoanOfferDto } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentCustomer, CurrentUser, PortalAuth, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { PortalUser } from '../portal/portal-session.service';
import { OffersService } from './offers.service';

const kobo = z.number().int().positive();
const createOfferSchema = z.object({
  principalKobo: kobo, tenorMonths: z.number().int().min(1).max(120), monthlyRateBps: z.number().int().min(1).max(2500).optional(),
  isCounterOffer: z.boolean().optional(), note: z.string().trim().max(500).optional(),
});
const acceptOfferSchema = z.object({
  otpCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  eSignatureName: z.string().trim().min(2).max(120),
  acceptedTermsVersion: z.string().trim().min(1).max(40),
  waiveCoolingOff: z.boolean().optional(),
});
const declineOfferSchema = z.object({ reason: z.string().trim().max(500).optional() });

function sendPdf(res: Response, fileName: string, bytes: Buffer): StreamableFile {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': String(bytes.length),
  });
  return new StreamableFile(bytes);
}

/** Staff underwriting console: offer creation and dispatch. */
@Controller()
export class StaffOffersController {
  constructor(private svc: OffersService) {}

  @Post('applications/:id/offers') @RequirePermission('offer:create')
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createOfferSchema)) b: z.infer<typeof createOfferSchema>): Promise<LoanOfferDto> {
    return this.svc.createOffer(u, id, b as Omit<CreateOfferDto, 'applicationId'>);
  }

  @Get('applications/:id/offers') @RequirePermission('offer:read')
  list(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<LoanOfferDto[]> { return this.svc.listForApplication(u, id); }

  @Post('offers/:id/send') @HttpCode(200) @RequirePermission('offer:create')
  send(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<LoanOfferDto> { return this.svc.sendOffer(u, id); }

  @Get('offers/:id/letter.pdf') @RequirePermission('offer:read')
  async letter(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.svc.letterPdf(id, u, null);
    return sendPdf(res, f.fileName, f.bytes);
  }
}

/** Customer-portal offer review, e-signature + OTP acceptance, decline. */
@Controller('portal')
@PortalAuth()
export class PortalOffersController {
  constructor(private svc: OffersService) {}

  @Get('applications/:id/offer')
  latest(@CurrentCustomer() c: PortalUser, @Param('id') id: string): Promise<LoanOfferDto | null> { return this.svc.latestForApplicationPortal(c.id, id); }

  @Get('offers/:id/letter.pdf')
  async letter(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.svc.letterPdf(id, null, c.id);
    return sendPdf(res, f.fileName, f.bytes);
  }

  @Post('offers/:id/request-otp') @HttpCode(200)
  requestOtp(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.requestAcceptanceOtp(c.id, id, { ip: req.ip ?? null });
  }

  @Post('offers/:id/accept') @HttpCode(200)
  accept(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Body(new ZodPipe(acceptOfferSchema)) b: z.infer<typeof acceptOfferSchema>, @Req() req: Request): Promise<LoanOfferDto> {
    const ua = req.headers['user-agent'];
    return this.svc.acceptOffer(c.id, id, b as AcceptOfferDto, { ip: req.ip ?? null, userAgent: Array.isArray(ua) ? (ua[0] ?? null) : ua ?? null });
  }

  @Post('offers/:id/decline') @HttpCode(200)
  decline(@CurrentCustomer() c: PortalUser, @Param('id') id: string, @Body(new ZodPipe(declineOfferSchema)) b: z.infer<typeof declineOfferSchema>): Promise<LoanOfferDto> {
    return this.svc.declineOffer(c.id, id, b.reason);
  }
}
