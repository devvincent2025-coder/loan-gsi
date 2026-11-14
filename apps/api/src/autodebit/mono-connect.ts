import { createHash } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';

/**
 * Open-banking ownership check for a linked account (Mono Connect style: the customer links their account
 * through the provider's widget/SDK and we receive back a verified identity for the account). This is a
 * SECOND, independent signal alongside the payment-provider name enquiry (`PAYMENT_PROVIDER_PORT.nameEnquiry`).
 * Local port (not in the frozen `contracts/ports.ts`): only this module needs it.
 */
export const MONO_CONNECT_PORT = Symbol('MONO_CONNECT_PORT');
export interface MonoConnectResult { verified: boolean; reference: string; accountName?: string }
export interface MonoConnectPort {
  verifyAccount(args: { accountNumber: string; bankCode: string; bvn: string | null }): Promise<MonoConnectResult>;
}

/** Deterministic mock: verifies everyone except account numbers ending in "0000" (so tests can force a failure). */
export class MockMonoConnectProvider implements MonoConnectPort {
  async verifyAccount(args: { accountNumber: string; bankCode: string; bvn: string | null }): Promise<MonoConnectResult> {
    const reference = `MONO-MOCK-${createHash('sha256').update(`${args.accountNumber}:${args.bankCode}`).digest('hex').slice(0, 16)}`;
    const verified = !args.accountNumber.endsWith('0000');
    return Promise.resolve({ verified, reference });
  }
}

/** TODO(vendor): wire up the real Mono Connect API (https://docs.mono.co/docs/connect). */
export class MonoConnectProvider implements MonoConnectPort {
  constructor(private env: AppEnv) {}
  async verifyAccount(_args: { accountNumber: string; bankCode: string; bvn: string | null }): Promise<MonoConnectResult> {
    // TODO(vendor): exchange a Mono Connect widget code for an account id, then GET /accounts/{id}/details
    // using `this.env.MONO_CONNECT_PUBLIC_KEY` (+ a secret key, not yet in env.ts) and compare the returned
    // BVN/account holder details against `args`. Mono Connect is a client-side linking flow, so in practice
    // the API receives a Mono-issued `accountId`/exchange code rather than a raw account number; the mock
    // above approximates the result shape callers need until that live wiring is done.
    throw new Error(`Mono Connect live provider not configured (MONO_CONNECT_PROVIDER=${this.env.MONO_CONNECT_PROVIDER})`);
  }
}

@Injectable()
export class MonoConnectProviders {
  private instance: MonoConnectPort;
  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.instance = env.MONO_CONNECT_PROVIDER === 'mono' ? new MonoConnectProvider(env) : new MockMonoConnectProvider();
  }
  get(): MonoConnectPort { return this.instance; }
}
