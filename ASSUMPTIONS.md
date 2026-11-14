# ASSUMPTIONS

Decisions taken without asking, following common Nigerian fintech practice. Change freely; each is isolated.

## Product / regulatory
- **Licence type**: Microfinance bank / digital lender operating under CBN supervision and FCCPC's *Digital, Electronic, Online or Non-Traditional Consumer Lending Regulations 2025* (DEON). Assumed obligations modelled in the data layer: consent before data use and bureau pulls, transparent pricing/fees shown before acceptance, no contacting of third parties/contact lists for recovery, complaint trail, registration with FCCPC (config placeholder). Final legal review required.
- **CBN rules noted**: Consumer Protection Framework, KYC tiers (BVN mandatory), Credit bureau reporting (monthly), Prudential guidelines (PAR 1/30/90, NPL = 90+), Global Standing Instruction (GSI) for salary-earner loans (needs explicit borrower consent), 2FA for staff on financial systems.
- **NDPA 2023** (Nigeria Data Protection Act): lawful basis + purpose recorded on every `Consent`; data subject requests (`DataSubjectRequest`: access, rectification, erasure, portability, objection); retention (`retentionUntil`) on customers; BVN/NIN/account numbers encrypted at rest (AES-256-GCM, versioned keys) with blind indexes for lookup; PII masked by default and reveal is permissioned + audited + reason-required; data-protection impact assessment (DPIA) and cross-border-transfer register are out of scope for prompt 1 (doc placeholders).
- **Currency / time**: NGN only. Money = integer kobo (`BIGINT`). Everything stored in UTC, displayed in `Africa/Lagos`.
- **Rates**: Nigerian digital lenders quote *monthly* flat/reducing rates; we store `monthlyRateBps` (basis points per month).
- **Approval limits** (seed, editable in UI): Credit Analyst ₦500k, Credit Risk Manager ₦5M, CEO and Super Admin unlimited for `LOAN_APPROVAL`; similar tiers for waiver/write-off/restructure/manual disbursement.

## Technical
- **npm workspaces** instead of pnpm (pnpm not installed in the dev environment). `packages/shared` is built to `dist` (CJS) and consumed by both apps.
- **Pinned majors** (stable, well-known): Next 15, React 19, Tailwind 3.4, Prisma 6, NestJS 11, Zod 3, TypeScript 5.9, Recharts 2.15, BullMQ 5. Newer majors exist (Prisma 8 RC, Nest 12, Next 16, TS 7); upgrading is a later hardening task.
- **Single-origin browser access**: the web app proxies `/api/*` to the API (Next rewrites), so cookies are same-origin and CSRF is a simple double-submit token.
- **Sessions**: opaque server-side sessions (hash stored) instead of JWT; this gives revocation, idle timeouts, device/IP logging. Idle 30 min, absolute 12 h (configurable).
- **TOTP**: RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step window). Secrets are field-encrypted at rest. Seeded demo users share a *demo* secret so they can log in; `/auth/demo-totp` returns the current code **only when `DEMO_MODE=true` and `NODE_ENV!=production`**. Users without enrolled TOTP are forced through enrollment at first login (2FA is mandatory).
- **Lockout**: 5 failed password/TOTP attempts → 15 min lock; admin can unlock.
- **Roles**: one role per user (plus branch). A user with `allBranches=true` or a non-branch-scoped role sees all branches; branch-scoped roles see only their branch.
- **Super Admin** holds every permission and the matrix cannot reduce it (lock-out protection). Maker ≠ checker is enforced for all approvals, including Super Admin.
- **Audit log** is append-only: hash-chained (`prevHash`/`hash`, SHA-256) and protected by MySQL triggers that reject `UPDATE`/`DELETE`. Chain writes are serialized with a lock row. `GET /audit/verify` recomputes the chain.
- **Dashboard data**: until prompt 3 loans exist the portfolio charts read `PortfolioSnapshot` and `DemoDataset` seed tables. Prompt 3 adds the real ledger; `DashboardSummary` shape is preserved and can be swapped in prompt 4/5.
- **Customers** exist only as a skeleton (encrypted PII columns, consent, DSR) so that compliance, search and the masked-by-default pattern are real. Onboarding is prompt 2.
- **Queues**: BullMQ on Redis (notifications, scheduled jobs: session cleanup, approval expiry). Bull Board at `/api/v1/admin/queues`, gated by session + `system:jobs`. When Redis is unreachable the API still boots and `/health/ready` reports `degraded`; enqueues fall back to inline processing in non-production.
- **Idempotency**: `Idempotency-Key` header supported by an interceptor backed by the DB (24 h TTL).
- **Webhook verification**: HMAC-SHA256 over `timestamp.body`, constant-time compare, 5 min tolerance (helper only; real webhooks arrive in later prompts).
- **Providers**: every third-party integration has an interface + mock adapter (default) + live stub with TODOs: SMS (Termii, Africa's Talking), email (SMTP/Resend), WhatsApp (Termii / Meta Cloud), error tracking (Sentry-style hook).
- **Global search** is a server-side SQL `LIKE` search over users, branches, customers (via blind index / name prefix) and approvals. It is never sent to an LLM.
- **Excel export** is generated client-side with `exceljs`; CSV server-side for the audit log.
- **Backups**: documented in `docs/BACKUP.md` (mysqldump + binlog PITR, Redis is non-authoritative). No automation shipped in prompt 1.

---

# Phase 2 assumptions (onboarding, KYC, credit bureau, products, applications, eligibility)

## KYC & onboarding
- **Dojah** is the KYC provider behind `KycProvider`. Live adapter targets Dojah's REST API (`/api/v1/kyc/bvn|nin|phone_number|nuban|address`, face/liveness verification by reference id). Endpoint and field names are marked `TODO(dojah)` for confirmation against the account's current docs. Sandbox base URL by default (`DOJAH_BASE_URL`).
- **Face KYC** uses Dojah's Web SDK widget (`new Connect({...})`, same experience as OPay/PalmPay). The browser callback is treated as a **hint only**: the server fetches the authoritative result by reference id and/or receives the Dojah webhook (`POST /api/v1/webhooks/dojah`, HMAC-SHA256 of the raw body with `DOJAH_WEBHOOK_SECRET`, hex digest in `x-dojah-signature`, constant-time compare, idempotent by reference). **Raw selfies/biometric images are never stored**; only status, match confidence, liveness flag, reference id and timestamps. `kyc.retain_biometrics` (default false) is the switch if law/audit ever requires retention (then images are encrypted).
- **Face match thresholds**: ≥ 80% pass, 60–79% manual review, < 60% fail (`kyc.face_match_pass/review`).
- **KYC tiers (lending adaptation of CBN's three tiers)**: T1 = verified phone + BVN (name match); T2 = T1 + face KYC passed + NIN or government ID; T3 = T2 + verified address. Loan caps per tier (settings `kyc.tier_loan_caps`, editable): T1 ₦100,000 · T2 ₦1,000,000 · T3 ₦10,000,000. The caps are an assumption, not a CBN-prescribed lending limit.
- **Customer portal auth** is passwordless: phone + OTP (6 digits, 5 min, 5 attempts, 45 s resend, only an HMAC of the code stored). Separate `CustomerSession` model, cookies `csid`/`ccsrf`, idle 30 min / absolute 24 h. Email verification is a 6-digit code. In `DEMO_MODE` the API returns `demoCode` so demos work without SMS; never in production.
- **Documents**: ≤ 8 MB; JPEG/PNG/PDF/CSV validated by magic bytes; virus-scanned **before** storage (mock = EICAR detector, live = ClamAV `INSTREAM`); encrypted with a per-file AES-256-GCM key wrapped by `FieldCipher`; stored in S3-compatible storage (mock = local dir `.storage`). Every staff download is audited.
- **Fraud signals**: duplicate BVN/NIN/phone via blind indexes; duplicate **face** is detected by comparing the SHA-256 of the BVN-registered photo returned by the KYC provider (no photo kept, and Dojah offers no 1:N face search); shared device fingerprints; velocity thresholds in `fraud.velocity`. HIGH unresolved signals trigger a decline policy rule.
- **Sanctions/PEP**: provider interface + mock watchlist; live adapter is a stub (NFIU / UN / OFAC lists via a vendor to be chosen).

## Credit bureau
- Three bureaus (CRC Credit Bureau, FirstCentral, CreditRegistry) behind `CreditBureauProvider`; `BureauAggregator` merges them. Live adapters are structural stubs (CRC and CreditRegistry historically SOAP/XML, FirstCentral REST): vendor onboarding, credentials and exact schemas are required. All three default to deterministic mocks with 7 profiles.
- **Mock profile mapping**: for a BVN `…TU`, `U` (last digit) selects the KYC scenario and `T` (tens digit) selects the bureau profile (see `packages/shared/src/mock-profiles.ts`). Example: `22000000000` = KYC pass + clean history; `22000000050` = pass + written-off; `22000000070` = fraud flagged.
- **Consent gate**: no pull without a valid `BUREAU_PULL` consent (attempt logged as `BLOCKED_NO_CONSENT`). Consent also covers furnishing our own repayment data to the bureaus (wording in `CONSENT_TEXTS`).
- **Costs** (per billable pull, editable): CRC ₦150, FirstCentral ₦120, CreditRegistry ₦100; monthly budget ₦500,000. Cache TTL 30 days; refresh before disbursement if older than 14 days.
- **Merge rules**: facilities deduplicated by (lender, opened month, amount bucket); on conflicting status the **most severe wins**; monthly DPD takes the max across bureaus; each facility keeps every reporting source.
- **Monitoring** is a monthly cron job over active borrowers; **furnishing** is a monthly cron job producing per-bureau files (CRC pipe-delimited, FirstCentral CSV, CreditRegistry XML: simplified approximations of the vendor formats) submitted through an adapter (mock now). Both run against `LoanPortfolioPort`; prompt 3 replaced the application-heuristic implementation with `LedgerLoanPortfolio` (real Loan/LoanInstallment tables, fallback to application status for pre-booking customers).
- Bureau data is stored as **normalised tables** (report, scores, facilities, monthly history, enquiries, flags); reports are immutable snapshots.

## Products, applications, eligibility
- **Interest**: flat or reducing balance (monthly rate bps); fees (processing, management, insurance in bps of principal) are **deducted upfront**; EIR is the IRR on net disbursed vs instalments, annualised. Penalty = bps of the overdue amount per day after a grace period.
- **Pricing changes** (rate, method, fees, penalty) always go through maker-checker (`PRODUCT_RATE_CHANGE` with `changes`); non-pricing fields apply immediately. Applications snapshot pricing at creation, so later product changes never alter in-flight applications.
- **State machine**: all 16 states and the full transition table exist now. As of prompt 3, all transitions are implemented. Prompt-3 states (APPROVED onward) have dedicated endpoints; the generic `/transition` returns `409 USE_DEDICATED_ENDPOINT` for those targets.
- **Auto-decline** (setting `application.auto_decline_enabled`): an INELIGIBLE result caused by a DECLINE policy rule moves the application to Rejected with the top customer-facing reason. Everything else (including conditional and referred) goes to Under Review for a human.
- **Scorecards**: versioned JSON definitions (factors with bins + policy rules + affordability), range 300–850, approve ≥ 600, refer 520–599. Activation is maker-checker (`SCORECARD_ACTIVATION`, approver needs `scorecard:approve`); ACTIVE/RETIRED versions are immutable. The default scorecard is a plausible starting point, **not a validated model**: calibrate on real performance data before reliance.
- **Affordability**: max total monthly obligation = recognised income × 40% (default) minus external bureau obligations. Recognised income = 90% of average statement inflow when ≥ 3 months of statement exist, else 70% of declared income.
- **Bank statements**: uploaded CSVs are analysed by a real offline parser (inflow, stability, average balance, gambling, overdraft, salary detection). PDFs and live aggregators (Mono/Dojah) are stubs; with no statement a deterministic mock analysis is used.
- **Internal repayment history** is derived from the `Repayment` table as of prompt 3; the ledger backs all loan financial facts.

---

# Phase 3 assumptions (underwriting, offers, disbursement, ledger, autodebit/GSI)

## Disbursement & ledger
- **Payment rail**: NIBSS NIP via a payout aggregator (Paystack/Flutterwave/Mono adapters; mock default). The mock returns SUCCESS ~95% of the time (keyed off idempotency key, so retries are stable). Live adapters are structural stubs — every field is marked `TODO(vendor)`.
- **Manual disbursement** is the primary seed path. The automated path has a known AAD mismatch (decrypt uses `linkedaccount:<id>:accountNumber` but link uses `linkedaccount:<customerId>:accountNumber`); fix before production.
- **Double-entry ledger**: every monetary event produces at least two balanced `Posting` rows under a `JournalEntry`. `LedgerAccount` types: ASSET, LIABILITY, EQUITY, INCOME, EXPENSE. Reversals are explicit (a new JournalEntry with `reversalOfId`), never edits.
- **Money**: all ledger amounts are integer kobo (`BigInt` / `BIGINT`). The JSON API serialises BigInt to `number` (safe up to 2^53 − 1 ≈ ₦90 billion at 1 kobo resolution, fine for individual loans).
- **IFRS9**: Stage 1 < 30 DPD, Stage 2 30–89 DPD, Stage 3 ≥ 90 DPD. PD/LGD/EAD are configurable in `EclConfig` settings; defaults are plausible but not actuarially calibrated. The daily cron upserts `LoanStagingSnapshot` for every active loan.
- **Daily reconciliation** compares `DisbursementRequest` settlements against the payment provider's ledger (mock reconciler generates synthetic `SettlementRecord` rows for the seed; live provider requires a webhook or polling job).

## Autodebit & GSI
- **Retry ladder** (configurable via `AUTODEBIT_RETRY_LADDER` env): `DUE_AM` → `DUE_PM` → `DAY_PLUS_1` → `DAY_PLUS_3` → `DAY_PLUS_7_GSI`. The GSI stage triggers `GsiService.trigger()` which requires prior `GSI_AUTODEBIT` consent; the mock GSI adapter fires per-account debit attempts.
- **GSI consent**: explicit e-signed OTP challenge before GSI is activated (`GsiConsentService.initiateChallenge` + `confirm`). In DEMO_MODE the OTP is returned inline.
- **Linked accounts**: the primary account is used for mandate and initial debit; additional accounts (minimum configurable via `AUTODEBIT_MIN_LINKED_ACCOUNTS` + 1 total) are required before an offer may be accepted. Name-match uses the fuzzy `matchNames` function (PASS ≥ 0.8 on both first + last; REVIEW if only one matches; FAIL = both fail).
- **NIBSS e-mandate**: the mock mandate adapter returns a synthetic token; live adapter is a stub for NIBSS's direct debit registration API.
- **Cooling-off period**: default `OFFER_COOLING_OFF_HOURS` (48 h). Customer may waive at acceptance; the waiver reason is stored in `OfferAcceptance.coolingOffWaivedReason`.

---

# Phase 4 assumptions (collections, behaviour analytics, PII vault, LLM gateway)

## Collections & recovery
- **DPD buckets**: DPD_1_7 (1–7 days), DPD_8_30 (8–30), DPD_31_60 (31–60), DPD_61_90 (61–90), DPD_90_PLUS (90+). NPL classification at 90+ DPD follows CBN prudential guidelines. DPD is stored directly on the `Loan` row and updated by the nightly `updateDelinquencyBuckets()` job.
- **Priority scoring**: `priorityScore` on `CollectionCase` = `dpd × 10 + principalBalanceKobo / 100_000`. Higher score → earlier queue position. Agent auto-assignment (`COLLECTIONS_AUTO_ASSIGN=true`) picks the agent with the fewest open cases.
- **FCCPC compliance**: contact cadence is rate-limited per case; no third-party contact list calls. Settlement waivers and agency assignments are maker-checker gated.
- **Settlement offers** are post-approval execution records (`SettlementOffer` table). The approval payload carries `{ loanId, customerId, offerType, originalAmountKobo, settledAmountKobo, waivedKobo, terms }`; the SETTLEMENT_OFFER handler creates the record and sets `CollectionCase.status = SETTLED`. There is no pre-approval pending state on `SettlementOffer` itself.
- **Agency assignment** (`AgencyAssignment`) records `assignedById` (not `approvalId`). Commission is stored in basis points (`commissionBps`) on `ThirdPartyAgency`.
- **Write-off** and **restructure** approval handlers are stubs from prompt 3 (`ApprovalRegistry`); real implementation is deferred to prompt 5.

## Behavioural analytics
- **10 computed features** per snapshot: `repaymentReliability`, `avgDaysToPay`, `avgBalanceAtDebitKobo`, `debitFailureRate`, `ptpAdherenceRate`, `channelResponsiveness`, `selfCureRate`, `velocityTrend`, `seasonalVariance`, `behaviorScore`. All are floats 0–1 except `avgDaysToPay` (integer) and `avgBalanceAtDebitKobo` (BigInt kobo).
- **Segments** (5): CHAMPION (score ≥ 0.85), RELIABLE (≥ 0.70), MODERATE_RISK (≥ 0.50), AT_RISK (≥ 0.30), DEFAULT_PRONE (< 0.30).
- **`bestContactChannel` and `bestContactTime`** are NOT stored in `BehaviourSnapshot` (no DB columns). They are derived at read time in `toDto()` from `channelResponsiveness` (> 0.5 → PHONE_CALL, else SMS) and from computed `avgDaysToPay` (≤ 3 → morning, ≤ 7 → afternoon, else evening). This is intentional — if a migration later adds these columns the derivation can be swapped for stored values.
- **`EarlyWarningFlag`** has no Prisma `@relation` declarations; the Prisma schema stores `loanId` and `customerId` as plain string columns without foreign key annotations. Join is performed in memory via separate queries. Adding `@relation` would require a new migration.
- **AI summaries**: `BehaviourModule` generates rule-based `summaryText` now. `LlmGatewayService` is not wired in Phase 4; enabling AI summaries requires `LLM_ENABLED=true` and wiring `LlmGatewayModule` into `BehaviourModule` in prompt 5.
- **Roll rates and cure rates** (`rollRate30d`, `cureRate30d`) return 0 in Phase 4. A two-period delta query over `LoanStagingSnapshot` (comparing current IFRS stage against the stage 30 days prior) is needed; deferred to prompt 5.

## PII vault
- **Token format**: `{TYPE}_{6_CHAR_UPPERCASE_BASE36}` e.g. `BVN_X91PQ2`. Suffix is deterministic: `HMAC-SHA256(masterKey, "{tokenType}:{tenantId}:{value}")[0:4]` interpreted as big-endian uint32, mod 36^6, encoded in base-36 and zero-padded to 6 chars. Collisions are possible (2.1 billion slots) but treated as acceptable for a single-tenant deployment.
- **Vault key**: `PII_VAULT_MASTER_KEY` (base64url, 32 bytes). Falls back to the first entry of `ENCRYPTION_KEYS` if unset (dev convenience only; production must set `PII_VAULT_MASTER_KEY` separately).
- **AAD pattern**: `pii_vault:{tokenType}:{tenantId}:{token}` — binds the ciphertext to its token identity, preventing cross-token decryption.
- **`TokenType` enum** covers: `CUST`, `BVN`, `NIN`, `PHONE`, `EMAIL`, `NUBAN`, `ADDR`, `DEVICE`, `FREETEXT`. Prisma enum values are the authoritative list; the Zod schema in `PiiVaultController` mirrors them.
- **PII detector** uses regex heuristics for Nigerian PII: 11-digit standalone numbers → BVN or NIN; 10-digit → NUBAN; `0[789][01]\d{8}` or `+234[789]\d{9}` → PHONE; standard email. False-positive rate is acceptable for a fail-closed security gate.
- **Canary token**: a `PiiToken` row with `scope: 'canary'` and `encValue: 'canary:placeholder:...'` is seeded by `seed-p4.ts`. Canary tests (`pii-detector.spec.ts`) verify detector behaviour; a separate architectural canary verifies that the real vault key can round-trip.

## LLM gateway
- **Architecture rule**: `@anthropic-ai/sdk` must only be imported inside `llm-gateway/`. The arch test (`llm-gateway.arch.spec.ts`) walks all `.ts` files outside that directory and fails the suite if the import string appears. `LiveLlmAdapter` uses `require('@anthropic-ai/sdk')` (not `import`) so the SDK stays out of the top-level module graph.
- **`@anthropic-ai/sdk` is not installed** in the monorepo. `LiveLlmAdapter` stubs the call; selecting `LLM_PROVIDER=anthropic` will throw at runtime until the package is installed (`npm install @anthropic-ai/sdk -w @damez/api`).
- **Cost tracking**: `costMicroUsd: Int` = `round((promptTokens × 0.25 + completionTokens × 1.25) / 1_000_000 × 1_000_000)` using Claude Haiku 5.5 pricing. Monthly budget enforcement (`LLM_BUDGET_USD_MONTHLY`) is not yet implemented — deferred to prompt 5.
- **Schema fields**: `LlmInferenceLog` uses `latencyMs: Int` and `costMicroUsd: Int` (not `durationMs` or `estimatedCostUsd Float`). `LlmBlockLog` uses `detectedTerms: Json` and `requestHash: String` (not `detectedTypes`).
- **Fail closed**: if `blockIfPii()` detects raw PII in either prompt, it writes an `LlmBlockLog` row and throws `ForbiddenException`. The LLM call never fires. Response PII is a warning only (logged, not blocked) since response content originates from the LLM, not a user.
- **Consent check**: `ConsentService.hasValidConsent(subjectId, 'LLM_PROCESSING')` is **not yet called** before LLM inference. This is a known gap; add it in `LlmGatewayService.complete()` in prompt 5 before enabling `LLM_ENABLED=true` in production.

---

# Phase 5 assumptions (supervisory intelligence, executive command center, hardening)

## Supervisory intelligence
- **Model tiers**: `LLM_MODEL_REASONING` (default `claude-opus-5-5`) is used for daily briefs, weekly/monthly summaries, and executive chat. `LLM_MODEL_FAST` (default `claude-haiku-5-5`) is used for alert classification and branch/agent one-line summaries.
- **Prompt caching**: stable system prompt sections (metric definitions, tool schemas, glossary) are marked with prompt caching headers in the Anthropic SDK call. Assumes the Anthropic API caching feature is available on the account.
- **Budget tracking**: daily budget is tracked via sum of `LlmInferenceLog.costMicroUsd` for the current UTC day. When `SUM > LLM_BUDGET_USD_DAILY * 1_000_000`, further LLM calls for non-critical features fall back to the template brief.
- **Pre-aggregated snapshots**: written by BullMQ nightly jobs; the supervisory UI reads ONLY from these snapshot tables, never from OLTP tables, so briefings never slow the live system. A read replica (`DB_READ_URL`) is optional but recommended for production.
- **Tool layer**: the 10 read-only tools exposed to the LLM are the only code path the model can use to access data. No text-to-SQL is possible. Each tool enforces branch scoping (a branch manager cannot query another branch) and is logged in the audit log.
- **Anomaly detection**: purely statistical (z-score vs. 30-day rolling baseline). The LLM only receives the pre-computed structured anomaly record and generates a plain-English explanation + recommended actions. No SQL or raw data is passed to the LLM.
- **Briefing storage**: each `ExecutiveBriefing` stores the `metricsSnapshot` (the tool-call results used to generate it) so every statement in the brief can be traced to numbers. This is the audit trail.
- **Board pack export**: PDF is generated with PDFKit; PPTX export is a stub (requires `pptxgenjs` to be installed and `ExportService.toPptx()` to be implemented).
- **Delivery**: in-app briefing inbox is implemented. Email delivery for urgent alerts requires `EXEC_ALERT_EMAIL_ENABLED=true`. WhatsApp/SMS delivery for alerts is a stub requiring the notification provider to be live.
- **Golden-question evaluation**: a test set of golden questions with expected metric ranges is checked against mock data in CI. The model must state when data is unavailable instead of guessing; any hallucinated figure that contradicts the `metricsSnapshot` fails the test.
- **Canary leak test**: all briefing, assistant, and summary flows are added to the canary detection harness. The build fails if any canary token appears in an outbound LLM payload.

## Hardening
- **AAD mismatch fix**: `DisbursementService.initiateAutomated()` now decrypts with AAD `linkedaccount:<customerId>:accountNumber` (matching `LinkedAccountsService.link()`). The automated disbursement path is fully functional.
- **Loan ACTIVE transition**: a nightly job sets `Loan.status = ACTIVE` for any loan with `status = DISBURSED` and `disbursedAt IS NOT NULL`. In production, a webhook hook should do this immediately on settlement confirmation.
- **rollRate30d / cureRate30d**: now computed from `LoanStagingSnapshot` two-period deltas (latest stage vs. stage 30 days ago).
- **ConsentService check**: `LlmGatewayService.complete()` now accepts an optional `subjectId` param. When provided, `ConsentService.hasValidConsent(subjectId, 'LLM_PROCESSING')` is checked. Portfolio-level LLM calls (briefings, anomaly explanations) do not have a `subjectId` and skip the consent check — they never process individual customer data.
- **`@anthropic-ai/sdk` must be installed**: run `npm install @anthropic-ai/sdk -w @damez/api` before enabling `LLM_PROVIDER=anthropic`. The `LiveLlmAdapter` uses `require()` to import it dynamically, so the arch test still passes.
