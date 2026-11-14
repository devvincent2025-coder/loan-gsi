import { get, post } from './api';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type BriefingType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type BriefingStatus = 'GENERATING' | 'READY' | 'FAILED';
export type SeverityLevel = 'INFO' | 'WARNING' | 'CRITICAL';

export interface ExecutiveBriefing {
  id: string;
  type: BriefingType;
  status: BriefingStatus;
  headline: string;
  content: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
}

export interface PortfolioMetricPoint {
  date: string;
  par30: number;
  par90: number;
  nplRatio: number;
  collectionEfficiency: number;
  disbursedKobo: number;
}

export interface PortfolioMetrics {
  current: {
    par30: number;
    par90: number;
    nplRatio: number;
    collectionEfficiency: number;
    disbursed30dKobo: number;
    eclTotalKobo: number;
    par30Delta?: number;
    par90Delta?: number;
    nplDelta?: number;
    efficiencyDelta?: number;
    disbursedDelta?: number;
    eclDelta?: number;
    disbursementTarget30dKobo?: number;
  };
  series: PortfolioMetricPoint[];
}

export interface BranchMetric {
  branchId: string;
  branchName: string;
  par30: number;
  par90: number;
  disbursedKobo: number;
  collectionEfficiency: number;
  activeLoanCount: number;
}

export interface ExecAnomaly {
  id: string;
  severity: SeverityLevel;
  category: string;
  title: string;
  description: string;
  detectedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  createdAt: string;
  pinned?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
}

export interface ChatResponse {
  sessionId: string;
  message: ChatMessage;
}

/* ------------------------------------------------------------------ */
/* API Functions                                                        */
/* ------------------------------------------------------------------ */

/** GET /executive/briefings */
export const listBriefings = () =>
  get<{ items: ExecutiveBriefing[]; total: number; page: number; pageSize: number }>('/executive/briefings').then((r) => r.items);

/** POST /executive/briefings/generate */
export const generateBriefing = (type: BriefingType = 'DAILY') =>
  post<ExecutiveBriefing>('/executive/briefings/generate', { type });

/** GET /executive/metrics/portfolio?periodDays=N */
export const getPortfolioMetrics = (periodDays = 30) =>
  get<PortfolioMetrics>('/executive/metrics/portfolio', { periodDays });

/** GET /executive/metrics/branches */
export const getBranchMetrics = () => get<BranchMetric[]>('/executive/metrics/branches');

/** GET /executive/anomalies */
export const listAnomalies = () =>
  get<{ items: ExecAnomaly[]; total: number; page: number; pageSize: number }>('/executive/anomalies').then((r) => r.items);

/** POST /executive/anomalies/:id/acknowledge */
export const acknowledgeAnomaly = (id: string) =>
  post<ExecAnomaly>(`/executive/anomalies/${id}/acknowledge`, {});

/** POST /executive/chat */
export const sendChatMessage = (sessionId: string | null, message: string) =>
  post<ChatResponse>('/executive/chat', { sessionId, message });

/** GET /executive/chat/sessions */
export const listChatSessions = () => get<ChatSession[]>('/executive/chat/sessions');

/** GET /approvals?status=PENDING,ESCALATED */
export const getPendingApprovalsForExec = () =>
  get<{ items: Array<{ id: string; type: string; status: string; amountKobo?: number; createdAt: string; description?: string; makerName?: string }> }>(
    '/approvals',
    { status: 'PENDING,ESCALATED', pageSize: '20' },
  );
