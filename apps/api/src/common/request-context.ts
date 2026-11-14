import { AsyncLocalStorage } from 'async_hooks';
import type { AuthUser } from './auth-user';

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  user?: AuthUser;
  /** customer portal caller */
  customer?: { id: string; sessionId: string };
  /** client-supplied device fingerprint (portal sends x-device-fingerprint) */
  deviceFingerprint?: string | null;
}

const als = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T { return als.run(ctx, fn); },
  get(): RequestContext | undefined { return als.getStore(); },
  setUser(user: AuthUser | undefined): void { const s = als.getStore(); if (s) s.user = user; },
  setCustomer(c: { id: string; sessionId: string } | undefined): void { const s = als.getStore(); if (s) s.customer = c; },
};
