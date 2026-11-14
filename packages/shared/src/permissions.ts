/**
 * Permission catalog. Keys are `resource:action`.
 * Every module on the roadmap is pre-seeded here so later prompts only *use* keys.
 * Adding a key here + running `npm run db:seed` makes it appear in the matrix UI.
 */
export interface PermissionDef {
  key: string;
  description: string;
}
export interface PermissionGroup {
  module: string;
  label: string;
  permissions: PermissionDef[];
}

const p = (key: string, description: string): PermissionDef => ({ key, description });

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    module: 'admin',
    label: 'Administration',
    permissions: [
      p('user:read', 'View staff users'),
      p('user:create', 'Create staff users'),
      p('user:update', 'Edit staff users'),
      p('user:deactivate', 'Deactivate / reactivate staff users'),
      p('user:unlock', 'Unlock locked accounts and reset 2FA'),
      p('user:role_change', 'Request a staff role change (maker)'),
      p('role:read', 'View roles'),
      p('role:update', 'Create and edit roles'),
      p('permission:read', 'View the permission catalog'),
      p('permission:matrix_edit', 'Edit the role-permission matrix and approval limits'),
      p('branch:read', 'View branches'),
      p('branch:manage', 'Create and edit branches'),
      p('audit:read', 'View the audit log'),
      p('audit:export', 'Export the audit log'),
      p('system:jobs', 'Open the job dashboard (Bull Board)'),
      p('system:health', 'View system health'),
      p('session:manage', 'View and revoke other staff sessions'),
    ],
  },
  {
    module: 'approvals',
    label: 'Maker-Checker',
    permissions: [
      p('approval:read', 'View approval requests'),
      p('approval:submit', 'Submit actions for approval (maker)'),
      p('approval:decide', 'Approve or reject requests (checker)'),
      p('approval:policy_manage', 'Edit approval thresholds'),
      p('role:change_approve', 'Approve staff role changes'),
      p('product:rate_approve', 'Approve product and rate changes'),
      p('waiver:approve', 'Approve fee / interest waivers'),
      p('writeoff:approve', 'Approve write-offs'),
      p('restructure:approve', 'Approve loan restructures'),
      p('disbursement:approve_manual', 'Approve manual disbursements'),
    ],
  },
  {
    module: 'settings',
    label: 'Settings',
    permissions: [
      p('settings:read', 'View settings'),
      p('settings:update', 'Edit settings'),
      p('product:read', 'View loan products'),
      p('product:update', 'Request product / rate changes'),
      p('scorecard:read', 'View scorecards'),
      p('scorecard:update', 'Edit scorecards'),
      p('scorecard:approve', 'Approve scorecard activation'),
      p('product:create', 'Create loan products'),
      p('product:delete', 'Delete loan products (super admin only)'),
      p('fee:read', 'View fee schedules'),
      p('fee:update', 'Edit fee schedules'),
      p('template:read', 'View notification templates'),
      p('template:update', 'Edit notification templates'),
      p('integration:read', 'View integration status'),
      p('integration:update', 'Edit integration settings'),
    ],
  },
  {
    module: 'notifications',
    label: 'Notifications',
    permissions: [
      p('notification:read', 'View delivery logs'),
      p('notification:send', 'Send test / manual notifications'),
    ],
  },
  {
    module: 'customers',
    label: 'Customers, KYC & Compliance',
    permissions: [
      p('customer:read', 'View customers'),
      p('customer:create', 'Create customers'),
      p('customer:update', 'Edit customers'),
      p('customer:delete', 'Erase customer records (super admin only)'),
      p('customer360:read', 'Open Customer 360'),
      p('kyc:read', 'View KYC results'),
      p('kyc:run', 'Run KYC checks'),
      p('kyc:override', 'Override a KYC result'),
      p('consent:read', 'View consent records'),
      p('consent:manage', 'Record and revoke consent'),
      p('dsr:read', 'View data subject requests'),
      p('dsr:manage', 'Process data subject requests'),
      p('pii:reveal', 'Reveal masked personal data (audited)'),
      p('pii:export', 'Export personal data'),
      p('document:read', 'View / download customer documents (audited)'),
      p('document:review', 'Approve or reject customer documents'),
      p('fraud:read', 'View fraud signals'),
      p('fraud:resolve', 'Resolve fraud signals'),
      p('screening:run', 'Run sanctions / PEP screening'),
    ],
  },
  {
    module: 'bureau',
    label: 'Credit Bureau',
    permissions: [
      p('bureau:pull', 'Pull a credit bureau report'),
      p('bureau:read', 'View credit bureau reports'),
      p('bureau:usage', 'View bureau usage, spend, pull log and distribution'),
      p('bureau:manage', 'Run bureau furnishing and monitoring jobs'),
    ],
  },
  {
    module: 'loans',
    label: 'Loans & Underwriting',
    permissions: [
      p('application:read', 'View loan applications'),
      p('application:create', 'Create loan applications'),
      p('application:update', 'Edit loan applications'),
      p('eligibility:run', 'Run the eligibility engine'),
      p('underwriting:read', 'View the underwriting console'),
      p('underwriting:decide', 'Record underwriting recommendations'),
      p('loan:read', 'View loans'),
      p('loan:create', 'Create loans'),
      p('loan:approve', 'Approve loans (subject to approval limits)'),
      p('loan:reject', 'Reject loans'),
      p('loan:disburse', 'Disburse approved loans'),
      p('loan:disburse_manual', 'Request manual disbursement'),
      p('loan:restructure', 'Request loan restructure'),
      p('loan:writeoff', 'Request loan write-off'),
      p('loan:waive', 'Request fee / interest waiver'),
      p('offer:read', 'View offers'),
      p('offer:create', 'Create offers'),
      p('ledger:read', 'View the ledger'),
      p('ledger:post', 'Post manual ledger entries'),
      p('linkedaccount:read', 'View linked accounts'),
      p('linkedaccount:manage', 'Manage linked accounts'),
      p('gsi:read', 'View GSI mandates'),
      p('gsi:manage', 'Manage GSI mandates'),
      p('autodebit:read', 'View autodebit schedules'),
      p('autodebit:manage', 'Manage autodebit schedules'),
      p('autodebit:trigger', 'Trigger an autodebit run'),
    ],
  },
  {
    module: 'collections',
    label: 'Collections & Recovery',
    permissions: [
      p('collections:read', 'View collections queues'),
      p('collections:assign', 'Assign accounts to agents'),
      p('collections:update', 'Log collection activity'),
      p('collections:escalate', 'Escalate Unpaid accounts'),
      p('collections:strategy_manage', 'Manage collection strategies'),
      p('collections:writeoff_recommend', 'Recommend write-offs'),
      p('behavioural:read', 'View behavioural analytics'),
    ],
  },
  {
    module: 'finance',
    label: 'Finance & Treasury',
    permissions: [
      p('treasury:read', 'View treasury positions'),
      p('treasury:manage', 'Manage treasury operations'),
      p('reconciliation:read', 'View reconciliation'),
      p('reconciliation:run', 'Run reconciliation'),
      p('payout:approve', 'Approve payouts'),
    ],
  },
  {
    module: 'intelligence',
    label: 'Analytics & Executive Intelligence',
    permissions: [
      p('dashboard:read', 'View the dashboard'),
      p('analytics:read', 'View analytics'),
      p('report:read', 'View reports'),
      p('report:export', 'Export reports'),
      p('executive:read', 'View supervisory intelligence'),
      p('executive:command_center', 'Open the executive command center'),
      p('executive:briefing:read', 'View executive briefings'),
      p('executive:briefing:generate', 'Trigger executive briefing generation'),
      p('executive:chat:use', 'Use the executive AI assistant chat'),
      p('executive:anomaly:read', 'View detected anomalies'),
      p('executive:anomaly:acknowledge', 'Acknowledge anomaly records'),
      p('executive:tool:portfolio', 'Access portfolio data tools in executive context'),
      p('executive:preference:manage', 'Manage personal executive preferences'),
      p('executive:boardpack:export', 'Export board pack / reporting package'),
      p('llm:use', 'Use LLM assistants (via LlmGateway)'),
      p('llm:settings', 'Edit LLM and PII settings'),
    ],
  },
];

export const ALL_PERMISSIONS: PermissionDef[] = PERMISSION_GROUPS.flatMap((g) => g.permissions);
export const ALL_PERMISSION_KEYS: string[] = ALL_PERMISSIONS.map((x) => x.key);

export function isPermissionKey(k: string): boolean {
  return ALL_PERMISSION_KEYS.includes(k);
}
