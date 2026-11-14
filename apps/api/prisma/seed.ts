/* Seed: permissions, roles, branches, staff users, templates, settings, products, and realistic Nigerian demo data.
 * Idempotent: re-running adds NEW permission keys to default roles but never clobbers matrix edits made in the UI. */
import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import {
  ALL_PERMISSIONS, APPROVAL_ACTION_TYPES, APPROVAL_TYPE_META, ROLE_SEEDS, NIGERIAN_BANKS, maskPhone,
} from '@damez/shared';
import { loadEnv } from '../src/config/env';
import { FieldCipher } from '../src/crypto/field-cipher';
import { appendAudit, AuditEntryInput } from '../src/audit/audit-chain';

const env = loadEnv();
const prisma = new PrismaClient();
const cipher = new FieldCipher(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY, env.BLIND_INDEX_KEY);
const DEMO_PASSWORD = 'Damez@Demo2026';

// deterministic PRNG so demo data is stable
let seed = 20260101;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
const digits = (n: number) => Array.from({ length: n }, () => between(0, 9)).join('');
const daysAgo = (d: number, h = 12) => { const x = new Date(); x.setUTCDate(x.getUTCDate() - d); x.setUTCHours(h, between(0, 59), between(0, 59), 0); return x; };

const BRANCHES = [
  { code: 'LOS-HQ', name: 'Head Office, Abuja', state: 'Abuja', city: 'Abuja', address: 'Kubwa', isHeadOffice: true },
  { code: 'LOS-IKJ', name: 'Kubwa Branch', state: 'Abuja', city: 'Abuja', address: 'Kubwa' },
  { code: 'ABJ-WUS', name: 'Kwara Branch', state: 'Kwara', city: 'Kwara', address: 'Kwara' },
  { code: 'PHC-GRA', name: 'Suleja Branch', state: 'Suleja', city: 'Suleja', address: 'Suleja, Niger state' }
];

const STAFF = [
  { email: 'admin@damez.ng', name: 'Ngozi Eze', role: 'super_admin', branch: 'ABJ-HQ', phone: '08031230001' },
  { email: 'ceo@damez.ng', name: 'Olumide Balogun', role: 'ceo', branch: 'ABJ-HQ', phone: '08031230002' },
  { email: 'risk.manager@damez.ng', name: 'Hauwa Danjuma', role: 'credit_risk_manager', branch: 'ABJ-HQ', phone: '08031230003' },
  { email: 'analyst@damez.ng', name: 'Emeka Nwosu', role: 'credit_analyst', branch: 'ABJ-HQ', phone: '08031230004' },
  { email: 'officer@damez.ng', name: 'Folake Adeyemi', role: 'loan_officer', branch: 'ABJ-HQ', phone: '08031230005' },
  { email: 'collections.manager@damez.ng', name: 'Ibrahim Lawal', role: 'collections_manager', branch: 'ABJ-HQ', phone: '08031230006' },
  { email: 'agent@damez.ng', name: 'Chioma Okonkwo', role: 'collections_agent', branch: 'ABJ-HQ', phone: '08031230007' },
  { email: 'treasury@damez.ng', name: 'Tunde Afolabi', role: 'finance_treasury', branch: 'ABJ-HQ', phone: '08031230008' },
  { email: 'compliance@damez.ng', name: 'Zainab Yusuf', role: 'compliance_audit', branch: 'ABJ-HQ', phone: '08031230009' },
  { email: 'support@damez.ng', name: 'Kelechi Onyeama', role: 'customer_support', branch: 'ABJ-HQ', phone: '08031230010' },
  { email: 'officer.abuja@damez.ng', name: 'Musa Abdullahi', role: 'loan_officer', branch: 'ABJ-WUS', phone: '08031230011' },
  { email: 'officer.ph@damez.ng', name: 'Obinna Chukwu', role: 'loan_officer', branch: 'ABJ-HQ', phone: '08031230012' },
  { email: 'analyst2@damez.ng', name: 'Yetunde Ogunleye', role: 'credit_analyst', branch: 'ABJ-HQ', phone: '08031230013' },
  { email: 'agent.abuja@damez.ng', name: 'Aisha Bello', role: 'collections_agent', branch: 'ABJ-HQ', phone: '08031230014' },
  { email: 'support.ibadan@damez.ng', name: 'Damilola Adebayo', role: 'customer_support', branch: 'ABJ-HQ', phone: '08031230015' },
];

const TEMPLATES: Array<{ key: string; channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'; name: string; subject?: string; body: string; variables: string[] }> = [
  { key: 'staff_welcome', channel: 'EMAIL', name: 'Staff welcome', subject: 'Welcome to Damez Loan', body: 'Hello {{name}}, your staff account is ready. Sign in at {{url}} and set up two-factor authentication.', variables: ['name', 'url'] },
  { key: 'account_locked', channel: 'EMAIL', name: 'Account locked', subject: 'Your account was locked', body: 'Hello {{name}}, your account was locked after repeated failed sign-ins. Contact your administrator.', variables: ['name'] },
  { key: 'otp', channel: 'SMS', name: 'One-time code', body: 'Your Damez verification code is {{code}}. It expires in 5 minutes. Never share it.', variables: ['code'] },
  { key: 'repayment_reminder', channel: 'SMS', name: 'Repayment reminder', body: 'Hi {{name}}, your repayment of {{amount}} is due on {{dueDate}}. Fund your account to avoid penalties. Damez.', variables: ['name', 'amount', 'dueDate'] },
  { key: 'repayment_reminder', channel: 'WHATSAPP', name: 'Repayment reminder (WhatsApp)', body: 'Hello {{name}} 👋 Your Damez repayment of {{amount}} is due on {{dueDate}}.', variables: ['name', 'amount', 'dueDate'] },
  { key: 'loan_offer', channel: 'EMAIL', name: 'Loan offer', subject: 'Your loan offer of {{amount}}', body: 'Hello {{name}}, you have been offered {{amount}} at {{rate}} per month for {{tenor}} months. Review and accept in the app.', variables: ['name', 'amount', 'rate', 'tenor'] },
  { key: 'approval_requested', channel: 'IN_APP', name: 'Approval requested', subject: 'Approval requested', body: '{{maker}} requested: {{summary}}', variables: ['maker', 'summary'] },
  { key: 'approval_decided', channel: 'IN_APP', name: 'Approval decided', subject: 'Request {{decision}}', body: 'Your request "{{summary}}" was {{decision}}.', variables: ['summary', 'decision'] },
];

const SETTINGS: Array<[string, unknown, string]> = [
  ['general.company_name', 'Damez Microfinance Bank', 'Legal name shown in the console and customer messages'],
  ['general.timezone', 'Africa/Lagos', 'Display timezone (storage is always UTC)'],
  ['security.session_idle_minutes', 30, 'Idle timeout (informational; enforced from SESSION_IDLE_SECONDS)'],
  ['security.max_failed_logins', 5, 'Failed attempts before lockout (informational)'],
  ['security.lockout_minutes', 15, 'Lockout duration (informational)'],
  ['fees.schedule', { processingFeeBps: 100, insuranceFeeBps: 50, managementFeeBps: 100, latePenaltyBpsPerDay: 25, earlyRepaymentFeeBps: 0 }, 'Fee schedule in basis points (placeholder for prompt 2)'],
  ['scorecards.default', { name: 'Salaried Applicant Scorecard v1', cutoff: 600, factors: [{ name: 'Income stability', weight: 30 }, { name: 'Bureau score', weight: 30 }, { name: 'Employer category', weight: 20 }, { name: 'Repayment history', weight: 20 }] }, 'Default scorecard (placeholder for prompt 2)'],
  ['llm.enabled', false, 'Enable LLM features (placeholder, prompt 4)'],
  ['llm.provider', 'mock', 'LLM provider (placeholder, prompt 4)'],
  ['llm.allow_pii', false, 'Allow PII in LLM prompts. Must stay false; the gateway redacts regardless'],
  ['pii.mask_by_default', true, 'Mask personal data in every screen by default'],
  ['pii.reveal_requires_reason', true, 'Require a reason (audited) to reveal masked PII'],
  ['kyc.tier_loan_caps', { '1': 10_000_000, '2': 100_000_000, '3': 1_000_000_000 }, 'Max loan per KYC tier, in kobo (T1 ₦100k, T2 ₦1M, T3 ₦10M)'],
  ['kyc.retain_biometrics', false, 'Keep raw selfie images after face KYC. Default false: only the result, confidence and reference are stored'],
  ['kyc.face_match_pass', 80, 'Face match confidence (%) at or above which KYC passes'],
  ['kyc.face_match_review', 60, 'Face match confidence (%) at or above which KYC goes to manual review (below = fail)'],
  ['bureau.cache_ttl_days', 30, 'Reuse a bureau report younger than this many days instead of paying for a new pull'],
  ['bureau.pre_disbursement_max_age_days', 14, 'Refresh the bureau report before disbursement if older than this'],
  ['bureau.enabled_bureaus', ['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY'], 'Bureaus queried by the aggregator'],
  ['bureau.costs_kobo', { CRC: 15000, FIRSTCENTRAL: 12000, CREDITREGISTRY: 10000 }, 'Cost per billable pull per bureau, in kobo'],
  ['bureau.retry', { maxAttempts: 3, baseDelayMs: 200 }, 'Retry with exponential backoff per bureau'],
  ['bureau.monthly_budget_kobo', 50_000_000, 'Monthly bureau spend budget in kobo (dashboard alert)'],
  ['bureau.monitoring_enabled', true, 'Monthly portfolio monitoring pulls for active borrowers'],
  ['bureau.furnishing_enabled', true, 'Monthly data furnishing of our repayment performance to the bureaus'],
  ['application.auto_decline_enabled', true, 'Auto-decline applications that trip DECLINE policy rules'],
  ['fraud.velocity', { registrationsPerDevice24h: 3, applicationsPerCustomer24h: 3, registrationsPerIp1h: 5 }, 'Velocity-check thresholds'],
  ['screening.enabled', true, 'Run sanctions / PEP screening during onboarding'],
];

const PRODUCTS = [
  { code: 'SAL-ADV', name: 'Salary Advance', min: 20_000, max: 300_000, bps: 400, tmin: 1, tmax: 3 },
  { code: 'PERS', name: 'Personal Loan', min: 50_000, max: 2_000_000, bps: 450, tmin: 3, tmax: 12 },
  { code: 'CIVIL-GSI', name: 'Civil Servant Loan (GSI)', min: 100_000, max: 5_000_000, bps: 350, tmin: 6, tmax: 24 },
  { code: 'SME-WC', name: 'SME Working Capital', min: 200_000, max: 10_000_000, bps: 500, tmin: 3, tmax: 18 },
  { code: 'DEVICE', name: 'Device Financing', min: 60_000, max: 800_000, bps: 500, tmin: 3, tmax: 9 },
];

const FIRST = ['Chinedu', 'Adaeze', 'Oluwaseun', 'Folasade', 'Ibrahim', 'Aisha', 'Emeka', 'Ngozi', 'Tunde', 'Bukola', 'Musa', 'Fatima', 'Chioma', 'Segun', 'Yetunde', 'Obinna', 'Amaka', 'Abubakar', 'Zainab', 'Kelechi', 'Ifeoma', 'Damilola', 'Tobi', 'Hauwa', 'Uche', 'Sade', 'Nnamdi', 'Halima', 'Kunle', 'Temitope'];
const LAST = ['Okafor', 'Adeyemi', 'Bello', 'Eze', 'Balogun', 'Ibrahim', 'Nwosu', 'Ogunleye', 'Danjuma', 'Okonkwo', 'Abubakar', 'Afolabi', 'Chukwu', 'Yusuf', 'Adebayo', 'Onyeama', 'Lawal', 'Mohammed', 'Olawale', 'Nwachukwu', 'Ajayi', 'Suleiman', 'Ekwueme', 'Salami', 'Obi'];
const EMPLOYERS = [
  { n: 'Lagos State Government', day: 25, lo: 120, hi: 450 }, { n: 'Federal Civil Service', day: 28, lo: 90, hi: 380 },
  { n: 'MTN Nigeria', day: 25, lo: 250, hi: 900 }, { n: 'Access Bank', day: 25, lo: 300, hi: 1100 }, { n: 'Dangote Group', day: 28, lo: 180, hi: 700 },
  { n: 'NNPC Limited', day: 27, lo: 350, hi: 1200 }, { n: 'SUBEB (Teacher)', day: 30, lo: 70, hi: 160 }, { n: 'Nigeria Police Force', day: 28, lo: 85, hi: 220 },
  { n: 'Zenith Bank', day: 25, lo: 300, hi: 1000 }, { n: 'Self-employed trader', day: 0, lo: 80, hi: 500 },
];
const STATE_BY_BRANCH: Record<string, string[]> = { 'LOS-HQ': ['Lagos'], 'LOS-IKJ': ['Lagos', 'Ogun'], 'ABJ-WUS': ['FCT', 'Nasarawa'], 'PHC-GRA': ['Rivers', 'Bayelsa'], 'IBD-BDJ': ['Oyo', 'Osun'], 'ENU-IND': ['Enugu', 'Anambra'], 'KAN-NAS': ['Kano', 'Katsina'], 'KAD-BAR': ['Kaduna', 'Niger'] };

async function main() {
  console.log('Seeding…');
  const argonHash = await hash(DEMO_PASSWORD, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  // permissions (+ detect newly added keys)
  const existingPerms = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const newKeys: string[] = [];
  for (const group of (await import('@damez/shared')).PERMISSION_GROUPS) {
    for (const p of group.permissions) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, module: group.module, description: p.description }, update: { module: group.module, description: p.description } });
      if (!existingPerms.has(p.key)) newKeys.push(p.key);
    }
  }
  void ALL_PERMISSIONS;
  const permByKey = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  // roles
  for (const r of ROLE_SEEDS) {
    const existing = await prisma.role.findUnique({ where: { key: r.key } });
    const role = existing ?? (await prisma.role.create({ data: { key: r.key, name: r.name, description: r.description, isSystem: true, branchScoped: r.branchScoped } }));
    const grant = existing ? r.permissions.filter((k) => newKeys.includes(k)) : r.permissions;
    if (grant.length) await prisma.rolePermission.createMany({ data: [...new Set(grant)].map((k) => ({ roleId: role.id, permissionId: permByKey.get(k)! })), skipDuplicates: true });
    if (!existing) {
      for (const t of APPROVAL_ACTION_TYPES) {
        if (t in r.approvalLimits) await prisma.roleApprovalLimit.create({ data: { roleId: role.id, actionType: t, maxAmountKobo: r.approvalLimits[t] === null ? null : BigInt(r.approvalLimits[t] as number) } });
      }
    }
  }
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.key, r]));

  for (const t of APPROVAL_ACTION_TYPES) {
    await prisma.approvalPolicy.upsert({ where: { type: t }, create: { type: t, thresholdKobo: BigInt(APPROVAL_TYPE_META[t].defaultThresholdKobo), enabled: true }, update: {} });
  }

  for (const b of BRANCHES) await prisma.branch.upsert({ where: { code: b.code }, create: b, update: {} });
  const branches = new Map((await prisma.branch.findMany()).map((b) => [b.code, b]));

  // staff
  const demoSecret = cipher.encrypt;
  void demoSecret;
  for (const s of STAFF) {
    if (await prisma.staffUser.findUnique({ where: { email: s.email } })) continue;
    const u = await prisma.staffUser.create({ data: { email: s.email, fullName: s.name, phone: s.phone, passwordHash: argonHash, roleId: roles.get(s.role)!.id, branchId: branches.get(s.branch)!.id } });
    await prisma.staffUser.update({ where: { id: u.id }, data: { totpEnabled: true, totpSecretEnc: cipher.encrypt(env.DEMO_TOTP_SECRET, `totp:${u.id}`) } });
  }
  for (const x of [
    { email: 'former.officer@damez.ng', name: 'Segun Olawale', disabled: true }, { email: 'locked.officer@damez.ng', name: 'Amaka Nwachukwu', disabled: false },
  ]) {
    if (await prisma.staffUser.findUnique({ where: { email: x.email } })) continue;
    const u = await prisma.staffUser.create({ data: { email: x.email, fullName: x.name, passwordHash: argonHash, roleId: roles.get('loan_officer')!.id, branchId: branches.get('LOS-IKJ')!.id, status: x.disabled ? 'DISABLED' : 'ACTIVE', lockedUntil: x.disabled ? null : new Date('2999-01-01') } });
    await prisma.staffUser.update({ where: { id: u.id }, data: { totpEnabled: true, totpSecretEnc: cipher.encrypt(env.DEMO_TOTP_SECRET, `totp:${u.id}`) } });
  }
  const users = new Map((await prisma.staffUser.findMany({ include: { role: true } })).map((u) => [u.email, u]));

  for (const t of TEMPLATES) {
    await prisma.notificationTemplate.upsert({ where: { key_channel: { key: t.key, channel: t.channel } }, create: { ...t, subject: t.subject ?? null }, update: {} });
  }
  for (const [key, value, description] of SETTINGS) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, namespace: key.split('.')[0], value: value as Prisma.InputJsonValue, description }, update: {} });
  }
  for (const p of PRODUCTS) {
    await prisma.loanProduct.upsert({ where: { code: p.code }, create: { code: p.code, name: p.name, minAmountKobo: BigInt(p.min * 100), maxAmountKobo: BigInt(p.max * 100), monthlyRateBps: p.bps, minTenorMonths: p.tmin, maxTenorMonths: p.tmax }, update: {} });
  }
  const products = new Map((await prisma.loanProduct.findMany()).map((p) => [p.code, p]));

  // customers
  if ((await prisma.customer.count()) === 0) {
    const codes = [...branches.keys()];
    const weights = ['LOS-HQ', 'LOS-IKJ', 'LOS-IKJ', 'LOS-HQ', 'ABJ-WUS', 'ABJ-WUS', 'PHC-GRA', 'IBD-BDJ', 'ENU-IND', 'KAN-NAS', 'KAD-BAR'];
    void codes;
    for (let i = 0; i < 90; i++) {
      const bc = pick(weights);
      const emp = pick(EMPLOYERS);
      const first = pick(FIRST); const last = pick(LAST);
      const id = `cust_seed_${String(i + 1).padStart(3, '0')}`;
      const phone = `0${pick(['803', '806', '810', '813', '816', '903', '905', '701', '708'])}${digits(7)}`;
      const bvn = `22${digits(9)}`;
      const enc = {
        phoneEnc: cipher.encrypt(phone, `customer:${id}:phone`), phoneHash: cipher.blindIndex(phone, 'phone'),
        bvnEnc: cipher.encrypt(bvn, `customer:${id}:bvn`), bvnHash: cipher.blindIndex(bvn, 'bvn'),
        emailEnc: cipher.encrypt(`${first}.${last}${i}@example.ng`.toLowerCase(), `customer:${id}:email`), emailHash: cipher.blindIndex(`${first}.${last}${i}@example.ng`, 'email'),
      };
      const nin = digits(11); const acct = digits(10);
      await prisma.customer.create({
        data: {
          id, branchId: branches.get(bc)!.id, firstName: first, lastName: last, ...enc,
          ninEnc: cipher.encrypt(nin, `customer:${id}:nin`), ninHash: cipher.blindIndex(nin, 'nin'),
          accountNumberEnc: cipher.encrypt(acct, `customer:${id}:accountNumber`), accountNumberHash: cipher.blindIndex(acct, 'account'), bankCode: pick(NIGERIAN_BANKS).code,
          state: pick(STATE_BY_BRANCH[bc]), employer: emp.n, monthlyIncomeKobo: BigInt(between(emp.lo, emp.hi) * 1000 * 100), salaryDay: emp.day || null,
          kycStatus: pick(['VERIFIED', 'VERIFIED', 'VERIFIED', 'PENDING', 'REJECTED']),
          retentionUntil: new Date(Date.now() + 6 * 365 * 86400_000), createdAt: daysAgo(between(1, 170)),
        },
      });
    }
    const someCust = await prisma.customer.findMany({ take: 12 });
    for (const c of someCust) {
      await prisma.consent.create({ data: { subjectId: c.id, purpose: 'DATA_PROCESSING', textVersion: 'privacy-2026-01', channel: 'WEB', grantedAt: daysAgo(between(5, 90)) } });
      await prisma.consent.create({ data: { subjectId: c.id, purpose: 'BUREAU_PULL', textVersion: 'bureau-2026-01', channel: 'WEB', grantedAt: daysAgo(between(5, 90)), expiresAt: new Date(Date.now() + 180 * 86400_000) } });
    }
    await prisma.dataSubjectRequest.create({ data: { customerId: someCust[0].id, type: 'ACCESS', details: 'Customer requested a copy of data held.', dueAt: new Date(Date.now() + 20 * 86400_000) } });
  }

  // demo analytics
  if ((await prisma.portfolioSnapshot.count()) === 0) {
    let outstanding = 1_650_000_000_00; // ₦1.65B in kobo
    const rows: Prisma.PortfolioSnapshotCreateManyInput[] = [];
    for (let d = 179; d >= 0; d--) {
      const date = daysAgo(d, 0); date.setUTCHours(0, 0, 0, 0);
      const dow = date.getUTCDay(); const dom = date.getUTCDate();
      const payday = dom >= 25 || dom <= 3 ? 1.6 : 1; const weekend = dow === 0 || dow === 6 ? 0.35 : 1;
      const disbursed = Math.round(between(9_000_000, 22_000_000) * 100 * payday * weekend);
      const due = Math.round(outstanding * 0.011 * payday * (weekend < 1 ? 0.5 : 1));
      const eff = Math.min(0.99, (0.84 + (179 - d) * 0.0003 + (payday > 1 ? 0.06 : 0)) * (0.97 + rnd() * 0.06));
      const collected = Math.round(due * eff);
      outstanding = Math.round(outstanding + disbursed - collected * 0.82);
      const drift = Math.sin(d / 18) * 40;
      const apps = Math.round(between(90, 210) * weekend * (payday > 1 ? 1.3 : 1));
      rows.push({
        date, disbursedKobo: BigInt(disbursed), collectedKobo: BigInt(collected), dueKobo: BigInt(due), outstandingKobo: BigInt(outstanding),
        par1Bps: Math.round(1050 + drift * 2 + rnd() * 40), par30Bps: Math.round(610 + drift + rnd() * 25), par90Bps: Math.round(290 + drift / 2 + rnd() * 12),
        activeBorrowers: 18000 + (179 - d) * 20 + between(0, 40), applications: apps, approvedCount: Math.round(apps * (0.42 + rnd() * 0.08)),
      });
    }
    await prisma.portfolioSnapshot.createMany({ data: rows });
    const m = (n: number) => n * 100;
    const sets: Record<string, unknown> = {
      funnel: [{ stage: 'Applications started', count: 21400 }, { stage: 'Identity verified', count: 14300 }, { stage: 'Credit checked', count: 12100 }, { stage: 'Eligible', count: 8400 }, { stage: 'Offer accepted', count: 5900 }, { stage: 'Loan paid out', count: 5520 }],
      heatmap: {
        rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], cols: ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'],
        values: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((_, r) => [4, 2, 12, 58, 74, 66, 61, 28].map((v) => Math.round(v * (r >= 5 ? 0.55 : 1) * (r === 4 ? 1.2 : 1) * (0.85 + rnd() * 0.3)))),
      },
      cohorts: Array.from({ length: 8 }, (_, i) => {
        const age = 7 - i; const names = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
        return { label: `${names[i]} 2026`, size: between(1100, 2100), retention: Array.from({ length: age + 1 }, (_, k) => Math.round((100 - k * (3.2 + rnd() * 1.4)) * 10) / 10) };
      }),
      productMix: [{ product: 'Salary Advance', amountKobo: m(412_000_000) }, { product: 'Personal Loan', amountKobo: m(688_000_000) }, { product: 'Civil Servant (GSI)', amountKobo: m(521_000_000) }, { product: 'SME Working Capital', amountKobo: m(342_000_000) }, { product: 'Device Financing', amountKobo: m(96_000_000) }],
      stateDistribution: [['Lagos', 6200, 940], ['FCT', 2100, 310], ['Ogun', 1450, 190], ['Oyo', 1150, 150], ['Rivers', 1100, 165], ['Kano', 900, 120], ['Kaduna', 760, 95], ['Enugu', 640, 88], ['Delta', 580, 70], ['Edo', 520, 64]].map(([state, borrowers, mm]) => ({ state, borrowers, amountKobo: m((mm as number) * 1_000_000) })),
    };
    for (const [key, json] of Object.entries(sets)) await prisma.demoDataset.upsert({ where: { key }, create: { key, json: json as Prisma.InputJsonValue }, update: { json: json as Prisma.InputJsonValue } });
  }

  // approvals, audit, notifications, login events (demo history)
  if ((await prisma.approvalRequest.count()) === 0) {
    const U = (e: string) => users.get(e)!;
    const events: Array<{ at: Date; entry: AuditEntryInput }> = [];
    const actorOf = (e: string) => ({ actorId: U(e).id, actorName: U(e).fullName, actorEmail: e, actorRole: U(e).role.name, branchId: U(e).branchId, ip: `102.89.${between(1, 250)}.${between(1, 250)}`, userAgent: 'Mozilla/5.0 (Macintosh) Chrome/126' });
    const ev = (at: Date, e: string, entry: AuditEntryInput) => events.push({ at, entry: { ...actorOf(e), ...entry, createdAt: at } });

    for (const s of STAFF) ev(daysAgo(14, 9), 'admin@damez.ng', { action: 'user.created', resourceType: 'StaffUser', resourceId: U(s.email).id, after: { email: s.email, role: s.role } });
    ev(daysAgo(13, 10), 'admin@damez.ng', { action: 'role.permissions_changed', resourceType: 'Role', resourceId: roles.get('credit_analyst')!.id, before: { permissions: ['loan:approve'] }, after: { permissions: ['loan:approve', 'bureau:read'] }, metadata: { added: ['bureau:read'], removed: [] } });
    ev(daysAgo(12, 11), 'admin@damez.ng', { action: 'branch.created', resourceType: 'Branch', resourceId: branches.get('KAD-BAR')!.id, after: { code: 'KAD-BAR' } });
    for (let i = 0; i < 24; i++) { const e = pick(STAFF).email; ev(daysAgo(between(0, 9), between(6, 18)), e, { action: 'auth.login', resourceType: 'Session', metadata: { device: 'Chrome on macOS' } }); }
    for (let i = 0; i < 4; i++) ev(daysAgo(between(0, 3), between(6, 18)), 'compliance@damez.ng', { action: 'audit.export', resourceType: 'AuditLog', metadata: { filters: {} } });
    ev(daysAgo(2, 10), 'officer@damez.ng', { action: 'pii.revealed', resourceType: 'Customer', resourceId: 'cust_seed_001', metadata: { field: 'phone', reason: 'Customer asked for a call back' } });
    ev(daysAgo(1, 15), 'support@damez.ng', { action: 'access.denied', resourceType: 'Route', resourceId: 'GET /api/v1/audit', outcome: 'DENIED', metadata: { required: ['audit:read'] } });

    const mk = async (data: { type: string; status: Prisma.ApprovalRequestCreateInput['status']; summary: string; maker: string; amount?: number; payload: Prisma.InputJsonValue; at: Date; reason?: string; esc?: number; decidedAt?: Date; result?: Prisma.InputJsonValue }) =>
      prisma.approvalRequest.create({ data: { type: data.type, status: data.status, summary: data.summary, reason: data.reason ?? null, amountKobo: data.amount ? BigInt(data.amount * 100) : null, payload: data.payload, makerId: U(data.maker).id, branchId: U(data.maker).branchId, escalationLevel: data.esc ?? 0, decidedAt: data.decidedAt ?? null, executionResult: data.result, createdAt: data.at, updatedAt: data.at } });
    const step = (requestId: string, e: string, decision: 'APPROVED' | 'REJECTED' | 'ESCALATED', at: Date, comment: string, limit: number | null | 'n/a') =>
      prisma.approvalStep.create({ data: { requestId, approverId: U(e).id, approverRole: U(e).role.name, decision, comment, createdAt: at, approverLimitKobo: typeof limit === 'number' ? BigInt(limit * 100) : null, approverUnlimited: limit === null } });

    const a1 = await mk({ type: 'WAIVER', status: 'PENDING', summary: 'Waive ₦150,000 penalty on loan LN-2026-004412 (customer hardship)', maker: 'officer@damez.ng', amount: 150_000, payload: { loanRef: 'LN-2026-004412', waiverType: 'PENALTY' }, at: daysAgo(0, 8), reason: 'Customer hospitalised; salary delayed 3 weeks' });
    ev(a1.createdAt, 'officer@damez.ng', { action: 'approval.submitted', resourceType: 'ApprovalRequest', resourceId: a1.id, after: { type: 'WAIVER', amountKobo: 15_000_000 } });
    const a2 = await mk({ type: 'WRITE_OFF', status: 'PENDING', summary: 'Write off ₦420,000 on loan LN-2025-001873 (deceased borrower)', maker: 'collections.manager@damez.ng', amount: 420_000, payload: { loanRef: 'LN-2025-001873' }, at: daysAgo(1, 14) });
    ev(a2.createdAt, 'collections.manager@damez.ng', { action: 'approval.submitted', resourceType: 'ApprovalRequest', resourceId: a2.id, after: { type: 'WRITE_OFF', amountKobo: 42_000_000 } });
    const a3 = await mk({ type: 'LOAN_APPROVAL', status: 'ESCALATED', summary: 'Approve ₦3,500,000 Personal Loan for Abuja customer (cust_seed_014)', maker: 'officer.abuja@damez.ng', amount: 3_500_000, payload: { customerId: 'cust_seed_014', productCode: 'PERS', tenorMonths: 12 }, at: daysAgo(2, 11), esc: 1 });
    await step(a3.id, 'analyst@damez.ng', 'ESCALATED', daysAgo(2, 13), 'Within policy; above my limit, escalating', 500_000);
    ev(a3.createdAt, 'officer.abuja@damez.ng', { action: 'approval.submitted', resourceType: 'ApprovalRequest', resourceId: a3.id, after: { type: 'LOAN_APPROVAL', amountKobo: 350_000_000 } });
    ev(daysAgo(2, 13), 'analyst@damez.ng', { action: 'approval.escalated', resourceType: 'ApprovalRequest', resourceId: a3.id, after: { status: 'ESCALATED' } });
    const pers = products.get('PERS')!;
    const a4 = await mk({ type: 'PRODUCT_RATE_CHANGE', status: 'PENDING', summary: 'Reduce Personal Loan rate from 4.50% to 4.25% per month', maker: 'risk.manager@damez.ng', payload: { productId: pers.id, productName: pers.name, currentMonthlyRateBps: pers.monthlyRateBps, newMonthlyRateBps: 425 }, at: daysAgo(0, 9), reason: 'Competitive pressure from digital lenders' });
    ev(a4.createdAt, 'risk.manager@damez.ng', { action: 'approval.submitted', resourceType: 'ApprovalRequest', resourceId: a4.id, after: { type: 'PRODUCT_RATE_CHANGE' } });
    const a5 = await mk({ type: 'MANUAL_DISBURSEMENT', status: 'EXECUTED', summary: 'Manual disbursement ₦1,200,000 (NIP outage) to cust_seed_021', maker: 'officer@damez.ng', amount: 1_200_000, payload: { customerId: 'cust_seed_021' }, at: daysAgo(6, 10), decidedAt: daysAgo(6, 12), result: { note: 'Approved and recorded.' } });
    await step(a5.id, 'treasury@damez.ng', 'APPROVED', daysAgo(6, 12), 'Funds confirmed', 2_000_000);
    ev(a5.createdAt, 'officer@damez.ng', { action: 'approval.submitted', resourceType: 'ApprovalRequest', resourceId: a5.id, after: { type: 'MANUAL_DISBURSEMENT' } });
    ev(daysAgo(6, 12), 'treasury@damez.ng', { action: 'approval.executed', resourceType: 'ApprovalRequest', resourceId: a5.id, after: { status: 'EXECUTED' } });
    const a6 = await mk({ type: 'RESTRUCTURE', status: 'REJECTED', summary: 'Restructure ₦900,000 loan from 6 to 18 months', maker: 'collections.manager@damez.ng', amount: 900_000, payload: { loanRef: 'LN-2025-002201' }, at: daysAgo(8, 9), decidedAt: daysAgo(8, 15) });
    await step(a6.id, 'ceo@damez.ng', 'REJECTED', daysAgo(8, 15), 'Insufficient evidence of hardship', null);
    ev(daysAgo(8, 15), 'ceo@damez.ng', { action: 'approval.rejected', resourceType: 'ApprovalRequest', resourceId: a6.id, after: { status: 'REJECTED' } });
    const a7 = await mk({ type: 'WAIVER', status: 'CANCELLED', summary: 'Waive ₦30,000 late fee', maker: 'agent@damez.ng', amount: 30_000, payload: {}, at: daysAgo(5, 9), decidedAt: daysAgo(5, 10) });
    ev(daysAgo(5, 10), 'agent@damez.ng', { action: 'approval.cancelled', resourceType: 'ApprovalRequest', resourceId: a7.id, after: { status: 'CANCELLED' } });

    // chronological, serialised chain
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const { entry } of events) await appendAudit(prisma, entry);

    // in-app notifications
    for (const [e, t, b, h] of [
      ['ceo@damez.ng', 'New approval request', 'Ibrahim Lawal requested: Write off ₦420,000 on loan LN-2025-001873', `/approvals?open=${a2.id}`],
      ['ceo@damez.ng', 'Approval escalated', 'Approve ₦3,500,000 Personal Loan needs a higher approval authority', `/approvals?open=${a3.id}`],
      ['ceo@damez.ng', 'New approval request', 'Hauwa Danjuma requested: Reduce Personal Loan rate', `/approvals?open=${a4.id}`],
      ['risk.manager@damez.ng', 'Approval escalated', 'Approve ₦3,500,000 Personal Loan needs a higher approval authority', `/approvals?open=${a3.id}`],
      ['risk.manager@damez.ng', 'New approval request', 'Folake Adeyemi requested: Waive ₦150,000 penalty', `/approvals?open=${a1.id}`],
      ['collections.manager@damez.ng', 'New approval request', 'Folake Adeyemi requested: Waive ₦150,000 penalty', `/approvals?open=${a1.id}`],
      ['admin@damez.ng', 'Welcome', 'Your Super Admin account is ready. Review roles and the permission matrix.', '/roles'],
    ] as const) await prisma.inAppNotification.create({ data: { userId: U(e).id, title: t, body: b, href: h, createdAt: daysAgo(0, between(5, 9)) } });

    // delivery history (masked recipients only)
    for (let i = 0; i < 40; i++) {
      const ch = pick(['SMS', 'SMS', 'SMS', 'EMAIL', 'WHATSAPP'] as const);
      const failed = rnd() < 0.08;
      const ph = `0${pick(['803', '806', '810', '813', '903'])}${digits(7)}`;
      const at = daysAgo(between(0, 6), between(6, 20));
      await prisma.notificationDelivery.create({
        data: {
          channel: ch, provider: 'mock', recipientMasked: ch === 'EMAIL' ? 'c•••@example.ng' : maskPhone(ph), recipientHash: cipher.blindIndex(ph, 'notify'),
          templateKey: ch === 'EMAIL' ? 'loan_offer' : 'repayment_reminder', bodyRedacted: ch === 'EMAIL' ? 'Hello [NAME], you have been offered a loan.' : 'Hi [NAME], your repayment is due.',
          status: failed ? 'FAILED' : rnd() < 0.7 ? 'DELIVERED' : 'SENT', error: failed ? 'MockProvider: simulated delivery failure' : null, attempts: failed ? 3 : 1, createdAt: at, sentAt: failed ? null : at, providerMessageId: failed ? null : `mock_${i}`,
        },
      });
    }
    // login events (incl. some failures in last 24h for the dashboard)
    for (let i = 0; i < 60; i++) {
      const e = pick(STAFF).email; const bad = rnd() < 0.12;
      await prisma.loginEvent.create({ data: { userId: U(e).id, email: e, ip: `102.89.${between(1, 250)}.${between(1, 250)}`, userAgent: 'Mozilla/5.0 (Macintosh) Chrome/126', outcome: bad ? 'BAD_PASSWORD' : 'SUCCESS', createdAt: daysAgo(between(0, 7), between(0, 23)) } });
    }
  }

  console.log('Seed complete. Demo logins: <email> / %s  (TOTP secret %s; or GET /auth/demo-totp when DEMO_MODE=true)', DEMO_PASSWORD, env.DEMO_TOTP_SECRET);
  void authenticator;
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
