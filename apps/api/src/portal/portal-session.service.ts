import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import { TokenService } from '../crypto/token.service';
import { PrismaService } from '../prisma/prisma.service';

export const PORTAL_SESSION_COOKIE = 'csid';
export const PORTAL_CSRF_COOKIE = 'ccsrf';

export interface PortalUser { id: string; sessionId: string }

/** Customer-portal sessions: a SEPARATE model from staff sessions (different cookie, table, timeouts, no RBAC). */
@Injectable()
export class PortalSessionService {
  constructor(@Inject(APP_ENV) private env: AppEnv, private prisma: PrismaService, private tokens: TokenService) {}

  async create(customerId: string, ctx: { ip: string | null; userAgent: string | null; deviceHash?: string | null }) {
    const token = this.tokens.random(32);
    const expiresAt = new Date(Date.now() + this.env.PORTAL_SESSION_ABSOLUTE_SECONDS * 1000);
    const s = await this.prisma.customerSession.create({
      data: { customerId, tokenHash: this.tokens.sha256(token), ip: ctx.ip, userAgent: ctx.userAgent, deviceHash: ctx.deviceHash ?? null, expiresAt },
    });
    return { token, csrf: this.tokens.random(24), expiresAt, sessionId: s.id };
  }

  async resolve(token: string, touch = true): Promise<PortalUser | null> {
    const s = await this.prisma.customerSession.findUnique({ where: { tokenHash: this.tokens.sha256(token) } });
    if (!s || s.revokedAt) return null;
    const now = Date.now();
    if (s.expiresAt.getTime() <= now) return null;
    if (s.lastActiveAt.getTime() + this.env.PORTAL_SESSION_IDLE_SECONDS * 1000 <= now) {
      await this.prisma.customerSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      return null;
    }
    if (touch && now - s.lastActiveAt.getTime() > 15_000) await this.prisma.customerSession.update({ where: { id: s.id }, data: { lastActiveAt: new Date() } });
    return { id: s.customerId, sessionId: s.id };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.customerSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  cookieOptions(expiresAt: Date) {
    return { sameSite: 'lax' as const, secure: this.env.COOKIE_SECURE, path: '/', maxAge: expiresAt.getTime() - Date.now() };
  }
}
