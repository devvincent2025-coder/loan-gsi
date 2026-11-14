import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser } from '../common/auth-user';
import { ANY_PERMISSIONS, IS_PUBLIC, NO_TOUCH, PERMISSIONS, PORTAL } from '../common/decorators';
import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE, PortalSessionService, PortalUser } from '../portal/portal-session.service';
import { requestContext } from '../common/request-context';
import { TokenService } from '../crypto/token.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Global guard: session → CSRF → permissions (in that order). */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private auth: AuthService,
    private tokens: TokenService,
    @Inject(AuditService) private audit: AuditService,
    private portalSessions: PortalSessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser; customer?: PortalUser }>();

    // ── customer portal surface: own cookie, own CSRF cookie, no RBAC ──
    if (this.reflector.getAllAndOverride<boolean>(PORTAL, targets)) {
      const ptoken = req.cookies?.[PORTAL_SESSION_COOKIE] as string | undefined;
      if (!ptoken) throw new UnauthorizedException({ message: 'Not signed in', code: 'NO_SESSION' });
      const noTouchP = req.headers['x-background-poll'] === '1';
      const cust = await this.portalSessions.resolve(ptoken, !noTouchP);
      if (!cust) throw new UnauthorizedException({ message: 'Session expired. Please sign in again.', code: 'SESSION_EXPIRED' });
      req.customer = cust;
      requestContext.setCustomer(cust);
      if (!SAFE.has(req.method)) {
        const c = req.cookies?.[PORTAL_CSRF_COOKIE] as string | undefined;
        const h = req.headers[CSRF_HEADER] as string | undefined;
        if (!c || !h || !this.tokens.safeEqual(c, h)) throw new ForbiddenException({ message: 'CSRF token missing or invalid', code: 'CSRF' });
      }
      return true;
    }

    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException({ message: 'Not signed in', code: 'NO_SESSION' });
    const noTouch = this.reflector.getAllAndOverride<boolean>(NO_TOUCH, targets) || req.headers['x-background-poll'] === '1';
    const user = await this.auth.resolveSession(token, !noTouch);
    if (!user) throw new UnauthorizedException({ message: 'Session expired. Please sign in again.', code: 'SESSION_EXPIRED' });
    req.user = user;
    requestContext.setUser(user);

    if (!SAFE.has(req.method)) {
      const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
      const header = req.headers[CSRF_HEADER] as string | undefined;
      if (!cookie || !header || !this.tokens.safeEqual(cookie, header)) {
        throw new ForbiddenException({ message: 'CSRF token missing or invalid', code: 'CSRF' });
      }
    }

    const all = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];
    const any = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS, targets) ?? [];
    const okAll = all.every((p) => user.permissions.has(p));
    const okAny = any.length === 0 || any.some((p) => user.permissions.has(p));
    if (!okAll || !okAny) {
      await this.audit.record({
        action: 'access.denied', resourceType: 'Route', resourceId: `${req.method} ${req.originalUrl.split('?')[0]}`,
        outcome: 'DENIED', metadata: { required: [...all, ...any] },
      });
      throw new ForbiddenException({ message: 'You do not have permission to do that', code: 'FORBIDDEN', required: [...all, ...any] });
    }
    return true;
  }
}
