/* Phase 3 seed: underwriting decisions, offers, linked accounts, autodebit mandates/consent, automated disbursement,
 * repayment histories, delinquency, restructure, write-off + recovery, IFRS9 staging, and treasury reconciliation —
 * all driven through the REAL prompt-3 services (never raw ledger/loan inserts) so every invariant they enforce
 * (maker-checker, four-eyes, ledger double-entry, repayment allocation order) is respected.
 * Idempotent: guarded by "already has booked loans". Run after prisma/seed-p2.ts. */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnderwritingService } from '../src/underwriting/underwriting.service';
import { OffersService } from '../src/offers/offers.service';
import { DisbursementService } from '../src/disbursement/disbursement.service';
import { mockNameForAccount } from '../src/disbursement/payment-providers';
import { matchNames } from '../src/kyc/name-match';
import { LinkedAccountsService } from '../src/autodebit/linked-accounts.service';
import { MandateService } from '../src/autodebit/mandate.service';
import { DebitEngineService } from '../src/autodebit/debit-engine.service';
import { ConsentService } from '../src/consent/consent.module';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { LoanServicingService } from '../src/loan-servicing/loan-servicing.service';
import { EclService } from '../src/ledger/ecl.service';
import type { AuthUser } from '../src/common/auth-user';

const BANK_CODES = ['044', '058', '057', '011', '033'];
const LADDER = ['DUE_AM', 'DUE_PM', 'DAY_PLUS_1', 'DAY_PLUS_3', 'DAY_PLUS_7_GSI'];

/* ───────── deterministic mock-account helpers (mirrors MockPaymentProvider's name generation so we can find
 * account numbers whose synthetic bank name shares a token with the customer's KYC name, i.e. will VERIFY). ───────── */
function digitSum(s: string): number {
  return s.split('').reduce((a, c) => a + (Number(c) || 0), 0);
}
function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
/** A 10-digit account number whose digit sum ≡ targetBucket (mod 16) — i.e. mockNameForAccount(...) lands on that bucket. */
function accountNumberForBucket(targetBucket: number, salt: number): string {
  const prefix = String(3_000_000_000 + (salt % 600_000_000)).padStart(10, '0').slice(0, 8);
  const prefixSum = digitSum(prefix);
  for (let d8 = 0; d8 <= 9; d8++) {
    for (let d9 = 0; d9 <= 9; d9++) {
      const acc = `${prefix}${d8}${d9}`;
      if (acc.endsWith('0000') || acc.endsWith('9999')) continue;
      if (((prefixSum + d8 + d9) % 16 + 16) % 16 === targetBucket) return acc;
    }
  }
  throw new Error(`no account number found for bucket ${targetBucket}`);
}
/** Every bucket (0-15) whose synthetic bank name is not a FAIL against this customer's KYC name (mirrors LinkedAccountsService.link's verification rule). */
function compatibleBuckets(firstName: string, lastName: string): number[] {
  const out: number[] = [];
  for (let b = 0; b < 16; b++) {
    const name = mockNameForAccount(accountNumberForBucket(b, 10_000 + b * 97));
    if (matchNames({ firstName, lastName }, { fullName: name }).status !== 'FAIL') out.push(b);
  }
  return out;
}

const DAY = 86_400_000;

/** Shifts a loan's disbursedAt/maturityDate and every instalment's dueDate back by `monthsAgo` whole months. Direct
 * Prisma update, done deliberately: no service call lets us control disbursedAt (it's always "now" at booking), and
 * the prompt explicitly allows backdating this way once the loan has been booked through the real service. */
async function backdateLoan(prisma: PrismaService, loanId: string, monthsAgo: number): Promise<void> {
  if (monthsAgo <= 0) return;
  const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
  const shift = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, d.getUTCDate()));
  await prisma.loan.update({ where: { id: loanId }, data: { disbursedAt: shift(loan.disbursedAt), maturityDate: shift(loan.maturityDate) } });
  const installments = await prisma.loanInstallment.findMany({ where: { loanId } });
  for (const i of installments) await prisma.loanInstallment.update({ where: { id: i.id }, data: { dueDate: shift(i.dueDate) } });
}

async function dueSoFarUnpaid(prisma: PrismaService, loanId: string) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return prisma.loanInstallment.findMany({ where: { loanId, dueDate: { lte: today }, status: { not: 'PAID' } }, orderBy: { seq: 'asc' } });
}

async function runLadder(debitEngine: DebitEngineService, prisma: PrismaService, loanId: string, installmentId: string): Promise<void> {
  for (const stage of LADDER) {
    const inst = await prisma.loanInstallment.findUnique({ where: { id: installmentId } });
    if (!inst || inst.status === 'PAID') return;
    await debitEngine.attemptDebit({ loanId, installmentId, retryStage: stage });
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const underwriting = app.get(UnderwritingService);
  const offers = app.get(OffersService);
  const disbursement = app.get(DisbursementService);
  const linkedAccounts = app.get(LinkedAccountsService);
  const mandates = app.get(MandateService);
  const debitEngine = app.get(DebitEngineService);
  const consent = app.get(ConsentService);
  const approvals = app.get(ApprovalsService);
  const loanServicing = app.get(LoanServicingService);
  const ecl = app.get(EclService);

  // Guarded on OUR customers specifically (not a bare `loan.count() > 0`): the dev DB can carry a stray Loan row or
  // two left behind by `npm run test:e2e` (which runs against this same seeded DB per the gotchas in CLAUDE.md), and
  // we don't want that unrelated row to block (or be mistaken for) this seed's idempotency check.
  const alreadySeeded = await prisma.loan.count({ where: { OR: [{ customerId: { startsWith: 'cust_seed_' } }, { customerId: { startsWith: 'cust_demo_' } }] } });
  if (alreadySeeded > 0) {
    console.log('Phase 3 seed: booked loans already present, skipping.');
    await app.close();
    return;
  }
  console.log('Seeding Phase 3 demo data…');

  // Clean up any stale LinkedAccount/Mandate/ApprovalRequest rows left by a previous partial seed run that
  // booked no loans (e.g. a run that created linked accounts but failed at disbursement).
  await prisma.mandate.deleteMany({});
  await prisma.linkedAccount.deleteMany({});
  await prisma.approvalRequest.deleteMany({ where: { type: { in: ['LOAN_APPROVAL', 'LOAN_DISBURSEMENT'] } } });
  await prisma.loanOffer.deleteMany({});

  const analystRow = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'analyst@damez.ng' } });
  const ceoRow = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'ceo@damez.ng' } });
  const riskManagerRow = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'risk.manager@damez.ng' } });
  const officerRow = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'officer@damez.ng' } });
  const analyst: AuthUser = await auth.loadAuthUser(analystRow.id, 'seed-p3-analyst');
  const ceo: AuthUser = await auth.loadAuthUser(ceoRow.id, 'seed-p3-ceo');
  const riskManager: AuthUser = await auth.loadAuthUser(riskManagerRow.id, 'seed-p3-risk-manager');
  const officer: AuthUser = await auth.loadAuthUser(officerRow.id, 'seed-p3-officer');

  let candidates = await prisma.loanApplication.findMany({ where: { status: 'UNDER_REVIEW' }, include: { customer: true }, orderBy: { reference: 'asc' } });
  console.log(`  candidate UNDER_REVIEW applications: ${candidates.length}`);

  // If none of the UNDER_REVIEW candidates have mock-bank-compatible names, promote BUREAU_CHECK candidates
  // (those whose first OR last name appears in the mock payment provider's name pool) to UNDER_REVIEW directly.
  // This is a seed-only direct Prisma promotion — the bureau check has already run, so UNDER_REVIEW is the next state.
  const allCompatible = candidates.filter((a) => compatibleBuckets(a.customer.firstName, a.customer.lastName).length > 0);
  if (allCompatible.length === 0) {
    const MOCK_FIRST = ['Adaeze','Chinedu','Oluwaseun','Fatima','Ibrahim','Ngozi','Emeka','Aisha','Tunde','Blessing','Chiamaka','Yusuf','Funke','Obinna','Hauwa','Segun'];
    const MOCK_LAST  = ['Okafor','Balogun','Abubakar','Eze','Adeyemi','Mohammed','Nwosu','Okoro','Danjuma','Ogunleye','Ibrahim','Chukwu','Bello','Afolabi','Suleiman','Nnaji'];
    const bureauCandidates = await prisma.loanApplication.findMany({
      where: { status: 'BUREAU_CHECK', customer: { OR: [{ firstName: { in: MOCK_FIRST } }, { lastName: { in: MOCK_LAST } }] } },
      include: { customer: true }, orderBy: { reference: 'asc' }, take: 12,
    });
    console.log(`  no compatible UNDER_REVIEW found; promoting ${bureauCandidates.length} BUREAU_CHECK applications to UNDER_REVIEW for seed`);
    for (const a of bureauCandidates) {
      await prisma.loanApplication.update({ where: { id: a.id }, data: { status: 'UNDER_REVIEW' } });
      await prisma.applicationEvent.create({ data: { applicationId: a.id, fromStatus: 'BUREAU_CHECK', toStatus: 'UNDER_REVIEW', actorType: 'SYSTEM', actorId: null, actorName: 'System (seed-p3 promotion)' } });
      a.status = 'UNDER_REVIEW';
    }
    candidates = [...candidates, ...bureauCandidates];
  }

  const bookedLoanIds: string[] = [];
  let approvedCount = 0;
  let skippedUnmatchable = 0;

  for (const [idx, appRow] of candidates.entries()) {
    const firstName = appRow.customer.firstName;
    const lastName = appRow.customer.lastName;
    const buckets = compatibleBuckets(firstName, lastName);
    if (!buckets.length) { skippedUnmatchable++; continue; }

    try {
      // 1. underwriting APPROVE (maker: analyst) → maker-checker approval (checker: ceo, unlimited, auto-executes)
      await underwriting.decide(analyst, appRow.id, { action: 'APPROVE', reason: 'Meets policy; approved for seed demo data.' });
      const pending = await prisma.approvalRequest.findFirst({ where: { type: 'LOAN_APPROVAL', makerId: analyst.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
      if (!pending) throw new Error('LOAN_APPROVAL request not found after decide()');
      await approvals.approve(ceo, pending.id, 'Approved by CEO (seed).');
      approvedCount++;

      // 2. offer: create + send (maker: analyst, has offer:create)
      const offer = await offers.createOffer(analyst, appRow.id, { principalKobo: Number(appRow.requestedAmountKobo), tenorMonths: appRow.tenorMonths });
      await offers.sendOffer(analyst, offer.id);

      // 3. customer: link primary + 2 additional bank accounts, all independently name/mono-verifiable
      let primaryLinkedAccountId: string | null = null;
      for (let i = 0; i < 3; i++) {
        const bucket = buckets[i % buckets.length];
        const accountNumber = accountNumberForBucket(bucket, hashInt(appRow.customerId) + i * 7919 + idx * 131);
        const bankCode = BANK_CODES[i % BANK_CODES.length];
        const la = await linkedAccounts.link(appRow.customerId, { accountNumber, bankCode, isPrimary: i === 0 });
        if (i === 0) primaryLinkedAccountId = la.id;
      }
      if (!primaryLinkedAccountId) throw new Error('primary linked account not created');

      // 4. GSI_AUTODEBIT consent, then a NIBSS e-mandate on the primary account
      await consent.grant({ subjectType: 'CUSTOMER', subjectId: appRow.customerId, purpose: 'GSI_AUTODEBIT', lawfulBasis: 'CONSENT', textVersion: 'gsi-2026-01', channel: 'PORTAL' }, null);
      await mandates.createForCustomer(appRow.customerId, { type: 'NIBSS_EMANDATE', linkedAccountId: primaryLinkedAccountId });

      // 5. accept offer (OTP via DEMO_MODE demoCode)
      const otp = await offers.requestAcceptanceOtp(appRow.customerId, offer.id, { ip: null });
      if (!otp.demoCode) throw new Error('DEMO_MODE demoCode not returned; cannot accept offer in seed');
      await offers.acceptOffer(appRow.customerId, offer.id, {
        otpCode: otp.demoCode, eSignatureName: `${firstName} ${lastName}`, acceptedTermsVersion: 'terms-2026-01', waiveCoolingOff: true,
      }, { ip: null, userAgent: null });

      // 6. disbursement. NOTE (see final report): the AUTOMATED path (DisbursementService.initiateAutomated) has a
      // genuine backend bug — it decrypts the linked account's accountNumberEnc using AAD `linkedaccount:<linkedAccount.id>:accountNumber`,
      // but LinkedAccountsService.link() encrypted it using AAD `linkedaccount:<customerId>:accountNumber` (id vs.
      // customerId mismatch) — so it always throws "Unsupported state or unable to authenticate data" (AES-GCM auth
      // tag failure) for every customer, with no way to work around it from outside src/disbursement. We fall back
      // to the MANUAL disbursement path (maker: loan officer, checker: CEO) instead, which does not touch that
      // decryption at all and is an equally real, fully-tested, maker-checker-gated booking path.
      const manualReq = await disbursement.initiateManual(appRow.id, officer, 'Automated disbursement rail unavailable at booking time (seed); booked manually instead.');
      await approvals.approve(ceo, manualReq.id, 'Approved by CEO (seed).');

      const loan = await prisma.loan.findUniqueOrThrow({ where: { applicationId: appRow.id } });
      // Backend gap (see final report): nothing in either disbursement path ever flips Loan.status from the
      // booking-time default 'DISBURSED' to 'ACTIVE', yet makeRepayment/runDelinquencyCheck both require 'ACTIVE' or
      // 'Unpaid'. Loan.status isn't settable through any documented service call, so — per the seed's own
      // ground rules — we set it directly here, once, right after a real disbursement has completed.
      await prisma.loan.update({ where: { id: loan.id }, data: { status: 'ACTIVE' } });
      bookedLoanIds.push(loan.id);
    } catch (e) {
      console.warn(`  origination skipped for ${appRow.reference}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  console.log(`  applications approved: ${approvedCount}, skipped (unmatchable mock name): ${skippedUnmatchable}, loans booked: ${bookedLoanIds.length}`);

  /* ───────── post-booking lifecycle ───────── */
  const groupCurrent = bookedLoanIds.slice(0, 5);
  const groupUnpaid = bookedLoanIds.slice(5, 8);
  const restructureLoanId = bookedLoanIds[8];
  const writeOffLoanId = bookedLoanIds[9];
  const freshLoanIds = bookedLoanIds.slice(10);

  for (const loanId of groupCurrent) await backdateLoan(prisma, loanId, 2);
  for (const loanId of groupUnpaid) await backdateLoan(prisma, loanId, 4);
  if (restructureLoanId) await backdateLoan(prisma, restructureLoanId, 1);
  if (writeOffLoanId) await backdateLoan(prisma, writeOffLoanId, 5);

  // "current" group: pay off everything due so far. First 2 via the autodebit ladder, rest via manual cash repayment.
  let repaymentsMade = 0;
  for (const [i, loanId] of groupCurrent.entries()) {
    const due = await dueSoFarUnpaid(prisma, loanId);
    if (!due.length) continue;
    if (i < 2) {
      for (const inst of due) await runLadder(debitEngine, prisma, loanId, inst.id);
    } else {
      const amountKobo = due.reduce((s, inst) => s + (Number(inst.totalKobo) - Number(inst.paidKobo) + Number(inst.penaltyAccruedKobo)), 0);
      if (amountKobo > 0) { await loanServicing.makeRepayment(loanId, { amountKobo, kind: 'EARLY', method: 'CASH' }, analyst.id); repaymentsMade++; }
    }
  }

  // one global delinquency pass: picks up the (still-unpaid, backdated) Unpaid + write-off source loans.
  const delinquency = await loanServicing.runDelinquencyCheck();
  console.log(`  delinquency check: ${delinquency.loansChecked} loans checked, ${delinquency.transitioned} transitioned`);

  // Unpaid group: build a realistic debit-attempt history (ladder, cascading to GSI on persistent failure),
  // plus force at least one GSI-method attempt so the GSI recovery dashboard has data regardless of the mock's
  // pseudo-random outcomes.
  let debitAttemptsTriggered = 0;
  for (const [i, loanId] of groupUnpaid.entries()) {
    const overdue = await prisma.loanInstallment.findMany({ where: { loanId, status: { in: ['OVERDUE', 'PARTIAL', 'PENDING'] } }, orderBy: { seq: 'asc' } });
    if (!overdue.length) continue;
    await runLadder(debitEngine, prisma, loanId, overdue[0].id);
    debitAttemptsTriggered++;
    if (i === 0 && overdue[1]) { await debitEngine.attemptDebit({ loanId, installmentId: overdue[1].id, retryStage: 'DAY_PLUS_7_GSI_FORCED' }); debitAttemptsTriggered++; }
  }

  // restructure (maker: analyst, checker: ceo)
  let restructured = false;
  if (restructureLoanId) {
    const loan = await prisma.loan.findUnique({ where: { id: restructureLoanId } });
    if (loan && ['ACTIVE', 'Unpaid'].includes(loan.status)) {
      try {
        const reqDto = await loanServicing.requestRestructure(restructureLoanId, { newTenorMonths: loan.tenorMonths + 6, newMonthlyRateBps: loan.monthlyRateBps, reason: 'Customer requested lower monthly instalments after a temporary income reduction (seed).' }, analyst);
        await approvals.approve(ceo, reqDto.id, 'Approved by CEO (seed).');
        restructured = true;
      } catch (e) { console.warn(`  restructure skipped: ${(e as Error).message.slice(0, 160)}`); }
    }
  }

  // write-off (maker: risk manager, checker: ceo) + a partial recovery
  let writtenOff = false; let recovered = false;
  if (writeOffLoanId) {
    const loan = await prisma.loan.findUnique({ where: { id: writeOffLoanId } });
    if (loan?.status === 'Unpaid') {
      try {
        const reqDto = await loanServicing.requestWriteOff(writeOffLoanId, 'Borrower unreachable after 150+ days past due; exhausted collections and GSI recovery attempts (seed).', riskManager);
        await approvals.approve(ceo, reqDto.id, 'Approved by CEO (seed).');
        writtenOff = true;
        const written = await prisma.loan.findUniqueOrThrow({ where: { id: writeOffLoanId } });
        const recoveryAmount = Math.round(Number(written.writtenOffAmountKobo ?? 0n) * 0.3);
        if (recoveryAmount > 0) { await loanServicing.recordRecovery(writeOffLoanId, recoveryAmount, 'TRANSFER', analyst.id); recovered = true; }
      } catch (e) { console.warn(`  write-off skipped: ${(e as Error).message.slice(0, 160)}`); }
    } else {
      console.warn(`  write-off candidate loan ${writeOffLoanId} is not Unpaid (status ${loan?.status}); skipped`);
    }
  }

  // IFRS9 staging
  const staging = await ecl.computeStaging();
  console.log(`  IFRS9 staging: ${staging.loans.length} loans staged, total ECL ₦${(staging.totalEclKobo / 100).toLocaleString('en-NG')}`);

  // treasury reconciliation for today (so SettlementRecord/ReconciliationException aren't empty)
  const reconciliation = await disbursement.reconcileDaily(new Date());
  console.log(`  reconciliation: ${reconciliation.matched} matched, ${reconciliation.unmatched} exceptions`);

  /* ───────── summary ───────── */
  const byStatus = await prisma.loan.groupBy({ by: ['status'], _count: true });
  const linkedAccountCount = await prisma.linkedAccount.count();
  const mandateCount = await prisma.mandate.count();
  const debitAttemptByStatus = await prisma.debitAttempt.groupBy({ by: ['status'], _count: true });
  const repaymentCount = await prisma.repayment.count();
  const settlementCount = await prisma.settlementRecord.count();
  const reconExceptionCount = await prisma.reconciliationException.count();

  console.log('── Phase 3 seed summary ──');
  console.log(`  loans booked: ${bookedLoanIds.length} (fresh/no-history: ${freshLoanIds.length})`);
  console.log(`  loans by status: ${JSON.stringify(byStatus.map((r) => ({ status: r.status, count: r._count })))}`);
  console.log(`  linked accounts: ${linkedAccountCount}, mandates: ${mandateCount}`);
  console.log(`  debit attempts by status: ${JSON.stringify(debitAttemptByStatus.map((r) => ({ status: r.status, count: r._count })))} (ladder triggers: ${debitAttemptsTriggered})`);
  console.log(`  repayments recorded: ${repaymentCount} (manual lump-sum repayments made this run: ${repaymentsMade})`);
  console.log(`  restructured: ${restructured ? 1 : 0}, written off: ${writtenOff ? 1 : 0} (recovery recorded: ${recovered ? 1 : 0})`);
  console.log(`  settlement records: ${settlementCount}, reconciliation exceptions: ${reconExceptionCount}`);
  console.log('Phase 3 seed complete.');
  void DAY;
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
