import { ALL_PERMISSION_KEYS } from './permissions';
import type { ApprovalActionType } from './approvals';

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  /** true => user is restricted to their own branch unless `allBranches` is set on the user */
  branchScoped: boolean;
  permissions: string[];
  /** maxAmountKobo per approval action type. Missing = cannot approve; null = unlimited. */
  approvalLimits: Partial<Record<ApprovalActionType, number | null>>;
}

const N = (naira: number) => naira * 100;

const readBasics = ['dashboard:read', 'approval:read', 'branch:read', 'customer:read', 'notification:read'];

export const ROLE_SEEDS: RoleSeed[] = [
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Full system administration. Cannot be restricted via the matrix.',
    branchScoped: false,
    permissions: ALL_PERMISSION_KEYS,
    approvalLimits: {
      ROLE_CHANGE: null,
      PRODUCT_RATE_CHANGE: null,
      LOAN_APPROVAL: null,
      WRITE_OFF: null,
      RESTRUCTURE: null,
      MANUAL_DISBURSEMENT: null,
      WAIVER: null,
    },
  },
  {
    key: 'ceo',
    name: 'CEO / Executive',
    description: 'Executive oversight, final approval authority and supervisory intelligence.',
    branchScoped: false,
    permissions: [
      ...readBasics,
      'user:read', 'role:read', 'permission:read', 'audit:read', 'system:health',
      'approval:decide', 'approval:submit', 'role:change_approve', 'product:rate_approve',
      'waiver:approve', 'writeoff:approve', 'restructure:approve', 'disbursement:approve_manual',
      'loan:read', 'loan:approve', 'loan:reject', 'application:read', 'underwriting:read',
      'offer:read', 'ledger:read', 'collections:read', 'behavioural:read', 'customer360:read',
      'treasury:read', 'reconciliation:read', 'analytics:read', 'report:read', 'report:export',
      'executive:read', 'executive:command_center', 'llm:use', 'product:read', 'settings:read',
      'scorecard:read', 'fee:read', 'consent:read', 'dsr:read', 'bureau:read', 'kyc:read',
    ],
    approvalLimits: {
      ROLE_CHANGE: null,
      PRODUCT_RATE_CHANGE: null,
      LOAN_APPROVAL: null,
      WRITE_OFF: null,
      RESTRUCTURE: null,
      MANUAL_DISBURSEMENT: null,
      WAIVER: null,
    },
  },
  {
    key: 'credit_risk_manager',
    name: 'Credit Risk Manager',
    description: 'Owns credit policy, scorecards and high-value credit decisions.',
    branchScoped: false,
    permissions: [
      ...readBasics,
      'approval:submit', 'approval:decide', 'product:rate_approve', 'waiver:approve',
      'restructure:approve', 'writeoff:approve',
      'application:read', 'eligibility:run', 'underwriting:read', 'underwriting:decide',
      'loan:read', 'loan:approve', 'loan:reject', 'loan:restructure', 'loan:writeoff', 'loan:waive',
      'offer:read', 'bureau:pull', 'bureau:read', 'kyc:read', 'consent:read',
      'scorecard:read', 'scorecard:update', 'product:read', 'product:update', 'fee:read',
      'analytics:read', 'report:read', 'report:export', 'behavioural:read', 'customer360:read',
      'collections:read', 'collections:writeoff_recommend', 'ledger:read', 'audit:read',
      'settings:read', 'llm:use',
    ],
    approvalLimits: {
      LOAN_APPROVAL: N(5_000_000),
      WAIVER: N(500_000),
      RESTRUCTURE: N(5_000_000),
      WRITE_OFF: N(1_000_000),
      PRODUCT_RATE_CHANGE: null,
    },
  },
  {
    key: 'credit_analyst',
    name: 'Credit Analyst',
    description: 'Underwrites applications and approves within a limit.',
    branchScoped: false,
    permissions: [
      ...readBasics,
      'approval:submit', 'approval:decide',
      'application:read', 'application:update', 'eligibility:run', 'underwriting:read',
      'underwriting:decide', 'loan:read', 'loan:approve', 'loan:reject', 'offer:read', 'offer:create',
      'bureau:pull', 'bureau:read', 'kyc:read', 'kyc:run', 'consent:read', 'customer360:read',
      'loan:restructure', 'loan:waive',
    ],
    approvalLimits: { LOAN_APPROVAL: N(500_000), WAIVER: N(50_000) },
  },
  {
    key: 'loan_officer',
    name: 'Loan Officer',
    description: 'Originates loans at a branch and serves customers.',
    branchScoped: true,
    permissions: [
      ...readBasics,
      'approval:submit',
      'customer:create', 'customer:update', 'kyc:read', 'kyc:run', 'consent:read', 'consent:manage',
      'application:read', 'application:create', 'application:update', 'eligibility:run',
      'loan:read', 'loan:create', 'offer:read', 'loan:disburse_manual', 'loan:waive',
      'linkedaccount:read', 'linkedaccount:manage', 'customer360:read', 'pii:reveal',
    ],
    approvalLimits: {},
  },
  {
    key: 'collections_manager',
    name: 'Collections Manager',
    description: 'Leads recovery; assigns portfolios and recommends write-offs.',
    branchScoped: false,
    permissions: [
      ...readBasics,
      'approval:submit', 'approval:decide', 'waiver:approve', 'restructure:approve',
      'collections:read', 'collections:assign', 'collections:update', 'collections:escalate',
      'collections:strategy_manage', 'collections:writeoff_recommend', 'behavioural:read',
      'loan:read', 'loan:restructure', 'loan:writeoff', 'loan:waive', 'customer360:read',
      'autodebit:read', 'autodebit:trigger', 'gsi:read', 'user:read', 'report:read', 'analytics:read',
      'pii:reveal',
    ],
    approvalLimits: { WAIVER: N(250_000), RESTRUCTURE: N(2_000_000) },
  },
  {
    key: 'collections_agent',
    name: 'Collections Agent',
    description: 'Works assigned Unpaid accounts.',
    branchScoped: true,
    permissions: [
      'dashboard:read', 'approval:read', 'approval:submit', 'customer:read', 'collections:read',
      'collections:update', 'collections:escalate', 'loan:read', 'loan:waive', 'customer360:read',
      'autodebit:read',
    ],
    approvalLimits: {},
  },
  {
    key: 'finance_treasury',
    name: 'Finance / Treasury',
    description: 'Disbursement funding, ledger and reconciliation.',
    branchScoped: false,
    permissions: [
      ...readBasics,
      'approval:submit', 'approval:decide', 'disbursement:approve_manual', 'payout:approve',
      'loan:read', 'loan:disburse', 'ledger:read', 'ledger:post', 'treasury:read', 'treasury:manage',
      'reconciliation:read', 'reconciliation:run', 'report:read', 'report:export', 'fee:read',
      'fee:update', 'autodebit:read', 'analytics:read',
    ],
    approvalLimits: { MANUAL_DISBURSEMENT: N(2_000_000) },
  },
  {
    key: 'compliance_audit',
    name: 'Compliance / Audit',
    description: 'Read-only oversight of every area, including the audit log.',
    branchScoped: false,
    permissions: [
      ...readBasics,
      'user:read', 'role:read', 'permission:read', 'audit:read', 'audit:export', 'system:health',
      'application:read', 'underwriting:read', 'loan:read', 'offer:read', 'ledger:read',
      'collections:read', 'bureau:read', 'kyc:read', 'consent:read', 'dsr:read', 'dsr:manage',
      'customer360:read', 'settings:read', 'product:read', 'scorecard:read', 'fee:read',
      'template:read', 'integration:read', 'report:read', 'report:export', 'analytics:read',
      'treasury:read', 'reconciliation:read', 'linkedaccount:read', 'gsi:read', 'autodebit:read',
      'behavioural:read',
    ],
    approvalLimits: {},
  },
  {
    key: 'customer_support',
    name: 'Customer Support',
    description: 'Serves customers; masked data by default.',
    branchScoped: true,
    permissions: [
      'dashboard:read', 'approval:read', 'customer:read', 'customer:update', 'customer360:read',
      'loan:read', 'application:read', 'kyc:read', 'consent:read', 'dsr:read', 'notification:read',
      'notification:send',
    ],
    approvalLimits: {},
  },
];

export const SUPER_ADMIN_ROLE_KEY = 'super_admin';

/** Phase 2 permission defaults (additive). */
const P2_ADDITIONS: Record<string, string[]> = {
  ceo: ['scorecard:approve', 'bureau:usage', 'document:read', 'fraud:read', 'product:rate_approve'],
  credit_risk_manager: ['bureau:usage', 'bureau:manage', 'product:create', 'document:read', 'document:review', 'fraud:read', 'fraud:resolve', 'screening:run', 'eligibility:run'],
  credit_analyst: ['document:read', 'document:review', 'fraud:read', 'screening:run', 'scorecard:read', 'bureau:usage'],
  loan_officer: ['document:read', 'document:review', 'fraud:read', 'product:read'],
  compliance_audit: ['bureau:usage', 'document:read', 'fraud:read'],
  collections_manager: ['bureau:read'],
  customer_support: ['kyc:read'],
};
for (const r of ROLE_SEEDS) {
  const extra = P2_ADDITIONS[r.key];
  if (extra) r.permissions = [...new Set([...r.permissions, ...extra])];
}

/** Phase 4 permission defaults (additive). */
const P4_ADDITIONS: Record<string, string[]> = {
  ceo: ['llm:settings', 'collections:assign', 'collections:update', 'collections:escalate', 'collections:strategy_manage'],
  credit_risk_manager: ['llm:settings', 'collections:strategy_manage'],
  collections_manager: ['llm:use', 'llm:settings'],
  compliance_audit: ['llm:settings'],
};
for (const r of ROLE_SEEDS) {
  const extra = P4_ADDITIONS[r.key];
  if (extra) r.permissions = [...new Set([...r.permissions, ...extra])];
}

/** Phase 5 permission defaults (additive). */
const P5_ADDITIONS: Record<string, string[]> = {
  super_admin: [
    'executive:briefing:read', 'executive:briefing:generate', 'executive:chat:use',
    'executive:anomaly:read', 'executive:anomaly:acknowledge', 'executive:tool:portfolio',
    'executive:preference:manage', 'executive:boardpack:export',
  ],
  ceo: [
    'executive:briefing:read', 'executive:briefing:generate', 'executive:chat:use',
    'executive:anomaly:read', 'executive:anomaly:acknowledge', 'executive:tool:portfolio',
    'executive:preference:manage', 'executive:boardpack:export',
  ],
  credit_risk_manager: [
    'executive:briefing:read', 'executive:chat:use',
    'executive:anomaly:read', 'executive:tool:portfolio', 'executive:preference:manage',
  ],
};
for (const r of ROLE_SEEDS) {
  const extra = P5_ADDITIONS[r.key];
  if (extra) r.permissions = [...new Set([...r.permissions, ...extra])];
}

/** Phase 4 approval limits for new approval types. */
const P4_LIMITS: Record<string, Partial<Record<ApprovalActionType, number | null>>> = {
  ceo: { SETTLEMENT_OFFER: null, AGENCY_ASSIGNMENT: null },
  credit_risk_manager: { SETTLEMENT_OFFER: N(2_000_000), AGENCY_ASSIGNMENT: null },
  collections_manager: { SETTLEMENT_OFFER: N(500_000), AGENCY_ASSIGNMENT: null },
};
for (const r of ROLE_SEEDS) {
  const extra = P4_LIMITS[r.key];
  if (extra) r.approvalLimits = { ...r.approvalLimits, ...extra };
}
