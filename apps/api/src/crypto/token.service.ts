import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { APP_ENV, AppEnv } from '../config/config.module';

@Injectable()
export class TokenService {
  constructor(@Inject(APP_ENV) private env: AppEnv) {}

  /** Opaque random token (session ids, csrf). */
  random(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  sha256(v: string): string {
    return createHash('sha256').update(v).digest('hex');
  }

  /** Short-lived signed token (e.g. the 2FA challenge between password and TOTP steps). */
  sign(payload: Record<string, unknown>, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    const sig = createHmac('sha256', this.env.SESSION_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify<T extends Record<string, unknown>>(token: string): T | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.env.SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
      if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
