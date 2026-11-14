import { Body, Controller, Get, HttpCode, Module, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentCustomer, NoTouch, PortalAuth, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_ENV, AppEnv } from '../config/config.module';
import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE, PortalSessionService, PortalUser } from '../portal/portal-session.service';
import { Inject } from '@nestjs/common';
import { emailVerifySchema, loginSchema, PortalAuthService, registerSchema, resendSchema, verifySchema } from './portal-auth.service';

const LIMIT = Number(process.env.AUTH_THROTTLE_LIMIT ?? 10);
/** Per-IP; the per-phone limits live in the service (and apply to unknown numbers too). */
const strict = { default: { limit: LIMIT, ttl: 60_000 } };

@Controller('portal')
class PortalAuthController {
  constructor(private svc: PortalAuthService, private sessions: PortalSessionService, @Inject(APP_ENV) private env: AppEnv) {}

  @Public() @Throttle(strict) @Post('auth/register') @HttpCode(200)
  register(@Body(new ZodPipe(registerSchema)) b: z.infer<typeof registerSchema>) { return this.svc.register(b); }

  @Public() @Throttle(strict) @Post('auth/login') @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) b: z.infer<typeof loginSchema>) { return this.svc.login(b.phone); }

  @Public() @Throttle(strict) @Post('auth/otp/resend') @HttpCode(200)
  resend(@Body(new ZodPipe(resendSchema)) b: z.infer<typeof resendSchema>) { return this.svc.resend(b.challengeId); }

  @Public() @Throttle(strict) @Post('auth/verify-otp') @HttpCode(200)
  async verify(@Body(new ZodPipe(verifySchema)) b: z.infer<typeof verifySchema>, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.verifyOtp(b);
    const base = this.sessions.cookieOptions(r.session.expiresAt);
    res.cookie(PORTAL_SESSION_COOKIE, r.session.token, { ...base, httpOnly: true });
    res.cookie(PORTAL_CSRF_COOKIE, r.session.csrf, { ...base, httpOnly: false });
    return { customer: r.customer };
  }

  @PortalAuth() @Post('auth/logout') @HttpCode(200)
  async logout(@CurrentCustomer() c: PortalUser, @Res({ passthrough: true }) res: Response) {
    await this.svc.logout(c.id, c.sessionId);
    res.clearCookie(PORTAL_SESSION_COOKIE, { path: '/' });
    res.clearCookie(PORTAL_CSRF_COOKIE, { path: '/' });
    return { ok: true };
  }

  @PortalAuth() @NoTouch() @Get('me')
  me(@CurrentCustomer() c: PortalUser) { return this.svc.me(c.id); }

  @PortalAuth() @Throttle(strict) @Post('email/send') @HttpCode(200)
  sendEmail(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(z.object({ email: z.string().email().max(160).optional() }))) b: { email?: string }) { return this.svc.sendEmailCode(c.id, b.email); }

  @PortalAuth() @Throttle(strict) @Post('email/verify') @HttpCode(200)
  verifyEmail(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(emailVerifySchema)) b: z.infer<typeof emailVerifySchema>) { return this.svc.verifyEmail(c.id, b.code); }
}

/** Needs the global KycModule, OnboardingModule, FraudModule, ConsentModule, NotificationsModule and PortalCoreModule. */
@Module({ controllers: [PortalAuthController], providers: [PortalAuthService], exports: [PortalAuthService] })
export class PortalAuthModule {}
