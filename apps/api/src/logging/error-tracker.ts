import { Inject, Injectable } from '@nestjs/common';
import { defaultRedactor } from '@damez/shared';
import { APP_ENV, AppEnv } from '../config/config.module';
import { rootLogger } from './logger';

/** Error-tracking hook. Everything sent out is redacted first (`beforeSend`). */
export interface ErrorTrackerAdapter {
  captureException(err: unknown, context?: Record<string, unknown>): void;
}

class ConsoleErrorTracker implements ErrorTrackerAdapter {
  captureException(err: unknown, context?: Record<string, unknown>): void {
    rootLogger.error({ err: defaultRedactor.redact(err), context: defaultRedactor.redact(context ?? {}) }, 'captured exception');
  }
}

/** Live stub. TODO: `npm i @sentry/node`, call `Sentry.init({ dsn, beforeSend })` and forward in captureException. */
class SentryErrorTracker implements ErrorTrackerAdapter {
  constructor(private dsn?: string) {}
  captureException(err: unknown, context?: Record<string, unknown>): void {
    // TODO(sentry): Sentry.captureException(redactedErr, { extra: redactedContext })
    new ConsoleErrorTracker().captureException(err, { ...context, sentryDsnConfigured: !!this.dsn });
  }
}

@Injectable()
export class ErrorTracker implements ErrorTrackerAdapter {
  private adapter: ErrorTrackerAdapter;
  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.adapter = env.ERROR_TRACKER === 'sentry' ? new SentryErrorTracker(env.SENTRY_DSN) : new ConsoleErrorTracker();
  }
  captureException(err: unknown, context?: Record<string, unknown>): void {
    this.adapter.captureException(defaultRedactor.redact(err), defaultRedactor.redact(context ?? {}));
  }
}
