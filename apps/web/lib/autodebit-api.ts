import type { AutodebitDashboardDto } from '@damez/shared';
import { get, post } from './api';

/** GET /autodebit/dashboard */
export const getAutodebitDashboard = () => get<AutodebitDashboardDto>('/autodebit/dashboard');

export interface TriggerAutodebitBody {
  loanId?: string;
  installmentId?: string;
}

/** POST /autodebit/trigger — manual run. Response shape isn't load-bearing for the UI, so it's left loose. */
export const triggerAutodebit = (body: TriggerAutodebitBody = {}) => post<Record<string, unknown>>('/autodebit/trigger', body);
