import { createHash } from 'crypto';
import { FaceSessionDto } from '@damez/shared';
import type { AppEnv } from '../config/config.module';
import {
  AddressResult, FaceResult, GovIdType, IdentityRecord, KycNotConfiguredError, KycProvider, KycProviderError, KycWebhookEvent, NameEnquiryResult,
} from './kyc-provider';

type Json = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Dojah dates arrive as dd-mm-yyyy, yyyy-mm-dd or dd/mm/yyyy depending on the product. */
function isoDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}
function localPhone(v: unknown): string | undefined {
  const s = str(v)?.replace(/[\s+-]/g, '');
  if (!s) return undefined;
  return /^234\d{10}$/.test(s) ? `0${s.slice(3)}` : s;
}
function genderOf(v: unknown): 'MALE' | 'FEMALE' | undefined {
  const g = str(v);
  return g ? (/^f/i.test(g) ? 'FEMALE' : /^m/i.test(g) ? 'MALE' : undefined) : undefined;
}

/**
 * LIVE Dojah adapter (REST over fetch, https://docs.dojah.io). Auth headers: `Authorization: <secret key>`
 * (no Bearer prefix) and `AppId: <app id>`. The photo returned by lookups is hashed and discarded immediately.
 * Endpoints/fields below were confirmed against the public docs on 2026-10-11 (BVN, NIN, NUBAN resolve, address
 * verification, document analysis). Face/liveness is unverified (see startFaceSession/fetchFaceResult) and
 * webhook payload shape beyond the signature scheme is unverified (see parseWebhook).
 */
export class DojahKycProvider implements KycProvider {
  readonly name = 'dojah';
  constructor(private env: AppEnv) {}

  private get base(): string { return this.env.DOJAH_BASE_URL.replace(/\/$/, ''); }
  private get headers(): Record<string, string> {
    if (!this.env.DOJAH_SECRET_KEY || !this.env.DOJAH_APP_ID) throw new KycNotConfiguredError('Dojah');
    return { Authorization: this.env.DOJAH_SECRET_KEY, AppId: this.env.DOJAH_APP_ID };
  }

  private async call(method: 'GET' | 'POST', path: string, q?: Record<string, string>, body?: Json): Promise<{ status: number; json: Json }> {
    const headers = { ...this.headers, ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(q ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new KycProviderError(`Dojah request failed: ${(e as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as Json;
    if (res.status >= 500 || res.status === 401 || res.status === 403 || res.status === 429) throw new KycProviderError(`Dojah responded ${res.status}`, res.status);
    return { status: res.status, json };
  }

  private entity(json: Json): Json | undefined {
    const e = json.entity;
    return e && typeof e === 'object' ? (e as Json) : undefined;
  }

  private identity(r: { status: number; json: Json }, map: (e: Json) => Omit<IdentityRecord, 'found' | 'reference'>): IdentityRecord {
    const e = this.entity(r.json);
    const reference = str(r.json.reference_id) ?? str(e?.reference_id) ?? `dojah_${Date.now()}`;
    if (r.status === 404 || !e) return { found: false, reference };
    return { found: true, reference, ...map(e) };
  }

  /** GET /api/v1/kyc/bvn/full?bvn= -> entity.{bvn, first_name, last_name, middle_name, gender, date_of_birth, phone_number1, phone_number2, image}. */
  async lookupBvn(bvn: string): Promise<IdentityRecord> {
    const r = await this.call('GET', '/api/v1/kyc/bvn/full', { bvn });
    return this.identity(r, (e) => ({
      firstName: str(e.first_name), lastName: str(e.last_name), middleName: str(e.middle_name), dateOfBirth: isoDate(e.date_of_birth),
      phone: localPhone(e.phone_number1 ?? e.phone_number2), gender: genderOf(e.gender),
      photoHash: str(e.image) ? sha(str(e.image)!) : undefined,
    }));
  }

  /** GET /api/v1/kyc/nin?nin= -> entity.{first_name, last_name, middle_name, gender, date_of_birth, phone_number, photo}. */
  async lookupNin(nin: string): Promise<IdentityRecord> {
    const r = await this.call('GET', '/api/v1/kyc/nin', { nin });
    return this.identity(r, (e) => ({
      firstName: str(e.first_name), lastName: str(e.last_name), middleName: str(e.middle_name),
      dateOfBirth: isoDate(e.date_of_birth), phone: localPhone(e.phone_number), gender: genderOf(e.gender),
      photoHash: str(e.photo) ? sha(str(e.photo)!) : undefined,
    }));
  }

  /** No confirmed Dojah endpoint for a bare phone-number identity lookup; unused by KycService today (dead interface
   *  method — nothing in this codebase calls it). Left unimplemented rather than guessing a wrong endpoint. */
  async lookupPhone(phone: string): Promise<IdentityRecord> {
    throw new KycProviderError(`Dojah has no confirmed phone-lookup endpoint (requested for ${phone.length > 0 ? 'a phone number' : 'empty input'})`);
  }

  /** GET /api/v1/general/account?account_number=&bank_code= -> entity.{account_number, account_name}. */
  async nameEnquiry(a: { accountNumber: string; bankCode: string }): Promise<NameEnquiryResult> {
    const r = await this.call('GET', '/api/v1/general/account', { account_number: a.accountNumber, bank_code: a.bankCode });
    const e = this.entity(r.json);
    const reference = str(r.json.reference_id) ?? `dojah_${Date.now()}`;
    const accountName = str(e?.account_name);
    return accountName ? { found: true, reference, accountName } : { found: false, reference };
  }

  /** POST /api/v1/kyc/address -> entity.{status:"pending", reference_id}. Async: poll via fetchAddressResult. */
  async verifyAddress(a: { line1: string; city: string; state: string; landmark?: string }): Promise<AddressResult> {
    const r = await this.call('POST', '/api/v1/kyc/address', undefined, { street: a.line1, lga: a.city, state: a.state, landmark: a.landmark });
    const e = this.entity(r.json);
    const reference = str(e?.reference_id) ?? str(r.json.reference_id) ?? `dojah_${Date.now()}`;
    return { reference, status: 'PENDING' };
  }

  /** GET /api/v1/kyc/address?reference_id= -> entity.{status, data:{...}} once the physical visit completes.
   *  TODO(dojah): the docs don't clearly state the terminal status value(s) besides "pending" — treat any non-pending,
   *  non-failure status as VERIFIED once `data` is populated, and anything containing "fail"/"not" as NOT_VERIFIED. */
  async fetchAddressResult(reference: string): Promise<AddressResult> {
    const r = await this.call('GET', '/api/v1/kyc/address', { reference_id: reference });
    const e = this.entity(r.json);
    const status = (str(e?.status) ?? '').toLowerCase();
    if (status === 'pending' || !e) return { reference, status: 'PENDING' };
    if (/fail|not.?verif|reject/.test(status)) return { reference, status: 'NOT_VERIFIED' };
    return { reference, status: e.data ? 'VERIFIED' : 'PENDING' };
  }

  /**
   * POST /api/v1/document/analysis (OCR document analysis — NOT an ID-number lookup). `imageBase64` must be the
   * customer's uploaded ID_CARD document (front side), stripped of any `data:image/...;base64,` prefix.
   * entity.status.overall_status: 1 = valid. entity.text_data[]: {field_key, value, status}.
   */
  async verifyGovId(a: { idType: GovIdType; idNumber: string; imageBase64: string }): Promise<IdentityRecord> {
    const r = await this.call('POST', '/api/v1/document/analysis', undefined, { input_type: 'base64', imagefrontside: a.imageBase64 });
    const e = this.entity(r.json);
    const reference = str(r.json.reference_id) ?? `dojah_${Date.now()}`;
    if (!e) return { found: false, reference };
    const status = e.status as Json | undefined;
    const valid = Number(status?.overall_status) === 1;
    if (!valid) return { found: false, reference };
    const fields = Array.isArray(e.text_data) ? (e.text_data as Json[]) : [];
    const field = (...keys: string[]): string | undefined => {
      for (const row of fields) {
        const key = str(row.field_key)?.toLowerCase().replace(/[\s_-]/g, '');
        if (key && keys.includes(key)) return str(row.value);
      }
      return undefined;
    };
    return {
      found: true, reference,
      firstName: field('firstname', 'givenname'), lastName: field('lastname', 'surname', 'familyname'),
      dateOfBirth: isoDate(field('dateofbirth', 'dob')),
    };
  }

  /** Widget-based selfie/liveness flow — unverified against current docs (no widget-SDK reference found); left
   *  unchanged from the original stub pending direct sandbox access. TODO(dojah): confirm the widget parameter
   *  name used to pass our reference (reference_id / user_data.metadata) and the result-fetch endpoint. */
  startFaceSession(a: { customerId: string }): Promise<FaceSessionDto> {
    const { DOJAH_APP_ID, DOJAH_PUBLIC_KEY, DOJAH_WIDGET_ID } = this.env;
    if (!DOJAH_APP_ID || !DOJAH_PUBLIC_KEY || !DOJAH_WIDGET_ID) throw new KycNotConfiguredError('Dojah widget');
    const referenceId = `face_${a.customerId.slice(-6)}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return Promise.resolve({
      referenceId, mode: 'dojah',
      widget: { appId: DOJAH_APP_ID, publicKey: DOJAH_PUBLIC_KEY, widgetId: DOJAH_WIDGET_ID, scriptUrl: this.env.DOJAH_WIDGET_SCRIPT_URL, environment: /sandbox/i.test(this.env.DOJAH_BASE_URL) ? 'sandbox' : 'production' },
    });
  }

  async fetchFaceResult(referenceId: string): Promise<FaceResult> {
    const r = await this.call('GET', '/api/v1/kyc/verification', { reference_id: referenceId });
    if (r.status === 404) return { state: 'NOT_FOUND', referenceId };
    return this.faceFrom(referenceId, r.json);
  }

  private faceFrom(referenceId: string, json: Json): FaceResult {
    const data = (json.data && typeof json.data === 'object' ? (json.data as Json) : json) as Json;
    const status = (str(data.status) ?? str(json.status) ?? '').toLowerCase();
    if (status && !['completed', 'success', 'successful', 'failed', 'done'].includes(status)) return { state: 'PENDING', referenceId };
    const selfie = (data.selfie && typeof data.selfie === 'object' ? (data.selfie as Json) : {}) as Json;
    const live = (data.liveness && typeof data.liveness === 'object' ? (data.liveness as Json) : {}) as Json;
    const conf = Number(selfie.confidence_value ?? selfie.confidence ?? data.confidence_value);
    const liveVal = live.liveness_check ?? live.passed ?? data.liveness_check;
    return { state: 'COMPLETED', referenceId, confidence: Number.isFinite(conf) ? Math.round(conf) : undefined, liveness: typeof liveVal === 'boolean' ? liveVal : undefined };
  }

  /** Signature verification (x-dojah-signature, HMAC-SHA256 of the raw body) is confirmed correct against current
   *  docs — see kyc.module.ts's WebhooksController. The payload envelope below (reference_id location, event
   *  names) is unverified: no sample KYC-completion webhook body was found in the public docs. */
  parseWebhook(rawBody: Buffer | string): KycWebhookEvent {
    try {
      const b = JSON.parse(rawBody.toString()) as Json;
      const referenceId = str(b.reference_id) ?? str((b.data as Json | undefined)?.reference_id) ?? str(b.referenceId);
      if (!referenceId) return { kind: 'IGNORED' };
      return { kind: 'FACE', face: this.faceFrom(referenceId, b) };
    } catch { return { kind: 'IGNORED' }; }
  }
}
