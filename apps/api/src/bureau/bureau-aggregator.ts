import { Injectable, Logger } from '@nestjs/common';
import { defaultRedactor } from '@damez/shared';
import type { BureauName } from '@damez/shared';
import { buildMergedReport } from './bureau-merge';
import { BureauProviderError, BUREAUS, BureauRequest, CreditBureauProvider, MergedReport, PerBureauOutcome, RetryPolicy } from './bureau.types';
import { BureauProviders } from './providers';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Strip anything PII-shaped from an upstream error before it is stored or shown. */
export function scrubError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return defaultRedactor.scrubString(msg).slice(0, 300);
}

/**
 * Run `fn` up to `maxAttempts` times with exponential backoff (base, 2x, 4x…). Non-retryable provider errors
 * (not configured, bad credentials, 4xx) stop immediately. Returns the attempts used on success and attaches it to the final error.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>, policy: RetryPolicy, wait: (ms: number) => Promise<void> = sleep,
): Promise<{ value: T; attempts: number }> {
  const max = Math.max(1, policy.maxAttempts);
  let last: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (e) {
      last = e;
      const retryable = !(e instanceof BureauProviderError) || e.retryable;
      if (!retryable || attempt === max) {
        const err = e instanceof Error ? e : new Error(String(e));
        (err as Error & { attempts?: number }).attempts = attempt;
        throw err;
      }
      await wait(policy.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw last;
}

export interface AggregateResult { outcomes: PerBureauOutcome[]; merged: MergedReport | null }

/** Queries one or all enabled bureaus in parallel and merges what came back. */
@Injectable()
export class BureauAggregator {
  private log = new Logger('BureauAggregator');
  /** overridable in tests so backoff does not slow the suite */
  wait: (ms: number) => Promise<void> = sleep;
  constructor(private providers: BureauProviders) {}

  /** `scope` keys the dedupe hash (customer id). Returns merged=null when no bureau answered at all. */
  async query(request: BureauRequest, scope: string, opts: { bureaus: BureauName[]; retry: RetryPolicy; now?: Date }): Promise<AggregateResult> {
    const targets = BUREAUS.filter((b) => opts.bureaus.includes(b));
    const outcomes = await Promise.all(targets.map((b) => this.pullOne(this.providers.get(b), request, opts.retry)));
    if (!outcomes.some((o) => o.status !== 'FAILED')) return { outcomes, merged: null };
    return { outcomes, merged: buildMergedReport(outcomes, scope, opts.now ?? new Date()) };
  }

  private async pullOne(provider: CreditBureauProvider, request: BureauRequest, retry: RetryPolicy): Promise<PerBureauOutcome> {
    const started = Date.now();
    try {
      const { value, attempts } = await withRetry(() => provider.pull(request), retry, (ms) => this.wait(ms));
      return { bureau: provider.bureau, status: value.notFound ? 'NO_HIT' : 'SUCCESS', attempts, durationMs: Date.now() - started, result: value };
    } catch (e) {
      const attempts = (e as { attempts?: number }).attempts ?? 1;
      this.log.warn(`${provider.bureau} pull failed after ${attempts} attempt(s): ${scrubError(e)}`);
      return { bureau: provider.bureau, status: 'FAILED', attempts, durationMs: Date.now() - started, error: scrubError(e) };
    }
  }
}
