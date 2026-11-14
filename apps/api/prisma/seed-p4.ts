/* Phase 4 seed: collection cases in all DPD buckets, PTPs, collection activities, agency assignments,
 * behaviour snapshots, early warning flags, PII vault canary tokens, and LLM block log samples.
 * Idempotent: guarded by "already has collection cases". Run after seed-p3.ts. */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AGENTS = ['agent_seed_1', 'agent_seed_2', 'agent_seed_3'];
const AGENT_NAMES = ['Chinwe Okafor', 'Emeka Balogun', 'Fatima Abubakar'];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log('[seed-p4] Starting prompt-4 seed...');

  // Guard: skip if already seeded
  const existingCases = await prisma.collectionCase.count();
  if (existingCases > 5) {
    console.log('[seed-p4] Collection cases already seeded, skipping.');
    await prisma.$disconnect();
    return;
  }

  // ── 1. Ensure we have a ThirdPartyAgency ──────────────────────────────────
  let agency = await prisma.thirdPartyAgency.findFirst({ where: { code: 'RECOVERY_CORP' } });
  if (!agency) {
    agency = await prisma.thirdPartyAgency.create({
      data: {
        name: 'Recovery Corp Nigeria Ltd',
        code: 'RECOVERY_CORP',
        commissionBps: 1500,
        contactEmail: 'ops@recoverycorp.ng',
        contactPhone: '0802000001',
        isActive: true,
      },
    });
    console.log('[seed-p4] Created ThirdPartyAgency:', agency.code);
  }

  // ── 2. Get existing active loans ─────────────────────────────────────────
  const loans = await prisma.loan.findMany({
    where: { status: { in: ['DISBURSED', 'ACTIVE'] } },
    include: { customer: true, product: true },
    orderBy: { disbursedAt: 'asc' },
  });

  if (loans.length === 0) {
    console.log('[seed-p4] No active loans found — run seed-p3.ts first.');
    await prisma.$disconnect();
    return;
  }

  console.log(`[seed-p4] Found ${loans.length} active loans. Creating collection cases...`);

  // ── 3. Create Unpaid loans in all DPD buckets ────────────────────────
  // We'll create additional "synthetic" Unpaid loans by creating CollectionCase rows
  // pointing to existing loans but with back-dated dpd values.
  // For the existing active loans: just set their dpd and create cases.

  const buckets: Array<{ bucket: string; dpd: number; ifrsStage: number }> = [
    { bucket: 'DPD_1_7', dpd: 5, ifrsStage: 1 },
    { bucket: 'DPD_8_30', dpd: 18, ifrsStage: 2 },
    { bucket: 'DPD_31_60', dpd: 45, ifrsStage: 2 },
    { bucket: 'DPD_61_90', dpd: 75, ifrsStage: 3 },
    { bucket: 'DPD_90_PLUS', dpd: 120, ifrsStage: 3 },
  ];

  const createdCases: string[] = [];

  for (let i = 0; i < loans.length && i < buckets.length; i++) {
    const loan = loans[i];
    const { bucket, dpd, ifrsStage } = buckets[i];
    const agentIdx = i % AGENTS.length;

    // Update loan dpd and ifrsStage
    await prisma.loan.update({
      where: { id: loan.id },
      data: { dpd, ifrsStage },
    });

    // Create CollectionCase
    const existing = await prisma.collectionCase.findFirst({ where: { loanId: loan.id } });
    if (existing) {
      createdCases.push(existing.id);
      continue;
    }

    const outstanding = loan.outstandingPrincipalKobo > 0n
      ? loan.outstandingPrincipalKobo
      : loan.principalKobo;

    const collCase = await prisma.collectionCase.create({
      data: {
        loanId: loan.id,
        customerId: loan.customerId,
        branchId: loan.branchId,
        assignedToId: AGENTS[agentIdx],
        assignedToName: AGENT_NAMES[agentIdx],
        bucket: bucket as any,
        dpd,
        status: dpd > 90 ? 'AGENCY' : dpd > 30 ? 'IN_PROGRESS' : 'OPEN',
        priority: Math.min(100, Math.round(dpd * 0.8 + 10)),
        totalOutstandingKobo: outstanding,
      },
    });
    createdCases.push(collCase.id);
    console.log(`[seed-p4] Created CollectionCase ${collCase.id} (bucket=${bucket}, dpd=${dpd})`);
  }

  // ── 4. Create collection activities ──────────────────────────────────────
  const channels = ['PHONE_CALL', 'SMS', 'WHATSAPP', 'EMAIL'] as const;
  const outcomes = ['NO_ANSWER', 'SPOKE_TO_BORROWER', 'PROMISE_TO_PAY', 'LEFT_VOICEMAIL', 'PAYMENT_MADE'] as const;

  for (let idx = 0; idx < createdCases.length; idx++) {
    const caseId = createdCases[idx];
    const numActivities = 3 + (idx % 3);

    for (let j = 0; j < numActivities; j++) {
      const channel = channels[(idx + j) % channels.length];
      const outcome = outcomes[(idx + j) % outcomes.length];
      await prisma.collectionActivity.create({
        data: {
          caseId,
          agentId: AGENTS[idx % AGENTS.length],
          agentName: AGENT_NAMES[idx % AGENTS.length],
          channel: channel as any,
          outcome: outcome as any,
          notes: outcome === 'SPOKE_TO_BORROWER' ? 'Customer aware of outstanding balance, promised to pay by month end.' : null,
          contactedAt: daysAgo(numActivities - j),
          nextActionAt: j === numActivities - 1 ? daysFromNow(3) : null,
          nextActionNote: j === numActivities - 1 ? 'Follow up on payment' : null,
          durationSecs: channel === 'PHONE_CALL' ? 180 + (j * 60) : null,
          isFieldVisit: false,
        },
      });
    }
  }
  console.log('[seed-p4] Created collection activities');

  // ── 5. Create Promise-to-Pay records ─────────────────────────────────────
  for (let idx = 0; idx < Math.min(createdCases.length, 3); idx++) {
    const caseId = createdCases[idx];
    const collCase = await prisma.collectionCase.findUnique({ where: { id: caseId } });
    if (!collCase) continue;

    // One kept PTP
    await prisma.promiseToPay.create({
      data: {
        caseId,
        customerId: collCase.customerId,
        amountKobo: collCase.totalOutstandingKobo / 4n,
        promisedDate: daysAgo(5),
        status: idx % 2 === 0 ? 'KEPT' : 'BROKEN',
        keptAt: idx % 2 === 0 ? daysAgo(4) : null,
        brokenAt: idx % 2 !== 0 ? daysAgo(3) : null,
      },
    });

    // One open PTP
    await prisma.promiseToPay.create({
      data: {
        caseId,
        customerId: collCase.customerId,
        amountKobo: collCase.totalOutstandingKobo / 2n,
        promisedDate: daysFromNow(7),
        status: 'PENDING',
      },
    });
  }
  console.log('[seed-p4] Created PTP records');

  // ── 6. Create Agency Assignment for DPD_90_PLUS case ─────────────────────
  const nplCase = await prisma.collectionCase.findFirst({
    where: { bucket: 'DPD_90_PLUS' },
  });
  if (nplCase && agency) {
    const existingAssignment = await prisma.agencyAssignment.findFirst({
      where: { caseId: nplCase.id },
    });
    if (!existingAssignment) {
      await prisma.agencyAssignment.create({
        data: {
          caseId: nplCase.id,
          agencyId: agency.id,
          commissionBps: agency.commissionBps,
          status: 'ACTIVE',
          recoveredKobo: 0n,
        },
      });
      console.log('[seed-p4] Created AgencyAssignment for NPL case');
    }
  }

  // ── 7. Behaviour snapshots ─────────────────────────────────────────────
  const customers = await prisma.customer.findMany({
    where: { erasedAt: null },
    take: 10,
  });

  const segments = ['RELIABLE', 'SALARY_CYCLE_PAYER', 'RELUCTANT', 'HIGH_RISK', 'AT_RISK_OF_CHURN', 'RELIABLE', 'UNKNOWN', 'RELIABLE', 'SALARY_CYCLE_PAYER', 'HIGH_RISK'];

  for (let i = 0; i < customers.length; i++) {
    const cust = customers[i];
    const segment = segments[i % segments.length];
    const existingSnap = await prisma.behaviourSnapshot.findFirst({
      where: { customerId: cust.id },
    });
    if (existingSnap) continue;

    const onTimeRatio = segment === 'RELIABLE' ? 0.92 : segment === 'HIGH_RISK' ? 0.35 : 0.65;
    const pdScore = segment === 'RELIABLE' ? 0.08 : segment === 'HIGH_RISK' ? 0.78 : segment === 'AT_RISK_OF_CHURN' ? 0.22 : 0.40;

    await prisma.behaviourSnapshot.create({
      data: {
        customerId: cust.id,
        snapshotDate: new Date(),
        onTimeRatio,
        avgDaysLate: segment === 'RELIABLE' ? 1.2 : segment === 'HIGH_RISK' ? 42.5 : 8.3,
        paydaySensitivity: segment === 'SALARY_CYCLE_PAYER' ? 0.82 : 0.35,
        channelResponsiveness: segment === 'RELUCTANT' ? 0.15 : 0.65,
        partialPaymentRatio: segment === 'HIGH_RISK' ? 0.45 : 0.12,
        avgBalanceAtDebitKobo: BigInt(150_000_00 + (i * 50_000_00)),
        repeatBorrowVelocity: segment === 'AT_RISK_OF_CHURN' ? 0.05 : 0.25,
        bureauDefaultCount: segment === 'HIGH_RISK' ? 2 : 0,
        pdScore,
        segment,
        summaryText: generateSummary(segment as any, onTimeRatio, pdScore),
      },
    });
  }
  console.log(`[seed-p4] Created behaviour snapshots for ${customers.length} customers`);

  // ── 8. Early warning flags ─────────────────────────────────────────────
  const highRiskLoans = await prisma.loan.findMany({
    where: { dpd: { gt: 30 }, status: { in: ['DISBURSED', 'ACTIVE'] } },
    include: { customer: true },
    take: 3,
  });

  for (const loan of highRiskLoans) {
    const existingFlag = await prisma.earlyWarningFlag.findFirst({
      where: { loanId: loan.id, status: 'OPEN' },
    });
    if (existingFlag) continue;

    await prisma.earlyWarningFlag.create({
      data: {
        customerId: loan.customerId,
        loanId: loan.id,
        flagDate: new Date(),
        pdScore: 0.65 + (Math.random() * 0.2),
        triggerReason: 'DPD exceeded 30 days; PD score elevated above 0.5 threshold',
        status: 'OPEN',
      },
    });
  }
  console.log('[seed-p4] Created early warning flags');

  // ── 9. PII vault canary tokens (for test detection) ───────────────────
  const existingCanary = await prisma.piiToken.findFirst({ where: { scope: 'canary' } });
  if (!existingCanary) {
    await prisma.piiToken.create({
      data: {
        token: 'BVN_CANARY1',
        tokenType: 'BVN',
        tenantId: 'damez',
        scope: 'canary',
        encValue: 'canary:placeholder:this:is:not:real:pii',
        expiresAt: daysFromNow(365),
      },
    });
    await prisma.piiToken.create({
      data: {
        token: 'PHONE_CANARY1',
        tokenType: 'PHONE',
        tenantId: 'damez',
        scope: 'canary',
        encValue: 'canary:placeholder:this:is:not:real:pii',
        expiresAt: daysFromNow(365),
      },
    });
    console.log('[seed-p4] Created PII vault canary tokens');
  }

  // ── 10. LLM block log samples ─────────────────────────────────────────
  const existingBlock = await prisma.llmBlockLog.count();
  if (existingBlock === 0) {
    await prisma.llmBlockLog.createMany({
      data: [
        { feature: 'behaviour.summary', userId: null, detectedTerms: [{ type: 'BVN' }, { type: 'PHONE' }], requestHash: 'seed-hash-001', createdAt: daysAgo(2) },
        { feature: 'behaviour.segment', userId: null, detectedTerms: [{ type: 'EMAIL' }], requestHash: 'seed-hash-002', createdAt: daysAgo(1) },
      ],
    });
    console.log('[seed-p4] Created LLM block log samples');
  }

  console.log('[seed-p4] Phase 4 seed complete!');
  await prisma.$disconnect();
}

function generateSummary(segment: string, onTimeRatio: number, pdScore: number): string {
  const onTimePct = Math.round(onTimeRatio * 100);
  if (segment === 'RELIABLE') {
    return `This customer has an excellent repayment history with ${onTimePct}% on-time payments. They consistently repay in full and have no bureau defaults. Risk profile is very low (PD score: ${pdScore.toFixed(2)}).`;
  }
  if (segment === 'SALARY_CYCLE_PAYER') {
    return `This customer pays reliably around their salary date, with ${onTimePct}% on-time payments. Repayments are concentrated in the 1–3 days following their payday. Contact is most effective just before their salary date.`;
  }
  if (segment === 'RELUCTANT') {
    return `This customer has ${onTimePct}% on-time payments and shows low responsiveness to collection outreach. SMS contact is more effective than voice calls. The PD score of ${pdScore.toFixed(2)} indicates moderate-to-high risk.`;
  }
  if (segment === 'HIGH_RISK') {
    return `This customer shows significant delinquency risk with only ${onTimePct}% on-time payments and elevated PD score of ${pdScore.toFixed(2)}. Bureau defaults have been recorded. Proactive early intervention is recommended.`;
  }
  if (segment === 'AT_RISK_OF_CHURN') {
    return `This customer has a good repayment history (${onTimePct}% on-time) but has not taken a new loan in over 6 months. They may be borrowing from competitors. Proactive re-engagement is recommended.`;
  }
  return `This customer has ${onTimePct}% on-time payments with a PD score of ${pdScore.toFixed(2)}. Insufficient data for detailed segmentation.`;
}

main().catch((e) => {
  console.error('[seed-p4] Error:', e);
  process.exit(1);
});
