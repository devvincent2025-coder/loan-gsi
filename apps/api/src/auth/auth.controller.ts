import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { changePasswordSchema, loginSchema, totpEnrollSchema, totpVerifySchema } from '@damez/shared';
import { Inject } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, NoTouch, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_ENV, AppEnv } from '../config/config.module';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, SESSION_COOKIE } from './access.guard';

const AUTH_LIMIT = Number(process.env.AUTH_THROTTLE_LIMIT ?? 10);
const strict = { default: { limit: AUTH_LIMIT, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, @Inject(APP_ENV) private env: AppEnv) {}

  private ctx(req: Request) {
    return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null };
  }

  @Public()
  @Throttle(strict)
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request) {
    return this.auth.login(body.email, body.password, this.ctx(req));
  }

  @Public()
  @Throttle(strict)
  @Post('totp/enroll')
  @HttpCode(200)
  enroll(@Body(new ZodPipe(totpEnrollSchema)) body: z.infer<typeof totpEnrollSchema>) {
    return this.auth.enrollStart(body.challengeToken);
  }

  @Public()
  @Throttle(strict)
  @Post('totp/verify')
  @HttpCode(200)
  async verify(@Body(new ZodPipe(totpVerifySchema)) body: z.infer<typeof totpVerifySchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.verifyTotp(body.challengeToken, body.code, this.ctx(req));
    const maxAge = r.expiresAt.getTime() - Date.now();
    const base = { sameSite: 'lax' as const, secure: this.env.COOKIE_SECURE, path: '/', maxAge };
    res.cookie(SESSION_COOKIE, r.sessionToken, { ...base, httpOnly: true });
    res.cookie(CSRF_COOKIE, r.csrf, { ...base, httpOnly: false });
    return { user: await this.auth.me(r.user) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** Status read: does not extend the idle timeout. */
  @NoTouch()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.sessions(user);
  }

  @Delete('sessions/:id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.auth.revokeSession(user, id);
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @Public()
  @Get('demo-totp')
  demo(@Query('email') email: string) {
    return this.auth.demoTotp(String(email ?? '').toLowerCase());
  }
}
