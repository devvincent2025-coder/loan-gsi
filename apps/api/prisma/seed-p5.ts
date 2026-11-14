/* Phase 5 seed: Executive supervisory intelligence data — portfolio metrics,
 * branch metrics, agent metrics, anomaly records, executive briefings, and chat sessions.
 * Idempotent: guarded by "already has PortfolioDailyMetrics". Run after seed-p4.ts. */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ── PRNG (deterministic so re-runs are stable) ─────────────────────────────
let _seed = 20260301;
const rnd = () => {
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + rnd() * (b - a);
const betweenInt = (a: number, b: number) => Math.floor(between(a, b + 1));
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// ── Helpers ─────────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function cuid(prefix: string, n: number): string {
  return `${prefix}_p5_seed_${String(n).padStart(4, '0')}`;
}

const BRANCHES = [
  { id: 'branch_seed_1', name: 'Head Office, Abuja', code: 'ABJ-HQ', risk: 'low' },
  { id: 'branch_seed_2', name: 'Kubwa Branch', code: 'ABJ-KUB', risk: 'medium' },
  { id: 'branch_seed_3', name: 'Suleja Branch', code: 'ABJ-SUL', risk: 'low' },
  { id: 'branch_seed_4', name: 'Kwara Branch', code: 'ABJ-KWA', risk: 'medium' }
];

const AGENTS = [
  { id: 'staff_seed_007', name: 'Chioma Okonkwo', branchId: 'branch_seed_2' },
  { id: 'staff_seed_014', name: 'Aisha Bello', branchId: 'branch_seed_3' },
  { id: 'staff_seed_006', name: 'Ibrahim Lawal', branchId: 'branch_seed_1' },
  { id: 'staff_seed_011', name: 'Musa Abdullahi', branchId: 'branch_seed_3' },
  { id: 'staff_seed_012', name: 'Obinna Chukwu', branchId: 'branch_seed_4' },
];

const NIGERIAN_BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '058', name: 'GTBank' },
  { code: '011', name: 'First Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '033', name: 'UBA' },
];

async function main() {
  console.log('[seed-p5] Starting prompt-5 seed...');

  // Guard: skip if already seeded
  const existing = await prisma.portfolioDailyMetrics.count();
  if (existing > 5) {
    console.log('[seed-p5] PortfolioDailyMetrics already seeded, skipping.');
    return;
  }

  // ── 1. PortfolioDailyMetrics — 90 days ──────────────────────────────────
  console.log('[seed-p5] Generating 90 days of PortfolioDailyMetrics...');
  const portfolioRows = [];
  let par30 = 0.08;
  let par90 = 0.03;
  let npl = 0.025;
  let collEff = 0.82;
  let activeLoans = 80;
  let totalDisbursed = 2_800_000_000n; // ₦28M in kobo
  let totalOutstanding = 980_000_000n; // ₦9.8M
  let totalRepaid = 1_820_000_000n;

  for (let d = 89; d >= 0; d--) {
    const snap = daysAgo(d);
    const week = Math.floor((89 - d) / 7);
    const dayOfWeek = snap.getUTCDay(); // 0=Sun

    // Weekly drift
    const weeklyNoise = (rnd() - 0.5) * 0.003;
    // Month-end spike in collections
    const dayOfMonth = snap.getUTCDate();
    const monthEndBoost = dayOfMonth >= 28 ? 0.02 : 0;

    // Week 6 PAR spike anomaly
    if (week === 6) {
      par30 = clamp(par30 + 0.008 + weeklyNoise, 0.05, 0.25);
      par90 = clamp(par90 + 0.003 + weeklyNoise * 0.5, 0.02, 0.15);
    } else if (week === 7) {
      // Recovery after spike
      par30 = clamp(par30 - 0.005 + weeklyNoise, 0.05, 0.25);
    } else {
      par30 = clamp(par30 + (rnd() - 0.52) * 0.004, 0.05, 0.18);
    }
    npl = clamp(par90 * 0.85 + weeklyNoise * 0.3, 0.01, 0.12);
    par90 = clamp(par30 * 0.38 + weeklyNoise * 0.5, 0.01, 0.12);

    // Week 10 collection efficiency drop
    if (week === 10) {
      collEff = clamp(collEff - 0.06 + weeklyNoise, 0.65, 0.95);
    } else {
      collEff = clamp(collEff + monthEndBoost + (rnd() - 0.48) * 0.01, 0.70, 0.95);
    }

    // Active loans grow from 80 to 120
    activeLoans = clamp(80 + Math.floor((89 - d) * 0.45) + betweenInt(-2, 2), 75, 130);

    // Disbursements vary by day (lower on weekends)
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const disbKobo = isWeekend
      ? BigInt(betweenInt(500_000_00, 800_000_00)) // ₦500k-₦800k
      : BigInt(betweenInt(500_000_000, 3_000_000_000)); // ₦5M-₦30M
    const disbCount = isWeekend ? betweenInt(0, 3) : betweenInt(3, 20);

    totalDisbursed += disbKobo;
    totalOutstanding += disbKobo / 2n;
    totalRepaid += disbKobo / 3n;

    const avgTicket = disbCount > 0 ? disbKobo / BigInt(disbCount) : 0n;

    portfolioRows.push({
      id: cuid('pdm', 90 - d),
      snapshotDate: snap,
      totalDisbursedKobo: totalDisbursed,
      totalOutstandingKobo: totalOutstanding,
      totalRepaidKobo: totalRepaid,
      par30Ratio: Math.round(par30 * 10000) / 10000,
      par90Ratio: Math.round(par90 * 10000) / 10000,
      nplRatio: Math.round(npl * 10000) / 10000,
      activeLoansCount: activeLoans,
      disbursementsCount: disbCount,
      disbursementsKobo: disbKobo,
      collectionEfficiency: Math.round(collEff * 10000) / 10000,
      yieldBps: betweenInt(2200, 2600),
      costOfRiskBps: Math.round(par30 * 10000 * 0.8),
      eclTotalKobo: BigInt(Math.floor(Number(totalOutstanding) * npl * 0.4)),
      avgLoanAmountKobo: avgTicket,
    });
  }

  await prisma.portfolioDailyMetrics.createMany({ data: portfolioRows, skipDuplicates: true });
  console.log(`[seed-p5] Created ${portfolioRows.length} PortfolioDailyMetrics rows`);

  // ── 2. BranchDailyMetrics — 30 days across 8 branches ───────────────────
  console.log('[seed-p5] Generating BranchDailyMetrics...');
  const branchRows = [];
  for (let d = 29; d >= 0; d--) {
    const snap = daysAgo(d);
    for (const branch of BRANCHES) {
      const isKano = branch.code === 'KAN-NAS';
      const isAbuja = branch.code === 'ABJ-WUS';
      const week = Math.floor((29 - d) / 7);

      // Kano: deteriorating PAR trend
      let brPar30 = isKano
        ? 0.12 + week * 0.015 + (rnd() - 0.4) * 0.01
        : isAbuja
          ? 0.04 + (rnd() - 0.5) * 0.008
          : 0.07 + (rnd() - 0.5) * 0.015;
      brPar30 = clamp(brPar30, 0.01, 0.35);

      const brPar90 = clamp(brPar30 * 0.4 + (rnd() - 0.5) * 0.005, 0.005, 0.15);
      const brNpl = clamp(brPar90 * 0.85, 0.003, 0.12);
      const brCollEff = isKano
        ? clamp(0.72 - week * 0.01 + (rnd() - 0.5) * 0.02, 0.55, 0.85)
        : clamp(0.84 + (rnd() - 0.5) * 0.04, 0.70, 0.95);

      const activeCount = betweenInt(8, 25);
      const disbKobo = BigInt(betweenInt(5_000_000_0, 30_000_000_0)); // ₦500k–₦3M
      const outstandingKobo = BigInt(betweenInt(50_000_000_0, 200_000_000_0));

      branchRows.push({
        id: cuid(`bdm_${branch.code}`, 30 - d),
        snapshotDate: snap,
        branchId: branch.id,
        branchName: branch.name,
        activeLoansCount: activeCount,
        disbursementsKobo: disbKobo,
        disbursementsCount: betweenInt(1, 8),
        outstandingKobo,
        par30Ratio: Math.round(brPar30 * 10000) / 10000,
        par90Ratio: Math.round(brPar90 * 10000) / 10000,
        nplRatio: Math.round(brNpl * 10000) / 10000,
        collectionEfficiency: Math.round(brCollEff * 10000) / 10000,
        agentsCount: betweenInt(1, 4),
      });
    }
  }

  await prisma.branchDailyMetrics.createMany({ data: branchRows, skipDuplicates: true });
  console.log(`[seed-p5] Created ${branchRows.length} BranchDailyMetrics rows`);

  // ── 3. AgentDailyMetrics — 30 days, 5 agents ────────────────────────────
  console.log('[seed-p5] Generating AgentDailyMetrics...');
  const agentRows = [];
  for (let d = 29; d >= 0; d--) {
    const snap = daysAgo(d);
    for (let i = 0; i < AGENTS.length; i++) {
      const agent = AGENTS[i];
      const dayOfWeek = snap.getUTCDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      if (isWeekend && rnd() > 0.3) continue; // agents mostly don't work weekends

      const cases = betweenInt(3, 15);
      const ptpCreated = betweenInt(1, Math.ceil(cases * 0.5));
      const ptpKept = betweenInt(0, ptpCreated);
      const recovered = BigInt(betweenInt(5_000_000, 50_000_000)); // ₦50k–₦500k

      agentRows.push({
        id: cuid(`adm_${agent.id}`, (30 - d) * 10 + i),
        snapshotDate: snap,
        agentId: agent.id,
        agentName: agent.name,
        branchId: agent.branchId,
        casesHandled: cases,
        ptpCreated,
        ptpKept,
        amountRecoveredKobo: recovered,
        callsMade: betweenInt(cases, cases * 3),
      });
    }
  }

  await prisma.agentDailyMetrics.createMany({ data: agentRows, skipDuplicates: true });
  console.log(`[seed-p5] Created ${agentRows.length} AgentDailyMetrics rows`);

  // ── 4. CollectionsDaily — 30 days ───────────────────────────────────────
  console.log('[seed-p5] Generating CollectionsDaily...');
  const collectionsRows = [];
  for (let d = 29; d >= 0; d--) {
    const snap = daysAgo(d);
    const week = Math.floor((29 - d) / 7);

    // Portfolio-wide row (branchId = null)
    collectionsRows.push({
      id: cuid('cd_all', 30 - d),
      snapshotDate: snap,
      branchId: null,
      openCasesCount: betweenInt(20, 40),
      resolvedCasesCount: betweenInt(5, 15),
      ptpKeptRate: clamp(0.62 + (rnd() - 0.5) * 0.08, 0.45, 0.80),
      ptpBrokenRate: clamp(0.28 + (rnd() - 0.5) * 0.06, 0.15, 0.45),
      cureRate30d: clamp(0.18 + (rnd() - 0.5) * 0.04, 0.10, 0.30),
      amountRecoveredKobo: BigInt(betweenInt(20_000_000_0, 80_000_000_0)), // ₦2M–₦8M
      agencyAssignedCount: betweenInt(0, 3),
      writeOffKobo: week === 3 ? BigInt(betweenInt(50_000_000_0, 100_000_000_0)) : 0n,
    });

    // Kano branch row
    const kanoWeek = week >= 2 ? week : 0;
    collectionsRows.push({
      id: cuid('cd_kano', 30 - d),
      snapshotDate: snap,
      branchId: 'branch_seed_7',
      openCasesCount: betweenInt(8, 15) + kanoWeek,
      resolvedCasesCount: betweenInt(1, 4),
      ptpKeptRate: clamp(0.52 - kanoWeek * 0.02 + (rnd() - 0.5) * 0.05, 0.30, 0.70),
      ptpBrokenRate: clamp(0.38 + kanoWeek * 0.02 + (rnd() - 0.5) * 0.04, 0.25, 0.60),
      cureRate30d: clamp(0.12 - kanoWeek * 0.01 + (rnd() - 0.5) * 0.03, 0.05, 0.25),
      amountRecoveredKobo: BigInt(betweenInt(3_000_000_0, 12_000_000_0)),
      agencyAssignedCount: betweenInt(0, 2),
      writeOffKobo: 0n,
    });
  }

  await prisma.collectionsDaily.createMany({ data: collectionsRows, skipDuplicates: true });
  console.log(`[seed-p5] Created ${collectionsRows.length} CollectionsDaily rows`);

  // ── 5. DebitDaily — 30 days, 5 banks ────────────────────────────────────
  console.log('[seed-p5] Generating DebitDaily...');
  const debitRows = [];
  for (let d = 29; d >= 0; d--) {
    const snap = daysAgo(d);
    for (let b = 0; b < NIGERIAN_BANKS.length; b++) {
      const bank = NIGERIAN_BANKS[b];
      const attempts = betweenInt(10, 50);
      const successCount = betweenInt(Math.floor(attempts * 0.55), Math.floor(attempts * 0.85));
      const failureCount = attempts - successCount;
      const successAmt = BigInt(betweenInt(10_000_000_0, 50_000_000_0));
      const failureAmt = BigInt(betweenInt(2_000_000_0, 15_000_000_0));

      debitRows.push({
        id: cuid(`dd_${bank.code}`, (30 - d) * 10 + b),
        snapshotDate: snap,
        bankCode: bank.code,
        totalAttempts: attempts,
        successCount,
        failureCount,
        successAmountKobo: successAmt,
        failureAmountKobo: failureAmt,
        gsiTriggeredCount: betweenInt(0, Math.floor(failureCount * 0.3)),
      });
    }
  }

  await prisma.debitDaily.createMany({ data: debitRows, skipDuplicates: true });
  console.log(`[seed-p5] Created ${debitRows.length} DebitDaily rows`);

  // ── 6. BureauDistributionDaily — today's snapshot ───────────────────────
  console.log('[seed-p5] Generating BureauDistributionDaily...');
  const today = daysAgo(0);
  const bureauBuckets = [
    { bucket: '300-399', count: 12, avgScore: 348, par30: 0.28 },
    { bucket: '400-499', count: 28, avgScore: 452, par30: 0.18 },
    { bucket: '500-599', count: 67, avgScore: 547, par30: 0.09 }, // most customers
    { bucket: '600-699', count: 43, avgScore: 641, par30: 0.05 },
    { bucket: '700+', count: 18, avgScore: 724, par30: 0.02 },
  ];

  const bureauRows = bureauBuckets.map((b, i) => ({
    id: cuid('bdd', i),
    snapshotDate: today,
    scoreBucket: b.bucket,
    customerCount: b.count + betweenInt(-2, 2),
    avgScore: b.avgScore + between(-5, 5),
    par30Ratio: clamp(b.par30 + (rnd() - 0.5) * 0.02, 0.01, 0.40),
  }));

  await prisma.bureauDistributionDaily.createMany({ data: bureauRows, skipDuplicates: true });
  console.log(`[seed-p5] Created ${bureauRows.length} BureauDistributionDaily rows`);

  // ── 7. AnomalyRecord samples ─────────────────────────────────────────────
  console.log('[seed-p5] Generating AnomalyRecord samples...');

  const anomalies = [
    {
      id: 'anomaly_p5_seed_0001',
      detectedAt: daysAgo(3),
      metric: 'par30Ratio',
      dimension: 'branch:KAN-NAS',
      severity: 'CRITICAL' as const,
      status: 'OPEN' as const,
      zScore: 3.21,
      baseline: 0.09,
      actual: 0.19,
      description:
        'Kano branch PAR30 ratio spiked to 19% — 3.2σ above the 90-day baseline of 9%. Deteriorating trend observed for 2 consecutive weeks.',
      llmExplanation:
        'The Kano branch PAR30 ratio has exceeded the 3σ threshold, suggesting a systemic collections issue rather than random variance. Key contributing factors: (1) two large borrowers (combined exposure ₦8.2M) missed payments this week, (2) collections agent headcount dropped from 4 to 2 due to transfers, (3) the branch has not conducted field visits in 14 days.',
      llmActions: [
        'Escalate to Regional Collections Manager within 24 hours',
        'Assign additional collections agents from Kaduna branch temporarily',
        'Initiate field visits for top 10 overdue accounts by exposure',
        'Review and tighten disbursement criteria for new Kano applications',
      ],
    },
    {
      id: 'anomaly_p5_seed_0002',
      detectedAt: daysAgo(18),
      metric: 'collectionEfficiency',
      dimension: 'portfolio',
      severity: 'CRITICAL' as const,
      status: 'RESOLVED' as const,
      zScore: -2.85,
      baseline: 0.83,
      actual: 0.71,
      description:
        'Portfolio-wide collection efficiency dropped to 71% — 2.9σ below the 90-day baseline of 83%. Month-over-month decline of 12 percentage points.',
      llmExplanation:
        'The efficiency drop coincided with the introduction of a new repayment reminder schedule that reduced SMS frequency. The previous 3-touch sequence was replaced with a single reminder. Reverting to the original schedule is expected to restore efficiency within 5–7 business days.',
      llmActions: [
        'Revert SMS reminder schedule to 3-touch sequence',
        'Conduct emergency team briefing on collections best practices',
        'Monitor daily for recovery to baseline over next 10 days',
      ],
      resolvedAt: daysAgo(10),
    },
    {
      id: 'anomaly_p5_seed_0003',
      detectedAt: daysAgo(5),
      metric: 'debitSuccessRate',
      dimension: 'bank:044',
      severity: 'WARNING' as const,
      status: 'ACKNOWLEDGED' as const,
      zScore: -2.1,
      baseline: 0.76,
      actual: 0.61,
      description:
        'Access Bank (044) debit success rate dropped to 61% — 2.1σ below baseline of 76%. 23 failed mandates in the last 48 hours.',
      llmExplanation:
        'Access Bank reported scheduled maintenance on their NIP gateway between 22:00–02:00 WAT. Retries during this window inflated the failure count. The bank has confirmed the maintenance window is complete.',
      llmActions: [
        'Schedule debit retries outside 21:00–03:00 WAT for Access Bank customers',
        'Contact Access Bank relationship manager for SLA confirmation',
      ],
    },
    {
      id: 'anomaly_p5_seed_0004',
      detectedAt: daysAgo(7),
      metric: 'par30Ratio',
      dimension: 'branch:KAN-NAS',
      severity: 'WARNING' as const,
      status: 'ACKNOWLEDGED' as const,
      zScore: 2.2,
      baseline: 0.09,
      actual: 0.14,
      description:
        'Kano branch PAR30 crossed the 14% warning threshold (2.2σ above baseline). Early signal now confirmed as CRITICAL in anomaly_p5_seed_0001.',
      llmExplanation: null,
      llmActions: Prisma.JsonNull,
    },
    {
      id: 'anomaly_p5_seed_0005',
      detectedAt: daysAgo(1),
      metric: 'disbursementsCount',
      dimension: 'portfolio',
      severity: 'WARNING' as const,
      status: 'OPEN' as const,
      zScore: -2.0,
      baseline: 11.2,
      actual: 4.0,
      description:
        'Daily disbursements count (4) is 2.0σ below the 30-day average of 11.2. Possible bottleneck in approval queue or credit analyst capacity.',
      llmExplanation: null,
      llmActions: Prisma.JsonNull,
    },
    {
      id: 'anomaly_p5_seed_0006',
      detectedAt: daysAgo(14),
      metric: 'yieldBps',
      dimension: 'product:SALARY_ADVANCE',
      severity: 'INFO' as const,
      status: 'RESOLVED' as const,
      zScore: 1.5,
      baseline: 2350,
      actual: 2580,
      description:
        'Salary Advance product yield rose 1.5σ above baseline — likely due to rate adjustment applied 2 weeks ago. Expected behaviour.',
      llmExplanation: null,
      llmActions: Prisma.JsonNull,
      resolvedAt: daysAgo(12),
    },
    {
      id: 'anomaly_p5_seed_0007',
      detectedAt: daysAgo(8),
      metric: 'bureauScore',
      dimension: 'bucket:300-399',
      severity: 'INFO' as const,
      status: 'RESOLVED' as const,
      zScore: 1.3,
      baseline: 12,
      actual: 16,
      description:
        'Customer count in 300-399 score bucket increased by 33% this week. Minor uptick; within acceptable range for market conditions.',
      llmExplanation: null,
      llmActions: Prisma.JsonNull,
      resolvedAt: daysAgo(5),
    },
  ];

  for (const anomaly of anomalies) {
    const { resolvedAt, ...rest } = anomaly as typeof anomaly & { resolvedAt?: Date };
    await prisma.anomalyRecord.upsert({
      where: { id: anomaly.id },
      update: {},
      create: {
        ...rest,
        resolvedAt: resolvedAt ?? null,
      },
    });
  }
  console.log(`[seed-p5] Created ${anomalies.length} AnomalyRecord rows`);

  // ── 8. ExecutiveBriefing ─────────────────────────────────────────────────
  console.log('[seed-p5] Generating ExecutiveBriefing...');
  const today2 = new Date();
  today2.setUTCHours(7, 0, 0, 0);
  const yesterday = new Date(today2);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const briefing = await prisma.executiveBriefing.upsert({
    where: { id: 'briefing_p5_seed_0001' },
    update: {},
    create: {
      id: 'briefing_p5_seed_0001',
      briefingType: 'DAILY_MORNING',
      status: 'READY',
      periodStart: yesterday,
      periodEnd: today2,
      targetRoleKey: null,
      targetBranchId: null,
      headline: 'Portfolio performance within targets; Kano branch requires urgent attention',
      promptVersion: 'v1',
      modelUsed: 'mock',
      promptTokens: 1842,
      completionTokens: 687,
      bodyMd: `# Damez MFB — Daily Morning Brief
**Date:** ${today2.toISOString().slice(0, 10)} | **Prepared:** 07:00 WAT

---

## Portfolio Health — Key Deltas (vs. yesterday)

| Metric | Today | Yesterday | Δ |
|--------|-------|-----------|---|
| Active Loans | 118 | 116 | ▲ +2 |
| PAR30 Ratio | 9.4% | 9.1% | ▲ +0.3pp |
| Collection Efficiency | 81.2% | 82.0% | ▼ −0.8pp |
| Yield (bps) | 2,420 | 2,415 | ▲ +5bps |
| Disbursements (today) | ₦18.4M (12 loans) | ₦22.1M (15 loans) | ▼ −17% |

Portfolio performance remains within management targets. The slight PAR30 uptick is driven primarily by Kano branch and should be reviewed as part of the ongoing collections intervention.

---

## Risk Alerts

**🔴 CRITICAL — Kano Branch PAR30 at 19%** *(3.2σ above baseline)*
The Kano Nassarawa GRA branch PAR30 ratio reached 19% yesterday, well above the portfolio average of 9.4% and the 3σ alert threshold. The deterioration has been ongoing for 2 weeks. The immediate risk: two large borrowers (combined outstanding ₦8.2M) missed their instalments for the second consecutive month. The branch currently has only 2 collections agents (down from 4), and no field visits have been conducted in 14 days.

**Action required:** The Regional Collections Manager should be briefed today and a collections sprint initiated for Kano. Consider temporary reallocation of 1–2 agents from Kaduna.

---

## Approvals Queue

You have **3 items** awaiting your decision:

1. **LOAN_LIMIT_OVERRIDE** — Emeka Nwosu requesting ₦5M limit for Customer C-0042 (Salary Advance). Submitted 18 hours ago. Scorecard: 641. Recommendation: Approve with standard covenants.
2. **PRODUCT_RATE_CHANGE** — Treasury proposes reducing Salary Advance rate by 50bps effective next month. Supporting analysis attached. Estimated revenue impact: −₦1.2M/month.
3. **WRITE_OFF** — Collections requesting write-off of 2 accounts totalling ₦890,000. Both >180 DPD with no PTP in 90 days. Recovery probability assessed at <5%.

---

## Recommended Actions

1. **Today:** Approve or defer Kano collections intervention plan (escalated from Risk team).
2. **Today:** Review 3 pending approvals listed above.
3. **This week:** Debrief with Head of Collections on Kano branch deterioration and corrective action plan.
4. **Monitor:** Port Harcourt PAR30 trending up to 11.2% — approaching warning threshold.

---
*Brief generated by Damez Supervisory Intelligence v1. Data as of 06:45 WAT. Verify critical figures before external use.*`,
      metricsSnapshot: {
        portfolio: {
          activeLoansCount: 118,
          par30Ratio: 0.094,
          par90Ratio: 0.038,
          nplRatio: 0.032,
          collectionEfficiency: 0.812,
          disbursementsToday: { count: 12, amountKobo: 1_840_000_000 },
          yieldBps: 2420,
        },
        topAnomalyIds: ['anomaly_p5_seed_0001', 'anomaly_p5_seed_0005'],
        pendingApprovals: 3,
        branches: {
          worstPar30: { branchCode: 'KAN-NAS', par30Ratio: 0.19 },
          bestPar30: { branchCode: 'ABJ-WUS', par30Ratio: 0.042 },
        },
      },
      anomalyIds: ['anomaly_p5_seed_0001', 'anomaly_p5_seed_0005'],
    },
  });
  console.log('[seed-p5] Created ExecutiveBriefing:', briefing.id);

  // ── 9. ExecChatSession and Messages ─────────────────────────────────────
  console.log('[seed-p5] Generating ExecChatSession and messages...');

  // Look up the CEO user id
  const ceoUser = await prisma.staffUser.findFirst({ where: { email: 'ceo@damez.ng' } });
  const ceoId = ceoUser?.id ?? 'staff_ceo_placeholder';

  const session = await prisma.execChatSession.upsert({
    where: { id: 'chat_session_p5_seed_0001' },
    update: {},
    create: {
      id: 'chat_session_p5_seed_0001',
      userId: ceoId,
      title: 'Kano Branch Review — Collections Drop',
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
  });

  const chatMessages = [
    {
      id: 'chat_msg_p5_seed_0001',
      sessionId: session.id,
      briefingId: briefing.id,
      role: 'user',
      content: 'Why did collections drop in Kano this week?',
      promptTokens: 0,
      completionTokens: 0,
    },
    {
      id: 'chat_msg_p5_seed_0002',
      sessionId: session.id,
      briefingId: briefing.id,
      role: 'assistant',
      content: `Collections efficiency in the Kano Nassarawa GRA branch dropped from 78% (last week) to 71% (this week) — a 7 percentage point decline that places the branch 2.1σ below its own 90-day average.

Three contributing factors stand out from the data:

**1. Agent capacity reduction.** The branch had 4 collections agents two weeks ago; it now has 2 following a transfer to Lagos HQ. Fewer agents means fewer call attempts: daily calls per case dropped from 2.4 to 1.1.

**2. No field visits in 14 days.** Field visits have a 3× higher PTP conversion rate than phone calls for this branch's customer profile. The PTP kept rate has fallen from 65% to 48% in the same window.

**3. Two anchor accounts in arrears.** Customer C-0871 (₦4.9M outstanding) and C-0334 (₦3.3M outstanding) both missed their instalments for the second consecutive month. These two accounts alone account for 5.7pp of the branch's PAR30 increase.

**Recommended immediate actions:**
- Reassign 1–2 agents from Kaduna branch to Kano on a 2-week rotation
- Schedule field visits for C-0871 and C-0334 this week
- Escalate C-0334 to legal notice stage given second consecutive miss`,
      promptTokens: 312,
      completionTokens: 248,
    },
    {
      id: 'chat_msg_p5_seed_0003',
      sessionId: session.id,
      briefingId: null,
      role: 'user',
      content: 'What needs my approval today?',
      promptTokens: 0,
      completionTokens: 0,
    },
    {
      id: 'chat_msg_p5_seed_0004',
      sessionId: session.id,
      briefingId: null,
      role: 'assistant',
      content: `You have **3 items** pending your approval as of 07:00 WAT today:

---

**1. Loan Limit Override — ₦5,000,000** *(18 hours pending)*
**Maker:** Emeka Nwosu (Credit Analyst)
**Customer:** C-0042 | Occupation: Senior Civil Servant | KYC Tier 3
**Request:** Override standard limit from ₦3M to ₦5M for a 12-month Salary Advance.
**Scorecard:** 641 | Bureau: CRC score 658 — "Good" band
**Recommendation:** Approve. Debt-service ratio at 32% post-disbursement (within the 40% policy cap). Customer has 2 prior loans with Damez, both repaid on time.

---

**2. Product Rate Change — Salary Advance −50bps** *(2 days pending)*
**Maker:** Tunde Afolabi (Finance & Treasury)
**Change:** Monthly rate 2.25% → 2.20%, effective next month
**Estimated revenue impact:** −₦1.2M/month at current portfolio volume
**Justification:** Competitive response to First Bank's new payroll product launched last week.
**Recommendation:** Requires risk committee sign-off before approval. Defer to next committee session.

---

**3. Write-Off — 2 accounts, ₦890,000 total** *(5 days pending)*
**Maker:** Ibrahim Lawal (Collections Manager)
**Accounts:** C-1122 (₦510,000, 198 DPD) and C-0887 (₦380,000, 204 DPD)
**Recovery probability:** <5% per collections model
**Legal status:** Both served legal notice; no response in 60 days.
**Recommendation:** Approve write-off. Provision already raised; write-off is accounting formalisation only.`,
      promptTokens: 389,
      completionTokens: 341,
    },
  ];

  for (const msg of chatMessages) {
    await prisma.execChatMessage.upsert({
      where: { id: msg.id },
      update: {},
      create: msg,
    });
  }
  console.log(`[seed-p5] Created ExecChatSession with ${chatMessages.length} messages`);

  // ── 10. ExecPreference for CEO ───────────────────────────────────────────
  await prisma.execPreference.upsert({
    where: { userId: ceoId },
    update: {},
    create: {
      id: 'exec_pref_p5_ceo',
      userId: ceoId,
      briefingTime: '07:00',
      channels: ['IN_APP', 'EMAIL'],
      verbosity: 'standard',
      timezone: 'Africa/Lagos',
      updatedAt: new Date(),
    },
  });
  console.log('[seed-p5] Created ExecPreference for CEO');

  // ── 11. VintageCurve — 6 cohorts x 6 months ─────────────────────────────
  console.log('[seed-p5] Generating VintageCurve data...');
  const vintageRows = [];
  for (let cohortOffset = 5; cohortOffset >= 0; cohortOffset--) {
    const cohortDate = new Date();
    cohortDate.setUTCDate(1);
    cohortDate.setUTCHours(0, 0, 0, 0);
    cohortDate.setUTCMonth(cohortDate.getUTCMonth() - cohortOffset - 1);

    const maxMob = 6 - cohortOffset;
    const cohortDisbursed = BigInt(betweenInt(80_000_000_00, 180_000_000_00)); // ₦80M–₦180M
    const loanCount = betweenInt(40, 80);

    for (let mob = 1; mob <= maxMob; mob++) {
      const decayFactor = Math.pow(0.85, mob); // outstanding decays as loans repay
      const parFactor = Math.min(mob * 0.008, 0.06); // PAR grows with seasoning then plateaus
      const outstandingKobo = BigInt(Math.floor(Number(cohortDisbursed) * decayFactor));
      const par30Kobo = BigInt(Math.floor(Number(outstandingKobo) * parFactor));
      const par90Kobo = BigInt(Math.floor(Number(par30Kobo) * 0.4));
      const lossKobo = mob >= 4 ? BigInt(Math.floor(Number(par90Kobo) * 0.5)) : 0n;

      vintageRows.push({
        id: cuid(`vc_c${cohortOffset}m`, mob),
        cohortMonth: cohortDate,
        monthOnBook: mob,
        disbursedKobo: cohortDisbursed,
        outstandingKobo,
        par30Kobo,
        par90Kobo,
        lossKobo,
        loanCount,
      });
    }
  }

  await prisma.vintageCurve.createMany({ data: vintageRows, skipDuplicates: true });
  console.log(`[seed-p5] Created ${vintageRows.length} VintageCurve rows`);

  // ── 12. ApprovalsQueueSnapshot — today ──────────────────────────────────
  console.log('[seed-p5] Generating ApprovalsQueueSnapshot...');
  const queueSnaps = [
    {
      id: 'aqsnap_p5_001',
      snapshotDate: daysAgo(0),
      actionType: 'LOAN_LIMIT_OVERRIDE',
      pendingCount: 1,
      escalatedCount: 0,
      avgAgeHours: 18.3,
      oldest: daysAgo(1),
      pendingAmountKobo: 500_000_000n,
    },
    {
      id: 'aqsnap_p5_002',
      snapshotDate: daysAgo(0),
      actionType: 'PRODUCT_RATE_CHANGE',
      pendingCount: 1,
      escalatedCount: 0,
      avgAgeHours: 48.1,
      oldest: daysAgo(2),
      pendingAmountKobo: 0n,
    },
    {
      id: 'aqsnap_p5_003',
      snapshotDate: daysAgo(0),
      actionType: 'WRITE_OFF',
      pendingCount: 1,
      escalatedCount: 0,
      avgAgeHours: 120.5,
      oldest: daysAgo(5),
      pendingAmountKobo: 89_000_000n,
    },
  ];

  await prisma.approvalsQueueSnapshot.createMany({ data: queueSnaps, skipDuplicates: true });
  console.log(`[seed-p5] Created ${queueSnaps.length} ApprovalsQueueSnapshot rows`);

  console.log('[seed-p5] Phase 5 seed complete.');
}

main()
  .catch((e) => {
    console.error('[seed-p5] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
