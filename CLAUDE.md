# CLAUDE.md: Damez Loan (Loan Origination & Recovery Suite)

Production-grade lending platform for a Nigerian MFB / digital lender. Built in 5 prompts; see PLAN.md for the roadmap and its Handoff section for current state. Assumptions are in ASSUMPTIONS.md.

## Layout
- `apps/api`: NestJS 11 + Prisma 6 (MySQL 8) + BullMQ (Redis). Global prefix `/api/v1`.
- `apps/web`: Next.js 15 App Router, Tailwind 3 + shadcn-style components, Recharts, react-query.
- `packages/shared`: single source of truth for permission catalog, role seeds, approval types, zod schemas, API DTO types (`api-types.ts`), money/time/mask/redaction helpers. Build it (`npm run build:shared`) before API/web typecheck.

## Commands
- `docker compose up --build`: web :3000, api :4000, mysql :3306, redis :6379 (api container runs `prisma migrate deploy` + seed on first start)
- `npm install` (root, workspaces) · `npm run dev` · `npm run lint` · `npm run typecheck` · `npm test`
- DB: `npm run db:generate | db:migrate | db:seed | db:reset` (API workspace). New migration: edit `apps/api/prisma/schema.prisma`, then `npm run db:migrate -w @damez/api -- --name <name>`.
- Playwright: `npm run e2e -w @damez/web` (needs the stack running)
- Demo logins: see README (password `Damez@Demo2026`; 2FA via `/auth/demo-totp` when `DEMO_MODE=true`).

## Architecture decisions
- Money is **integer kobo** (`BigInt` in Prisma / `BIGINT` in MySQL, JSON number in API, `formatNaira` in UI). Never floats.
- Timestamps stored UTC, displayed `Africa/Lagos` via `formatLagos`.
- Auth = server-side opaque sessions (httpOnly `sid` cookie) + double-submit CSRF (`csrf` cookie ↔ `x-csrf-token` header). 2FA TOTP mandatory for staff.
- Authorization = `@RequirePermission('resource:action')` guard backed by role→permission rows. Branch scoping via `BranchScopeService`.
- Anything that needs four-eyes goes through `ApprovalsService` (register a handler in `ApprovalRegistry`, call `submit`). Checkers must differ from makers, hold the type's approve permission, and are escalated when the amount exceeds their role limit.
- Every sensitive action calls `AuditService.record()` (hash-chained, append-only). Never write audit rows any other way.
- PII (BVN, NIN, NUBAN, phone, email) is encrypted in DB with `FieldCipher` (versioned keys, blind index `…Hash`), masked in API output by default, revealed only through `POST /pii/reveal` (permission + reason + audit).
- All logs/errors/analytics go through the redactor (`@damez/shared` `Redactor`). Global search and anything PII-bearing must never be sent to an LLM (a gateway with redaction arrives in prompt 4).
- Third-party integration = `interface` + `Mock…Adapter` (default) + `Live…Adapter` stub with TODOs; chosen by env (`*_PROVIDER=mock|live-name`).

## Rules for future work (the rule list)
1. No secrets in code; add every env var to `.env.example` and `src/config/env.ts` (zod-validated).
2. Money in kobo integers only; add `…Kobo` suffix to every money field.
3. New permission keys go in `packages/shared/src/permissions.ts` (+ role defaults in `roles.ts`), then re-seed.
4. New approval-gated action: add to `approvals.ts`, register a handler, add limits in `roles.ts`.
5. Sensitive mutations must be audited with before/after.
6. Never log or return clear PII; use masks + reveal endpoint; use `Redactor` for logs.
7. Controllers validate with zod (`ZodPipe`) using schemas from `@damez/shared`.
8. Every integration has interface + mock + live stub; app must run end-to-end offline.
9. Extend seeds (`apps/api/prisma/seed.ts`) in each prompt so dashboards stay alive.
10. Run `npm run lint && npm run typecheck && npm test` before finishing a task.
11. Migrations are versioned and immutable once merged; never edit an applied migration.
12. UI: use shared components (KpiCard, DataTable, MaskedField, MoneyText…), one accent colour, light+dark, mobile responsive.

## Gotchas
- TOTP codes are single-use (replay protection). Same-user re-login within one 30 s step fails; wait for the next step.
- Background polling calls must send `x-background-poll: 1`, otherwise they keep the session alive.
- `next build` must not run with `NODE_ENV=development`. The `/api` rewrite target (`API_INTERNAL_URL`) is baked at build time.
- API e2e (`npm run test:e2e -w @damez/api`) uses the seeded dev DB + Redis (docker compose up -d mysql redis; run db:deploy + db:seed first).

## Phase 2 conventions
- **Two auth surfaces**: staff (`sid`/`csrf`, RBAC) and customer portal (`csid`/`ccsrf`, `@PortalAuth()` + `@CurrentCustomer()`, routes under `/portal/*`). Portal clients send `x-device-fingerprint`.
- **Ports** (`apps/api/src/contracts/ports.ts`) decouple modules: `BUREAU_PORT`, `KYC_TIER_PORT`, `DOCUMENTS_PORT`, `FRAUD_PORT`, `ELIGIBILITY_PORT`, `LOAN_PORTFOLIO_PORT`. Prompt 3 replaces the application-based `LOAN_PORTFOLIO_PORT` with the ledger.
- **Bureau data must come through `BureauService.ensureReport`** (consent gate → cache → pull → persist → audit). Never call a provider directly. Clear BVN/phone are decrypted just-in-time (AAD `customer:<id>:<field>`) and never logged.
- **Eligibility** is a pure engine (`eligibility/engine.ts`) driven by a versioned scorecard JSON (`@damez/shared` `ScorecardDefinition`). New facts: add to `EligibilityFacts` + `FACT_FIELDS`, gather them in `EligibilityService.gatherFacts`.
- **Application state machine** (`applications/state-machine.ts`) is the single source of truth for transitions; unimplemented ones return 501 until prompt 3. All changes go through `ApplicationTransitions` (event + audit + SMS).
- **Pricing changes** to products go through maker-checker (`PRODUCT_RATE_CHANGE` with `changes`); scorecard activation through `SCORECARD_ACTIVATION`.
- **Seeds**: `prisma/seed.ts` (foundation) then `prisma/seed-p2.ts` (boots the Nest context and uses the real services). Fresh DB seed takes a few minutes on a laptop.
- Mock behaviour is keyed off BVN digits (see README / `packages/shared/src/mock-profiles.ts`).
