import { Injectable } from '@nestjs/common';
import { defaultRedactor } from '@damez/shared';
import { rootLogger } from './logger';

/**
 * Analytics events (product usage). Properties are redacted before they leave the process; never put PII in
 * event names. Swap the sink for PostHog / Mixpanel via `setSink` (TODO live adapter).
 */
export interface AnalyticsSink { track(event: string, props: Record<string, unknown>): void }

@Injectable()
export class AnalyticsService {
  private sink: AnalyticsSink = { track: (e, p) => rootLogger.debug({ analytics: e, props: p }, 'analytics') };
  setSink(s: AnalyticsSink): void { this.sink = s; }
  track(event: string, props: Record<string, unknown> = {}): void {
    this.sink.track(event, defaultRedactor.redact(props));
  }
}
