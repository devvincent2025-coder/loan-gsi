# GO_LIVE: Production Launch Checklist

Production readiness checklist for Damez Loan (Nigerian MFB / digital lender). Complete every item before admitting live borrowers. Items marked ✅ in the Handoff sections of PLAN.md are already implemented in code; you still need to configure, test, and sign off each one in your production environment.

---

## Pre-Launch Checklist

### Regulatory approvals & registrations

- [ ] CBN MFB / digital lender operating licence on file and displayed in the app footer (`Settings → Compliance`)
- [ ] FCCPC registration as digital lender under the *Digital, Electronic, Online or Non-Traditional Consumer Lending Regulations 2025* (DEON) — registration number in `Settings → Compliance`
- [ ] NDPA 2023 compliance: appoint a Data Protection Officer (DPO), file a Data Protection Impact Assessment (DPIA) with NITDA, register as a data controller/processor
- [ ] CBN Consumer Protection Framework: ensure complaint register is live and TAT SLA (acknowledged ≤ 24 h, resolved ≤ 14 days) is configured in notification templates
- [ ] AML/CFT compliance: NFIU SAR filing process documented and approved; PEP/sanctions screening live adapter onboarded (`SANCTIONS_PROVIDER=live`)

---



### NIBSS / GSI setup

- [ ] NIBSS membership confirmed, or sponsored access arranged through a NIBSS Service Provider (NSP)
- [ ] GSI (Global Standing Instruction) integration: CBN-NIBSS agreement signed; set `GSI_PROVIDER=live` with real credentials; test the full GSI trigger chain (consent → mandate → retry ladder → GSI debit)
- [ ] NIBSS e-Mandate: signed agreement with NIBSS; set `NIBSS_EMANDATE_PROVIDER=live`; test end-to-end mandate lifecycle (registration, debit, cancellation)
- [ ] Bank statement parsing: confirm live credentials for Mono / Okra / Dojah statement aggregator and test full data flow through `StatementsService`

---



### Credit bureau agreements

- [ ] **CRC Credit Bureau**: signed data furnishing agreement; obtain live API credentials; set `CRC_PROVIDER=live`, `CRC_BASE_URL`, `CRC_USERNAME`, `CRC_PASSWORD`
- [ ] **FirstCentral Credit Bureau**: signed data furnishing agreement; obtain live API credentials; set `FIRSTCENTRAL_PROVIDER=live`, `FIRSTCENTRAL_BASE_URL`, `FIRSTCENTRAL_USERNAME`, `FIRSTCENTRAL_PASSWORD`
- [ ] **CreditRegistry**: signed data furnishing agreement; obtain live API credentials; set `CREDITREGISTRY_PROVIDER=live`, `CREDITREGISTRY_BASE_URL`, `CREDITREGISTRY_USERNAME`, `CREDITREGISTRY_PASSWORD`
- [ ] Run a full bureau furnishing dry-run and verify submission format (CRC pipe-delimited, FirstCentral CSV, CreditRegistry XML) with each bureau's test portal
- [ ] Configure bureau pull cost per bureau and monthly budget cap (`bureau.monthly_budget_kobo` in Settings)
- [ ] Confirm cache TTL (30 days pull, 14-day refresh-before-disbursement) meets CBN freshness guidance

---



### Payment provider onboarding

- [ ] Choose payout aggregator (Paystack / Flutterwave / Mono); set `PAYMENT_PROVIDER=<choice>`
- [ ] Set `PAYSTACK_SECRET_KEY` / `FLUTTERWAVE_SECRET_KEY` and the corresponding webhook secret (`PAYMENT_WEBHOOK_SECRET`)
- [ ] Test end-to-end NIBSS NIP disbursement in provider sandbox: initiate → settlement webhook → ledger posting
- [ ] Promote to production rails and run at least one live disbursement before opening to borrowers
- [ ] Card tokenization provider (recurring card debits): onboard and wire into `MandateService`; set `CARD_PROVIDER=<choice>` and credentials

---



### KYC provider (Dojah)

- [ ] Obtain `DOJAH_APP_ID`, `DOJAH_PUBLIC_KEY`, `DOJAH_SECRET_KEY`, `DOJAH_WIDGET_ID` from Dojah console
- [ ] Set `KYC_PROVIDER=dojah`; set `DOJAH_BASE_URL` to the production URL (not the sandbox)
- [ ] Configure `DOJAH_WEBHOOK_SECRET`; register the webhook endpoint `POST /api/v1/webhooks/dojah` with Dojah (HMAC-SHA256 hex in `x-dojah-signature`)
- [ ] Test BVN lookup, NIN lookup, bank name enquiry, and face liveness end-to-end in Dojah sandbox — then repeat in production with a real BVN
- [ ] Confirm face-match thresholds (`kyc.face_match_pass` ≥ 80 %; `kyc.face_match_review` 60–79 %)

---



### LLM provider setup

- [ ] Obtain `ANTHROPIC_API_KEY` from the Anthropic console; confirm data residency and retention settings align with NDPA 2023 (no personal data is sent — the gateway enforces this, but legal review of the DPA / subprocessor agreement is required)
- [ ] Set `LLM_PROVIDER=anthropic`, `LLM_MODEL_REASONING=claude-opus-5-5`, `LLM_MODEL_FAST=claude-haiku-5-5`
- [ ] Set `LLM_ENABLED=true`, `LLM_BUDGET_USD_MONTHLY` (monthly hard cap in USD), `LLM_BUDGET_USD_DAILY` (daily soft cap)
- [ ] Install the Anthropic SDK: `npm install @anthropic-ai/sdk -w @damez/api`
- [ ] Verify canary leak tests pass: `npm test -w @damez/api -- --testPathPattern=pii-detector`
- [ ] Verify architecture isolation test passes: `npm test -w @damez/api -- --testPathPattern=llm-gateway.arch`
- [ ] Run golden-question evaluation against staging data: `npm test -w @damez/api -- --testPathPattern=executive-golden`

---



### Infrastructure & secrets

- [ ] Generate 32-byte `SESSION_SECRET` (random, base64):
  ```bash
  openssl rand -base64 32
  ```
- [ ] Generate `ENCRYPTION_KEYS` (versioned, format `v1:<32-byte-base64>`):
  ```bash
  echo "v1:$(openssl rand -base64 32)"
  ```
- [ ] Generate `BLIND_INDEX_KEY` (≥ 16 chars, prefer 32):
  ```bash
  openssl rand -hex 32
  ```
- [ ] Generate `PII_VAULT_MASTER_KEY` (32-byte base64url):
  ```bash
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
  ```
- [ ] Generate `WEBHOOK_SIGNING_SECRET`:
  ```bash
  openssl rand -hex 32
  ```
- [ ] Store **all** secrets in a secrets manager (AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault). Never in plaintext `.env` files in production
- [ ] Set `COOKIE_SECURE=true`, `NODE_ENV=production`, `DEMO_MODE=false`
- [ ] Confirm `API_INTERNAL_URL` is the correct internal address of the API service (baked into the Next.js build)
- [ ] Set `DB_READ_URL` if a MySQL read replica is provisioned for supervisory / executive intelligence queries
- [ ] Set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` for document storage (AWS S3 or compatible); set `STORAGE_PROVIDER=s3`
- [ ] Plan KMS key rotation schedule for `ENCRYPTION_KEYS`: add a new key with a new kid, set `ENCRYPTION_ACTIVE_KEY` to the new kid, run a migration job to re-encrypt existing rows in batches

---



### Notifications

- [ ] SMS: set `SMS_PROVIDER=termii` (or `africastalking`); configure API key and sender ID; test a live SMS via the admin test endpoint
- [ ] Email: set `EMAIL_PROVIDER=resend`; set `RESEND_API_KEY` and `EMAIL_FROM`; verify SPF/DKIM/DMARC for the sending domain
- [ ] WhatsApp: set `WHATSAPP_PROVIDER` and credentials; register the business number with Meta / Termii
- [ ] Dispatch a test notification for each channel via `POST /api/v1/admin/notifications/test` (gated by `system:admin`)

---



### Database

- [ ] MySQL 8 production: set `innodb_flush_log_at_trx_commit=1` (full ACID; the Docker Compose dev file uses `2` for speed)
- [ ] Enable TLS for `DATABASE_URL` in production (`?ssl={"rejectUnauthorized":true}`)
- [ ] Run migrations: `npm run db:migrate -w @damez/api` (or `db:deploy` for the production Prisma CLI command)
- [ ] Do **NOT** run `npm run db:seed` in production — seeds are demo data only and will pollute borrower records
- [ ] Enable MySQL binary logging (`log_bin`) for Point-in-Time Recovery (PITR)
- [ ] Schedule nightly `mysqldump` + binlog backup per `docs/BACKUP.md`; test restore to a scratch instance before go-live
- [ ] Set up the read replica (`DB_READ_URL`) for supervisory intelligence and executive dashboard queries (recommended; optional if load is low)

---



### Application

- [ ] `npm run build` (web and API) in CI/CD — ensure `next build` runs with `NODE_ENV=production` (not `development`)
- [ ] `npm run lint && npm run typecheck && npm test` — all green (0 errors, 0 test failures)
- [ ] Run Playwright e2e suite against staging: `npm run e2e -w @damez/web`
- [ ] Run golden-question evaluation: `npm test -w @damez/api -- --testPathPattern=executive-golden`
- [ ] Performance pass: all dashboard and portfolio APIs respond < 300 ms at p95 under simulated peak load
- [ ] Security: run OWASP ZAP against staging; address all Critical and High findings before go-live
- [ ] Dependency audit: `npm audit`; address all critical vulnerabilities; document accepted lower-severity ones

---



### Post-launch monitoring

- [ ] Set `ERROR_TRACKER=sentry`; configure `SENTRY_DSN`; confirm breadcrumbs and source maps upload in CI
- [ ] Configure Grafana / Datadog dashboards covering: API latency p95, 5xx rate, active session count, BullMQ queue depths, LLM token usage and cost per day
- [ ] Set budget alerts in the Anthropic console for `LLM_BUDGET_USD_MONTHLY` and `LLM_BUDGET_USD_DAILY`
- [ ] Configure PagerDuty / OpsGenie alerts for CRITICAL anomalies detected by the Damez anomaly detection system (`AnomalyRecord.severity = CRITICAL`)
- [ ] Schedule monthly bureau furnishing job review: confirm submission logs show 0 rejections within 5 business days of each run
- [ ] Set CRON env vars for all nightly / scheduled jobs:
  ```
  METRICS_AGGREGATION_CRON      # e.g. "0 1 * * *"  (1 AM Lagos time)
  BRIEFING_CRON_DAILY           # e.g. "0 6 * * *"  (6 AM Lagos time)
  ANOMALY_DETECTION_CRON        # e.g. "0 2 * * *"
  BEHAVIOUR_SNAPSHOT_CRON       # e.g. "0 3 * * *"
  EARLY_WARNING_CRON            # e.g. "0 4 * * *"
  ```

---



### Known integrations requiring live end-to-end testing before production traffic

The following paths exercise multiple systems simultaneously and **must** be tested in a staging environment that mirrors production credentials — not just mocks:

- **Automated disbursement path**: AAD-decrypt linked account → NIBSS NIP transfer → settlement webhook → ledger posting → loan status transition to ACTIVE
- **GSI trigger chain**: GSI consent challenge → OTP confirm → mandate registration → retry ladder exhaustion → GSI debit → ledger entry
- **Bureau furnishing**: per-bureau file format validation (CRC pipe-delimited / FirstCentral CSV / CreditRegistry XML) → submission API → confirmation / rejection handling → audit log
- **Face KYC full flow**: Dojah widget → browser callback (hint only) → server fetches authoritative result by reference ID → Dojah webhook confirms → liveness decision stored; no biometric image retained
- **WhatsApp delivery for urgent executive alerts**: `EXEC_ALERT_EMAIL_ENABLED=true` + WhatsApp provider live → anomaly record → alert dispatched within 5 minutes

---



### CBN / FCCPC compliance checklist (DEON 2025)

- [ ] Total cost of credit disclosed before acceptance: EIR and all fees shown in offer letter — ✅ implemented in `OfferService.generate()`
- [ ] 48-hour cooling-off period implemented and logged in `OfferAcceptance.coolingOffWaivedReason` — ✅ implemented
- [ ] No contacting of unrelated third parties for collection: FCCPC-compliant `CollectionActivity` log enforces rate limits and prohibits third-party contact — ✅ implemented
- [ ] Complaint register and escalation path exposed in the customer portal — TODO: add `/portal/complaints` page before go-live
- [ ] Mandatory BVN verification before first disbursement via KYC tier gate — ✅ implemented
- [ ] Monthly bureau reporting configured and tested with all 3 bureaus (CRC, FirstCentral, CreditRegistry)
- [ ] GSI activation only with explicit borrower consent via `GsiConsentService.initiateChallenge` + OTP confirm — ✅ implemented
- [ ] Interest and fees expressed as an Effective Interest Rate (EIR / APR) in the offer letter — ✅ implemented
- [ ] Data subject request (DSR) portal page live (`/portal/privacy`) — verify NDPA access / erasure / portability flows work end-to-end

---



## Environment variable summary

The following env vars must be set for a production deployment. All are documented in `.env.example`. Secrets should come from a secrets manager at runtime, not from `.env` files.

### Core

```
NODE_ENV=production
DEMO_MODE=false
PORT=4000
DATABASE_URL=mysql://...?ssl={"rejectUnauthorized":true}
DB_READ_URL=mysql://...    # read replica (optional)
REDIS_URL=redis://...
SESSION_SECRET=<32-byte base64>
COOKIE_SECURE=true
ENCRYPTION_KEYS=v1:<32-byte base64>
ENCRYPTION_ACTIVE_KEY=v1
BLIND_INDEX_KEY=<32-hex>
PII_VAULT_MASTER_KEY=<32-byte base64url>
PII_TOKEN_CANARY_SEED=<random hex>
WEBHOOK_SIGNING_SECRET=<hex>
```



### LLM

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL_REASONING=claude-opus-5-5
LLM_MODEL_FAST=claude-haiku-5-5
LLM_ENABLED=true
LLM_BUDGET_USD_MONTHLY=<USD>
LLM_BUDGET_USD_DAILY=<USD>
```



### KYC

```
KYC_PROVIDER=dojah
DOJAH_BASE_URL=https://api.dojah.io
DOJAH_APP_ID=...
DOJAH_PUBLIC_KEY=...
DOJAH_SECRET_KEY=...
DOJAH_WIDGET_ID=...
DOJAH_WEBHOOK_SECRET=...
```



### Bureau

```
CRC_PROVIDER=live
CRC_BASE_URL=...
CRC_USERNAME=...
CRC_PASSWORD=...
FIRSTCENTRAL_PROVIDER=live
FIRSTCENTRAL_BASE_URL=...
FIRSTCENTRAL_USERNAME=...
FIRSTCENTRAL_PASSWORD=...
CREDITREGISTRY_PROVIDER=live
CREDITREGISTRY_BASE_URL=...
CREDITREGISTRY_USERNAME=...
CREDITREGISTRY_PASSWORD=...
```



### Payment / mandate / GSI

```
PAYMENT_PROVIDER=paystack   # or flutterwave|mono
PAYSTACK_SECRET_KEY=sk_live_...
PAYMENT_WEBHOOK_SECRET=...
NIBSS_EMANDATE_PROVIDER=live
GSI_PROVIDER=live
```



### Storage & notifications

```
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=damez-documents
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
SMS_PROVIDER=termii
TERMII_API_KEY=...
TERMII_SENDER_ID=DamezLoan
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=no-reply@damez.ng
WHATSAPP_PROVIDER=termii
```



### Monitoring & alerts

```
ERROR_TRACKER=sentry
SENTRY_DSN=https://...@sentry.io/...
EXEC_ALERT_EMAIL_ENABLED=true
EXEC_ALERT_EMAIL=executives@damez.ng
```



### Cron schedules (Africa/Lagos time via UTC offsets; Lagos = UTC+1)

```
METRICS_AGGREGATION_CRON="0 0 * * *"
BRIEFING_CRON_DAILY="0 5 * * *"
ANOMALY_DETECTION_CRON="0 1 * * *"
BEHAVIOUR_SNAPSHOT_CRON="0 2 * * *"
EARLY_WARNING_CRON="0 3 * * *"
```

---



## Sign-off log

Complete this table with the name and date of the person who verified each section before go-live.


| Section                              | Verified by | Date |
| ------------------------------------ | ----------- | ---- |
| Regulatory approvals & registrations |             |      |
| NIBSS / GSI setup                    |             |      |
| Credit bureau agreements             |             |      |
| Payment provider onboarding          |             |      |
| KYC provider (Dojah)                 |             |      |
| LLM provider setup                   |             |      |
| Infrastructure & secrets             |             |      |
| Notifications                        |             |      |
| Database                             |             |      |
| Application build & tests            |             |      |
| Post-launch monitoring               |             |      |
| CBN / FCCPC compliance               |             |      |
| Live integration tests               |             |      |


