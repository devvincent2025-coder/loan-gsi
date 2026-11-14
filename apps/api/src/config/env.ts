import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

// local dev: pick up the repo-root .env (real env vars always win; no-op in containers)
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')], quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me-0123456789abcdef';
// 32 zero-ish bytes, base64. DEV ONLY.
const DEV_ENC_KEY = 'v1:ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=';
const DEV_BLIND_KEY = 'dev-only-blind-index-key-change-me-0123456789';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().default('mysql://damez:damez@localhost:3306/damez'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    /** comma separated; the web app proxies so this is only needed for direct API access */
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
    COOKIE_SECURE: bool.default('false'),
    SESSION_IDLE_SECONDS: z.coerce.number().default(30 * 60),
    SESSION_ABSOLUTE_SECONDS: z.coerce.number().default(12 * 60 * 60),
    MAX_FAILED_LOGINS: z.coerce.number().default(5),
    LOCKOUT_MINUTES: z.coerce.number().default(15),
    TOTP_ISSUER: z.string().default('Damez Loan'),

    /** "kid:base64key,kid2:base64key2"; each key is 32 bytes base64 */
    ENCRYPTION_KEYS: z.string().default(DEV_ENC_KEY),
    ENCRYPTION_ACTIVE_KEY: z.string().default('v1'),
    BLIND_INDEX_KEY: z.string().min(16).default(DEV_BLIND_KEY),

    DEMO_MODE: bool.default('false'),
    DEMO_TOTP_SECRET: z.string().default('JBSWY3DPEHPK3PXP'),

    THROTTLE_LIMIT: z.coerce.number().default(300),
    THROTTLE_TTL_SECONDS: z.coerce.number().default(60),
    AUTH_THROTTLE_LIMIT: z.coerce.number().default(10),

    SMS_PROVIDER: z.enum(['mock', 'termii', 'africastalking']).default('mock'),
    EMAIL_PROVIDER: z.enum(['mock', 'resend']).default('mock'),
    WHATSAPP_PROVIDER: z.enum(['mock', 'termii', 'meta']).default('mock'),
    TERMII_API_KEY: z.string().optional(),
    TERMII_SENDER_ID: z.string().default('Damez'),
    AT_USERNAME: z.string().optional(),
    AT_API_KEY: z.string().optional(),
    AT_SENDER_ID: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Damez Loan <no-reply@damez.ng>'),
    META_WHATSAPP_TOKEN: z.string().optional(),
    META_WHATSAPP_PHONE_ID: z.string().optional(),

    ERROR_TRACKER: z.enum(['console', 'sentry']).default('console'),
    SENTRY_DSN: z.string().optional(),

    // ───────── Phase 2: portal ─────────
    PORTAL_SESSION_IDLE_SECONDS: z.coerce.number().default(30 * 60),
    PORTAL_SESSION_ABSOLUTE_SECONDS: z.coerce.number().default(24 * 60 * 60),
    OTP_TTL_SECONDS: z.coerce.number().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
    OTP_RESEND_SECONDS: z.coerce.number().default(45),

    // ───────── KYC: Dojah only, no mock fallback ─────────
    DOJAH_BASE_URL: z.string().default('https://sandbox.dojah.io'),
    DOJAH_APP_ID: z.string().optional(),
    DOJAH_PUBLIC_KEY: z.string().optional(),
    DOJAH_SECRET_KEY: z.string().optional(),
    DOJAH_WIDGET_ID: z.string().optional(),
    DOJAH_WEBHOOK_SECRET: z.string().optional(),
    DOJAH_WIDGET_SCRIPT_URL: z.string().default('https://widget.dojah.io/widget.js'),
    // Screening (sanctions/PEP): Dojah AML, same credentials as the rest of KYC — no mock fallback, no separate key.
    // Bank statement analysis: Dojah by default (no mock); Mono remains an unfinished alternate live adapter.
    BANK_STATEMENT_PROVIDER: z.enum(['mono', 'dojah']).default('dojah'),
    MONO_SECRET_KEY: z.string().optional(),

    // ───────── Phase 2: documents (S3-compatible storage + virus scan) ─────────
    STORAGE_PROVIDER: z.enum(['mock', 's3']).default('mock'),
    STORAGE_LOCAL_DIR: z.string().default('.storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('af-south-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default('true'),
    VIRUS_SCAN_PROVIDER: z.enum(['mock', 'clamav']).default('mock'),
    CLAMAV_HOST: z.string().default('localhost'),
    CLAMAV_PORT: z.coerce.number().default(3310),

    // ───────── Credit bureau + BVN lookup: Interswitch only, no mock fallback ─────────
    INTERSWITCH_BASE_URL: z.string().optional(),
    INTERSWITCH_CLIENT_ID: z.string().optional(),
    INTERSWITCH_CLIENT_SECRET: z.string().optional(),

    WEBHOOK_SIGNING_SECRET: z.string().default('dev-only-webhook-secret'),

    // ───────── Phase 3: disbursement (payment provider: NIBSS NIP via Paystack/Flutterwave/Mono) ─────────
    PAYMENT_PROVIDER: z.enum(['mock', 'paystack', 'flutterwave', 'mono']).default('mock'),
    PAYSTACK_BASE_URL: z.string().default('https://api.paystack.co'),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
    FLUTTERWAVE_BASE_URL: z.string().default('https://api.flutterwave.com/v3'),
    FLUTTERWAVE_SECRET_KEY: z.string().optional(),
    FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),
    MONO_BASE_URL: z.string().default('https://api.withmono.com'),
    MONO_WEBHOOK_SECRET: z.string().optional(),
    DISBURSEMENT_MAX_RETRIES: z.coerce.number().default(3),

    // ───────── Phase 3: linked accounts (open banking) ─────────
    MONO_CONNECT_PROVIDER: z.enum(['mock', 'mono']).default('mock'),
    MONO_CONNECT_PUBLIC_KEY: z.string().optional(),
    AUTODEBIT_MIN_LINKED_ACCOUNTS: z.coerce.number().default(2),

    // ───────── Phase 3: autodebit mandates (NIBSS e-Mandate primary, card tokenization) & CBN GSI fallback ─────────
    NIBSS_EMANDATE_PROVIDER: z.enum(['mock', 'live']).default('mock'),
    NIBSS_BASE_URL: z.string().optional(),
    NIBSS_API_KEY: z.string().optional(),
    NIBSS_CLIENT_ID: z.string().optional(),
    GSI_PROVIDER: z.enum(['mock', 'live']).default('mock'),
    GSI_BASE_URL: z.string().optional(),
    GSI_API_KEY: z.string().optional(),
    AUTODEBIT_RETRY_LADDER: z.string().default('DUE_AM,DUE_PM,DAY_PLUS_1,DAY_PLUS_3,DAY_PLUS_7_GSI'),

    // ───────── Phase 3: offers ─────────
    OFFER_EXPIRY_HOURS: z.coerce.number().default(72),
    OFFER_COOLING_OFF_HOURS: z.coerce.number().default(48),

    // ───────── Phase 4: LLM gateway ─────────
    LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
    LLM_ENABLED: z.coerce.boolean().default(false),
    LLM_BUDGET_USD_MONTHLY: z.coerce.number().default(50),
    LLM_MIN_GROUP_SIZE: z.coerce.number().default(5),

    // ───────── Phase 4: PII vault encryption ─────────
    // PII_VAULT_MASTER_KEY = 32-byte base64url key for token encryption (defaults to same as ENCRYPTION_KEYS[0] in dev)
    PII_VAULT_MASTER_KEY: z.string().optional(),
    PII_TOKEN_CANARY_SEED: z.string().default('dev-canary-seed-2026'),

    // ───────── Phase 4: collections ─────────
    COLLECTIONS_AUTO_ASSIGN: z.coerce.boolean().default(true),
    EARLY_WARNING_DAYS_AHEAD: z.coerce.number().default(7),
    BEHAVIOUR_SNAPSHOT_CRON: z.string().default('0 2 * * *'),
    EARLY_WARNING_CRON: z.string().default('0 3 * * *'),

    // ───────── Phase 5: supervisory intelligence ─────────
    LLM_MODEL_REASONING: z.string().default('claude-opus-5-5'),
    LLM_MODEL_FAST: z.string().default('claude-haiku-5-5'),
    DB_READ_URL: z.string().optional(),
    BRIEFING_CRON_DAILY: z.string().default('0 6 * * *'),
    BRIEFING_CRON_WEEKLY: z.string().default('0 7 * * 1'),
    BRIEFING_CRON_MONTHLY: z.string().default('0 7 1 * *'),
    METRICS_AGGREGATION_CRON: z.string().default('0 1 * * *'),
    ANOMALY_DETECTION_CRON: z.string().default('0 4 * * *'),
    LLM_MAX_TOOL_LOOPS: z.coerce.number().default(5),
    LLM_BUDGET_USD_DAILY: z.coerce.number().default(5),
    BRIEFING_ENABLED: z.coerce.boolean().default(true),
    BOARD_PACK_ENABLED: z.coerce.boolean().default(true),
    EXEC_PROMPT_VERSION: z.string().default('v1'),
    // email for urgent alert delivery
    EXEC_ALERT_EMAIL_ENABLED: z.coerce.boolean().default(false),
    ANOMALY_ZCORE_THRESHOLD: z.coerce.number().default(2.5),
    ANOMALY_MIN_PERIODS: z.coerce.number().default(7),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      const bad: string[] = [];
      if (env.SESSION_SECRET === DEV_SESSION_SECRET) bad.push('SESSION_SECRET');
      if (env.ENCRYPTION_KEYS === DEV_ENC_KEY) bad.push('ENCRYPTION_KEYS');
      if (env.BLIND_INDEX_KEY === DEV_BLIND_KEY) bad.push('BLIND_INDEX_KEY');
      if (env.DEMO_MODE) bad.push('DEMO_MODE (must be false)');
      for (const b of bad) ctx.addIssue({ code: 'custom', message: `${b} must be set to a non-default value in production`, path: [b] });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  return parsed.data;
}
