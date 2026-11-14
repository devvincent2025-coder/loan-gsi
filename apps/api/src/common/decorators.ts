import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';
import type { PortalUser } from '../portal/portal-session.service';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS = 'permissions';
export const ANY_PERMISSIONS = 'anyPermissions';
export const NO_TOUCH = 'noTouch';
export const IDEMPOTENT = 'idempotent';
export const PORTAL = 'portal';

/** Route needs no session (login, health…). Public mutating routes are also exempt from CSRF. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** ALL listed permissions required. */
export const RequirePermission = (...keys: string[]) => SetMetadata(PERMISSIONS, keys);
/** AT LEAST ONE of the listed permissions required. */
export const RequireAnyPermission = (...keys: string[]) => SetMetadata(ANY_PERMISSIONS, keys);
/** Do not extend the idle-timeout (status polls). Clients may also send `x-background-poll: 1`. */
export const NoTouch = () => SetMetadata(NO_TOUCH, true);
/** Enable `Idempotency-Key` handling. */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

/** Customer-portal route: requires a customer session (cookie csid) + CSRF header; staff permissions do not apply. */
export const PortalAuth = () => SetMetadata(PORTAL, true);

export const CurrentCustomer = createParamDecorator((_d: unknown, ctx: ExecutionContext): PortalUser => {
  return ctx.switchToHttp().getRequest<Request & { customer: PortalUser }>().customer;
});

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user;
});

export const ClientIp = createParamDecorator((_d: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? null;
});
