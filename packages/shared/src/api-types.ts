/**
 * API CONTRACT: DTOs returned by apps/api, consumed by apps/web.
 * Base path: /api/v1 (web proxies /api/* to the API via Next rewrites, so cookies are same-origin).
 * Money fields are integer kobo as JSON numbers (suffix `Kobo`). Dates are ISO-8601 UTC strings.
 * Errors: { statusCode, message, code?, errors?: Record<string,string[]> }.
 * Auth: httpOnly cookie `sid`; mutating requests must send header `x-csrf-token` = value of cookie `csrf`.
 */
import type { ApprovalActionType, ApprovalStatus } from './approvals';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  code?: string;
  errors?: Record<string, string[]>;
}

/* ───────────── auth ───────────── */
export interface RoleRef { id: string; key: string; name: string }
export interface BranchRef { id: string; code: string; name: string }

export interface LoginResponse {
  status: 'TOTP_REQUIRED' | 'TOTP_ENROLL_REQUIRED';
  /** short-lived (5 min) signed token tying password step to the 2FA step */
  challengeToken: string;
}
export interface TotpEnrollResponse {
  secret: string;
  otpauthUrl: string;
  /** data:image/png;base64 QR code */
  qrDataUrl: string;
}
export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: RoleRef;
  branch: BranchRef | null;
  allBranches: boolean;
  permissions: string[];
  totpEnabled: boolean;
  lastLoginAt: string | null;
  sessionExpiresAt: string;
  idleTimeoutSeconds: number;
  unreadNotifications: number;
}
export interface TotpVerifyResponse { user: Me }
export interface SessionDto {
  id: string;
  ip: string | null;
  userAgent: string | null;
  device: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}
/** GET /auth/demo-totp?email= (only when DEMO_MODE=true and NODE_ENV != production) */
export interface DemoTotp { code: string; expiresInSeconds: number }

/* ───────────── users / roles / branches ───────────── */
export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  /** masked by default (080••••1234) */
  phone: string | null;
  role: RoleRef;
  branch: BranchRef | null;
  allBranches: boolean;
  status: UserStatus;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
}
export interface ApprovalLimitDto { actionType: ApprovalActionType; maxAmountKobo: number | null }
export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  branchScoped: boolean;
  userCount: number;
  permissions: string[];
  approvalLimits: ApprovalLimitDto[];
}
export interface BranchDto {
  id: string;
  code: string;
  name: string;
  state: string;
  city: string;
  address: string | null;
  isHeadOffice: boolean;
  isActive: boolean;
  userCount: number;
}
/** GET /permissions */
export interface PermissionCatalogDto {
  groups: { module: string; label: string; permissions: { key: string; description: string }[] }[];
}

/* ───────────── audit ───────────── */
export interface AuditLogDto {
  id: string;
  seq: number;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  branchId: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  metadata: unknown;
  hash: string;
}
export interface AuditVerifyResult { valid: boolean; checked: number; brokenAtSeq: number | null }
export interface AuditFilters { actions: string[]; resourceTypes: string[] }

/* ───────────── approvals (maker-checker) ───────────── */
export interface ApprovalStepDto {
  id: string;
  approver: { id: string; name: string; role: string };
  decision: 'APPROVED' | 'REJECTED' | 'ESCALATED';
  comment: string | null;
  createdAt: string;
}
export interface ApprovalDto {
  id: string;
  type: ApprovalActionType;
  typeLabel: string;
  status: ApprovalStatus;
  summary: string;
  reason: string | null;
  amountKobo: number | null;
  payload: Record<string, unknown>;
  maker: { id: string; name: string; role: string };
  branch: BranchRef | null;
  createdAt: string;
  decidedAt: string | null;
  /** number of escalations so far (0 = none) */
  escalationLevel: number;
  /** true when the current user may approve/reject this request right now */
  canDecide: boolean;
  /** why canDecide is false (shown as tooltip) */
  cannotDecideReason: string | null;
  steps: ApprovalStepDto[];
  executionResult: unknown;
}
export interface ApprovalTypeDto {
  type: ApprovalActionType;
  label: string;
  description: string;
  approvePermission: string;
  hasAmount: boolean;
  thresholdKobo: number;
  enabled: boolean;
}

/* ───────────── notifications ───────────── */
export type NotificationChannel = 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP';
export interface InAppNotificationDto {
  id: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface InboxDto { items: InAppNotificationDto[]; unread: number }
export interface DeliveryLogDto {
  id: string;
  channel: NotificationChannel;
  provider: string;
  /** masked */
  recipient: string;
  templateKey: string | null;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
  error: string | null;
  providerMessageId: string | null;
  createdAt: string;
  sentAt: string | null;
}
export interface TemplateDto {
  id: string;
  key: string;
  channel: NotificationChannel;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  isActive: boolean;
}

/* ───────────── settings ───────────── */
export interface SettingDto {
  key: string;
  namespace: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}
export interface LoanProductDto {
  id: string;
  code: string;
  name: string;
  minAmountKobo: number;
  maxAmountKobo: number;
  monthlyRateBps: number; // basis points per month, 450 = 4.50%
  minTenorMonths: number;
  maxTenorMonths: number;
  isActive: boolean;
}
export interface IntegrationDto {
  key: string;
  name: string;
  category: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'KYC' | 'BUREAU' | 'PAYMENTS' | 'LLM';
  mode: 'mock' | 'live';
  status: 'healthy' | 'unconfigured' | 'degraded';
  envVars: string[];
  note: string;
}

/* ───────────── search / pii / customers ───────────── */
export interface SearchResultDto {
  groups: {
    type: 'user' | 'branch' | 'customer' | 'approval';
    items: { id: string; title: string; subtitle: string; href: string }[];
  }[];
}
export interface CustomerDto {
  id: string;
  /** masked */
  fullName: string;
  phone: string; // masked
  email: string | null; // masked
  bvn: string; // masked
  state: string | null;
  branch: BranchRef | null;
  kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  createdAt: string;
}
export interface PiiRevealResponse { value: string; revealedAt: string }

/* ───────────── dashboard ───────────── */
export interface KpiDto {
  key: string;
  label: string;
  value: number; // kobo when format === 'naira'
  format: 'naira' | 'number' | 'percent';
  /** % change vs previous period */
  delta: number;
  /** true when an increase is bad (e.g. PAR30) */
  invertDelta?: boolean;
  sparkline: number[];
}
export interface DashboardSummary {
  kpis: KpiDto[];
  disbursementSeries: { date: string; disbursedKobo: number; collectedKobo: number }[];
  outstandingSeries: { date: string; outstandingKobo: number }[];
  parSeries: { date: string; par1: number; par30: number; par90: number }[];
  funnel: { stage: string; count: number }[];
  /** applications by weekday (rows) x hour bucket (cols) */
  heatmap: { rows: string[]; cols: string[]; values: number[][] };
  /** vintage: % of original principal still performing, by month on book */
  cohorts: { label: string; size: number; retention: number[] }[];
  productMix: { product: string; amountKobo: number }[];
  stateDistribution: { state: string; borrowers: number; amountKobo: number }[];
  operational: {
    pendingApprovals: number;
    auditEvents24h: number;
    activeSessions: number;
    failedLogins24h: number;
    queuesHealthy: boolean;
  };
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  checks: Record<string, { status: 'up' | 'down'; latencyMs?: number; error?: string }>;
  uptimeSeconds: number;
  version: string;
}

/** helper alias used by api-types-p2 */
export type ConsentStatusRef = 'GRANTED' | 'REVOKED' | 'EXPIRED';
