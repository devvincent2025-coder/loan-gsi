import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import type { PaymentProviderPort } from '../contracts/ports';

/** Constant-time string compare (pads to equal length first so `timingSafeEqual` never throws on a length mismatch). */
function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // still run a compare of equal-length buffers to avoid leaking length via early return timing
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Payment provider adapter contract (NIBSS NIP rail via a payout aggregator). One mock + one live stub per vendor,
 * selected by `PAYMENT_PROVIDER` env (mirrors `apps/api/src/bureau/providers.ts` and `apps/api/src/notifications/providers.ts`).
 */
export interface NameEnquiryResult { accountName: string; accountNumber: string; bankCode: string }
export interface InitiateTransferArgs { idempotencyKey: string; amountKobo: number; accountNumber: string; bankCode: string; narration: string }
export interface InitiateTransferResult { providerRef: string; status: 'PROCESSING' | 'SUCCESS' | 'FAILED' }

/** Plausible Nigerian first/last name pool, deterministically indexed off the account number so mock tests are stable. */
const FIRST_NAMES = ['Adaeze', 'Chinedu', 'Oluwaseun', 'Fatima', 'Ibrahim', 'Ngozi', 'Emeka', 'Aisha', 'Tunde', 'Blessing', 'Chiamaka', 'Yusuf', 'Funke', 'Obinna', 'Hauwa', 'Segun'];
const LAST_NAMES = ['Okafor', 'Balogun', 'Abubakar', 'Eze', 'Adeyemi', 'Mohammed', 'Nwosu', 'Okoro', 'Danjuma', 'Ogunleye', 'Ibrahim', 'Chukwu', 'Bello', 'Afolabi', 'Suleiman', 'Nnaji'];
function digitSum(accountNumber: string): number {
  return accountNumber.split('').reduce((s, c) => s + (Number(c) || 0), 0);
}
/** Deterministic plausible full name for a given account number (same input -> same output, forever). */
export function mockNameForAccount(accountNumber: string): string {
  const sum = digitSum(accountNumber);
  const first = FIRST_NAMES[sum % FIRST_NAMES.length];
  const last = LAST_NAMES[(sum * 7 + accountNumber.length) % LAST_NAMES.length];
  return `${first} ${last}`;
}
function fakeRef(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Mock provider: resolves synchronously, deterministic by account number so tests are stable. ~95% transfer success. */
export class MockPaymentProvider implements PaymentProviderPort {
  readonly name = 'mock';
  async nameEnquiry(accountNumber: string, bankCode: string): Promise<NameEnquiryResult> {
    // accounts ending in 9999 simulate "account not found" at the rail (NIBSS NIP would return a non-00 response code)
    if (accountNumber.endsWith('9999')) throw new Error('Account could not be resolved (invalid account number)');
    return { accountName: mockNameForAccount(accountNumber), accountNumber, bankCode };
  }
  async initiateTransfer(args: InitiateTransferArgs): Promise<InitiateTransferResult> {
    // deterministic ~95% success keyed off the idempotency key so retries of the SAME key behave consistently
    const h = createHash('sha256').update(args.idempotencyKey).digest();
    const roll = h[0] / 255;
    if (roll < 0.95) return { providerRef: fakeRef('mock_trf'), status: 'SUCCESS' };
    return { providerRef: fakeRef('mock_trf'), status: 'FAILED' };
  }
  verifyWebhookSignature(): boolean {
    // mock never receives real webhooks; present for interface completeness
    return true;
  }
}

/** Shared helper for live adapters. */
async function httpJson(url: string, init: RequestInit, timeoutMs = 20_000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    let json: unknown;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return json;
  } finally { clearTimeout(t); }
}

/**
 * LIVE STUB. Paystack Transfers: resolve recipient name (`GET /bank/resolve`), create a transfer recipient
 * (`POST /transferrecipient`), then initiate the transfer (`POST /transfer`). Webhook signature: `x-paystack-signature`
 * = HMAC-SHA512 of the raw body with the secret key (NOT the webhook secret — Paystack signs with the secret API key).
 * TODO(paystack): confirm recipient caching strategy (don't recreate a recipient per transfer) and OTP-less transfer
 * approval setup on the dashboard (required before `/transfer` succeeds without a manual OTP).
 */
export class PaystackPaymentProvider implements PaymentProviderPort {
  readonly name = 'paystack';
  constructor(private env: AppEnv) {}
  private requireKey(): string {
    if (!this.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured');
    return this.env.PAYSTACK_SECRET_KEY;
  }
  async nameEnquiry(accountNumber: string, bankCode: string): Promise<NameEnquiryResult> {
    const key = this.requireKey();
    const j = (await httpJson(`${this.env.PAYSTACK_BASE_URL}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`, {
      method: 'GET', headers: { authorization: `Bearer ${key}` },
    })) as { data?: { account_name?: string } };
    if (!j.data?.account_name) throw new Error('Paystack could not resolve this account');
    return { accountName: j.data.account_name, accountNumber, bankCode };
  }
  async initiateTransfer(args: InitiateTransferArgs): Promise<InitiateTransferResult> {
    const key = this.requireKey();
    // TODO(paystack): resolve+cache the recipient code instead of creating a new recipient on every transfer
    const recipient = (await httpJson(`${this.env.PAYSTACK_BASE_URL}/transferrecipient`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'nuban', name: 'Damez Loan Disbursement', account_number: args.accountNumber, bank_code: args.bankCode, currency: 'NGN' }),
    })) as { data?: { recipient_code?: string } };
    if (!recipient.data?.recipient_code) throw new Error('Paystack transfer recipient creation failed');
    const transfer = (await httpJson(`${this.env.PAYSTACK_BASE_URL}/transfer`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'balance', amount: args.amountKobo, recipient: recipient.data.recipient_code, reason: args.narration, reference: args.idempotencyKey }),
    })) as { data?: { transfer_code?: string; status?: string } };
    if (!transfer.data?.transfer_code) throw new Error('Paystack transfer initiation failed');
    const status = transfer.data.status === 'success' ? 'SUCCESS' : transfer.data.status === 'failed' ? 'FAILED' : 'PROCESSING';
    return { providerRef: transfer.data.transfer_code, status };
  }
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    // TODO(paystack): confirm whether the Paystack SDK version in use signs with SECRET_KEY or a distinct webhook secret
    const secret = this.env.PAYSTACK_WEBHOOK_SECRET || this.env.PAYSTACK_SECRET_KEY;
    if (!secret) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    return constantTimeStringEqual(expected, (signature ?? '').toLowerCase());
  }
}

/**
 * LIVE STUB. Flutterwave Transfers (`POST /transfers`), account resolution via `POST /accounts/resolve`.
 * Webhook signature: header `verif-hash`, a plain shared-secret string compare (not HMAC) per Flutterwave's docs.
 * TODO(flutterwave): confirm v3 vs v4 (Orchestrator) payload shape; v4 introduces a bearer-token auth flow instead of
 * a static secret key.
 */
export class FlutterwavePaymentProvider implements PaymentProviderPort {
  readonly name = 'flutterwave';
  constructor(private env: AppEnv) {}
  private requireKey(): string {
    if (!this.env.FLUTTERWAVE_SECRET_KEY) throw new Error('FLUTTERWAVE_SECRET_KEY is not configured');
    return this.env.FLUTTERWAVE_SECRET_KEY;
  }
  async nameEnquiry(accountNumber: string, bankCode: string): Promise<NameEnquiryResult> {
    const key = this.requireKey();
    const j = (await httpJson(`${this.env.FLUTTERWAVE_BASE_URL}/accounts/resolve`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
    })) as { data?: { account_name?: string } };
    if (!j.data?.account_name) throw new Error('Flutterwave could not resolve this account');
    return { accountName: j.data.account_name, accountNumber, bankCode };
  }
  async initiateTransfer(args: InitiateTransferArgs): Promise<InitiateTransferResult> {
    const key = this.requireKey();
    const j = (await httpJson(`${this.env.FLUTTERWAVE_BASE_URL}/transfers`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ account_bank: args.bankCode, account_number: args.accountNumber, amount: Math.round(args.amountKobo / 100), currency: 'NGN', narration: args.narration, reference: args.idempotencyKey }),
    })) as { data?: { id?: number; status?: string } };
    if (!j.data?.id) throw new Error('Flutterwave transfer initiation failed');
    const status = j.data.status === 'SUCCESSFUL' ? 'SUCCESS' : j.data.status === 'FAILED' ? 'FAILED' : 'PROCESSING';
    return { providerRef: String(j.data.id), status };
  }
  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    // Flutterwave: plain shared-secret compare of the `verif-hash` header value, constant-time.
    const secret = this.env.FLUTTERWAVE_WEBHOOK_SECRET;
    if (!secret) return false;
    return constantTimeStringEqual(secret, signature ?? '');
  }
}

/**
 * LIVE STUB. Mono Payouts (`POST /v2/payments/initiate` style disbursement) + NUBAN lookup. Webhook signature:
 * header `mono-webhook-secret` compared directly to the configured secret (Mono does not HMAC-sign payout webhooks
 * at the time of writing).
 * TODO(mono): confirm the exact disbursement product name/endpoint Mono has GA'd for payouts in the target account.
 */
export class MonoPaymentProvider implements PaymentProviderPort {
  readonly name = 'mono';
  constructor(private env: AppEnv) {}
  private requireKey(): string {
    if (!this.env.MONO_SECRET_KEY) throw new Error('MONO_SECRET_KEY is not configured');
    return this.env.MONO_SECRET_KEY;
  }
  async nameEnquiry(accountNumber: string, bankCode: string): Promise<NameEnquiryResult> {
    const key = this.requireKey();
    // TODO(mono): confirm the lookup endpoint path for NUBAN name enquiry (Mono's public docs focus on account linking, not payouts NE)
    const j = (await httpJson(`${this.env.MONO_BASE_URL}/v1/lookup/nuban?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`, {
      method: 'GET', headers: { 'mono-sec-key': key },
    })) as { account_name?: string };
    if (!j.account_name) throw new Error('Mono could not resolve this account');
    return { accountName: j.account_name, accountNumber, bankCode };
  }
  async initiateTransfer(args: InitiateTransferArgs): Promise<InitiateTransferResult> {
    const key = this.requireKey();
    const j = (await httpJson(`${this.env.MONO_BASE_URL}/v2/payouts`, {
      method: 'POST', headers: { 'mono-sec-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: args.amountKobo, narration: args.narration, reference: args.idempotencyKey, destination: { account_number: args.accountNumber, bank_code: args.bankCode } }),
    })) as { data?: { id?: string; status?: string } };
    if (!j.data?.id) throw new Error('Mono payout initiation failed');
    const status = j.data.status === 'successful' ? 'SUCCESS' : j.data.status === 'failed' ? 'FAILED' : 'PROCESSING';
    return { providerRef: j.data.id, status };
  }
  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    const secret = this.env.MONO_WEBHOOK_SECRET;
    if (!secret) return false;
    return constantTimeStringEqual(secret, signature ?? '');
  }
}

/** Selects the configured provider (env `PAYMENT_PROVIDER`), mirroring `BureauProviders` / notification provider selection. */
@Injectable()
export class PaymentProviders {
  private readonly log = new Logger('PaymentProviders');
  private instance: PaymentProviderPort | null = null;
  constructor(@Inject(APP_ENV) private env: AppEnv) {}

  get(): PaymentProviderPort {
    if (!this.instance) {
      switch (this.env.PAYMENT_PROVIDER) {
        case 'paystack': this.instance = new PaystackPaymentProvider(this.env); break;
        case 'flutterwave': this.instance = new FlutterwavePaymentProvider(this.env); break;
        case 'mono': this.instance = new MonoPaymentProvider(this.env); break;
        default: this.instance = new MockPaymentProvider();
      }
      this.log.log(`payment provider: ${this.env.PAYMENT_PROVIDER}`);
    }
    return this.instance;
  }
  providerName(): string { return this.env.PAYMENT_PROVIDER; }

  /** Picks an adapter by name (used by the webhook route, which carries the provider in the URL, independent of
   *  which one is currently `PAYMENT_PROVIDER`-active for outgoing transfers). Unknown names fall back to mock. */
  forName(name: string): PaymentProviderPort {
    switch (name) {
      case 'paystack': return new PaystackPaymentProvider(this.env);
      case 'flutterwave': return new FlutterwavePaymentProvider(this.env);
      case 'mono': return new MonoPaymentProvider(this.env);
      default: return new MockPaymentProvider();
    }
  }
  /** tests */
  override(p: PaymentProviderPort): void { this.instance = p; }
}
