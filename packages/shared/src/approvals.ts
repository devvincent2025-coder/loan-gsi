export const APPROVAL_ACTION_TYPES = [
  'ROLE_CHANGE',
  'PRODUCT_RATE_CHANGE',
  'LOAN_APPROVAL',
  'WRITE_OFF',
  'RESTRUCTURE',
  'MANUAL_DISBURSEMENT',
  'WAIVER',
  'SCORECARD_ACTIVATION',
  'SETTLEMENT_OFFER',          // prompt 4: collections settlement / discount
  'AGENCY_ASSIGNMENT',         // prompt 4: hand case to third-party agency
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export const APPROVAL_STATUSES = [
  'PENDING',
  'ESCALATED',
  'EXECUTED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface ApprovalTypeMeta {
  type: ApprovalActionType;
  label: string;
  description: string;
  /** permission a checker needs to decide on this type */
  approvePermission: string;
  /** whether the request carries an amount, so limits and thresholds apply */
  hasAmount: boolean;
  /** default threshold in kobo; requests below it may skip approval (when `allowBelowThresholdBypass`) */
  defaultThresholdKobo: number;
}

export const APPROVAL_TYPE_META: Record<ApprovalActionType, ApprovalTypeMeta> = {
  ROLE_CHANGE: {
    type: 'ROLE_CHANGE',
    label: 'Staff role change',
    description: 'Change the role of a staff user.',
    approvePermission: 'role:change_approve',
    hasAmount: false,
    defaultThresholdKobo: 0,
  },
  PRODUCT_RATE_CHANGE: {
    type: 'PRODUCT_RATE_CHANGE',
    label: 'Product / rate change',
    description: 'Change the interest rate or limits of a loan product.',
    approvePermission: 'product:rate_approve',
    hasAmount: false,
    defaultThresholdKobo: 0,
  },
  LOAN_APPROVAL: {
    type: 'LOAN_APPROVAL',
    label: 'Loan approval',
    description: 'Approve a loan above the auto-approval threshold.',
    approvePermission: 'loan:approve',
    hasAmount: true,
    defaultThresholdKobo: 100_000_00,
  },
  WRITE_OFF: {
    type: 'WRITE_OFF',
    label: 'Write-off',
    description: 'Write off a Unpaid loan balance.',
    approvePermission: 'writeoff:approve',
    hasAmount: true,
    defaultThresholdKobo: 0,
  },
  RESTRUCTURE: {
    type: 'RESTRUCTURE',
    label: 'Loan restructure',
    description: 'Restructure tenor or instalments of an existing loan.',
    approvePermission: 'restructure:approve',
    hasAmount: true,
    defaultThresholdKobo: 0,
  },
  MANUAL_DISBURSEMENT: {
    type: 'MANUAL_DISBURSEMENT',
    label: 'Manual disbursement',
    description: 'Disburse a loan outside the automated rail.',
    approvePermission: 'disbursement:approve_manual',
    hasAmount: true,
    defaultThresholdKobo: 0,
  },
  WAIVER: {
    type: 'WAIVER',
    label: 'Fee / interest waiver',
    description: 'Waive fees, penalties or interest on a loan.',
    approvePermission: 'waiver:approve',
    hasAmount: true,
    defaultThresholdKobo: 0,
  },
  SCORECARD_ACTIVATION: {
    type: 'SCORECARD_ACTIVATION',
    label: 'Scorecard activation',
    description: 'Make a scorecard version the live credit decision scorecard.',
    approvePermission: 'scorecard:approve',
    hasAmount: false,
    defaultThresholdKobo: 0,
  },
  SETTLEMENT_OFFER: {
    type: 'SETTLEMENT_OFFER',
    label: 'Settlement offer',
    description: 'Approve a discounted settlement / waiver for a Unpaid borrower.',
    approvePermission: 'waiver:approve',
    hasAmount: true,
    defaultThresholdKobo: 0,
  },
  AGENCY_ASSIGNMENT: {
    type: 'AGENCY_ASSIGNMENT',
    label: 'Agency assignment',
    description: 'Hand a collection case to a third-party recovery agency.',
    approvePermission: 'collections:escalate',
    hasAmount: false,
    defaultThresholdKobo: 0,
  },
};
