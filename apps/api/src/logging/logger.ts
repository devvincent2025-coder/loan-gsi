import pino, { Logger } from 'pino';
import { defaultRedactor } from '@damez/shared';

/**
 * Structured logger with a PII redaction layer. EVERY log line passes through the Redactor:
 *  - structured fields: sensitive keys (bvn, nin, phone, email, password, tokens…) replaced
 *  - free text (msg, error messages, stacks): BVN/NIN/NUBAN/phone/email patterns scrubbed
 */
export function createLogger(level: string = 'info'): Logger {
  return pino({
    level,
    base: { service: 'damez-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      log: (obj) => defaultRedactor.redact(obj) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === 'string' ? defaultRedactor.scrubString(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  });
}

export const rootLogger = createLogger(process.env.LOG_LEVEL ?? 'info');
