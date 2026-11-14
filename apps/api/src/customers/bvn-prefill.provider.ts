/**
 * BVN "To"-style prefill for the Add Customer form: type an 11-digit BVN, pull the registered name/phone/DOB/gender
 * back from Interswitch instead of the officer typing them in. Deliberately separate from the onboarding
 * KYC_PROVIDER (Dojah) — this never persists anything or runs name-match/fraud logic, it's a pure convenience
 * lookup. No mock/offline fallback: every call hits the real Interswitch BVN Full Details API.
 */
import type { AppEnv } from '../config/config.module';

export const BVN_PREFILL_PROVIDER = Symbol('BVN_PREFILL_PROVIDER');

export interface BvnPrefillResult {
  found: boolean;
  firstName?: string;
  lastName?: string;
  phone?: string;
  /** yyyy-mm-dd */
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE';
}
export interface BvnPrefillProvider {
  lookup(bvn: string): Promise<BvnPrefillResult>;
}
export class BvnPrefillNotConfiguredError extends Error {
  constructor(missing: string[]) { super(`BVN prefill is not configured (missing ${missing.join(', ')})`); this.name = 'BvnPrefillNotConfiguredError'; }
}

/**
 * Interswitch BVN Full Details (API Marketplace — `POST /v1/verify/identity/bvn/verify`, body `{ id: <bvn> }`).
 * Response fields confirmed from the live docs: `data.firstName`, `data.lastName`, `data.dateOfBirth` (yyyy-mm-dd),
 * `data.gender`, `data.idNumber`, `data.image`. The docs describe the endpoint as also returning a phone number, but
 * its exact key wasn't visible in what we captured — `phoneNumber`/`phone`/`mobileNumber` are tried in that order.
 * TODO(Interswitch): confirm the phone field name, the OAuth2 token endpoint, and the not-found response shape
 * directly against sandbox once credentials are issued.
 */
export class InterswitchBvnPrefillProvider implements BvnPrefillProvider {
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private env: AppEnv) {}

  private async authenticate(baseUrl: string): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5_000) return this.token.value;
    // TODO(Interswitch): confirm the OAuth2 token endpoint path (shared assumption with ../bureau/providers.ts).
    const res = await fetch(`${baseUrl}/passport/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${this.env.INTERSWITCH_CLIENT_ID}:${this.env.INTERSWITCH_CLIENT_SECRET}`).toString('base64')}` },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Interswitch auth failed (${res.status})`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('Interswitch returned no access token');
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  async lookup(bvn: string): Promise<BvnPrefillResult> {
    const baseUrl = this.env.INTERSWITCH_BASE_URL;
    if (!baseUrl || !this.env.INTERSWITCH_CLIENT_ID || !this.env.INTERSWITCH_CLIENT_SECRET) {
      throw new BvnPrefillNotConfiguredError([
        ...(!baseUrl ? ['INTERSWITCH_BASE_URL'] : []), ...(!this.env.INTERSWITCH_CLIENT_ID ? ['INTERSWITCH_CLIENT_ID'] : []), ...(!this.env.INTERSWITCH_CLIENT_SECRET ? ['INTERSWITCH_CLIENT_SECRET'] : []),
      ]);
    }
    const url0 = baseUrl.replace(/\/$/, '');
    const token = await this.authenticate(url0);
    const res = await fetch(`${url0}/v1/verify/identity/bvn/verify`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: bvn }),
    });
    if (res.status === 404) return { found: false };
    if (!res.ok) throw new Error(`Interswitch BVN lookup failed (${res.status})`);
    const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown> };
    if (json.success === false || !json.data) return { found: false };
    const d = json.data;
    const s = (v: unknown): string | undefined => (v == null ? undefined : String(v));
    return {
      found: true, firstName: s(d.firstName), lastName: s(d.lastName),
      phone: s(d.phoneNumber ?? d.phone ?? d.mobileNumber), dateOfBirth: s(d.dateOfBirth),
      gender: /^f/i.test(String(d.gender ?? '')) ? 'FEMALE' : /^m/i.test(String(d.gender ?? '')) ? 'MALE' : undefined,
    };
  }
}
