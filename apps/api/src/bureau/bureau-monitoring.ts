import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { maskName } from '@damez/shared';
import type { BureauFacilityDto, BureauReportDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { ConsentService } from '../consent/consent.module';
import { LOAN_PORTFOLIO_PORT, LoanPortfolioPort } from '../contracts/ports';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { scrubError } from './bureau-aggregator';
import { facilityIdentity } from './bureau-merge';
import { BureauSettingsService } from './bureau-settings';
import { BureauService } from './bureau.service';

export type MonitoringAlertType = 'ELSEWHERE_DEFAULT' | 'NEW_DELINQUENCY' | 'SCORE_DROP' | 'FRAUD_WATCHLIST';
export interface MonitoringAlert { type: MonitoringAlertType; severity: 'LOW' | 'MEDIUM' | 'HIGH'; detail: string }
export const SCORE_DROP_THRESHOLD = 40;

const bad = (f: BureauFacilityDto) => f.isActive && !f.isGuarantor && (f.status === 'Unpaid' || f.status === 'DEFAULTED');
const idOf = (f: BureauFacilityDto) => facilityIdentity(f.lender, f.openedAt, f.amountGrantedKobo);

/**
 * Compare a fresh report with the previous one. With no previous report there is no baseline, so nothing is flagged
 * (the application-time pull already surfaced whatever existed then).
 */
export function detectChanges(prev: BureauReportDto | null, next: BureauReportDto): MonitoringAlert[] {
  if (!prev) return [];
  const alerts: MonitoringAlert[] = [];
  const p = prev.summary; const n = next.summary;
  if (n.fraudFlag && !p.fraudFlag) alerts.push({ type: 'FRAUD_WATCHLIST', severity: 'HIGH', detail: 'A credit bureau has newly flagged this customer for fraud / watchlist' });
  if (n.writeOffCount > p.writeOffCount) alerts.push({ type: 'ELSEWHERE_DEFAULT', severity: 'HIGH', detail: `New write-off recorded by another lender (${n.writeOffCount - p.writeOffCount} facility)` });
  if (n.elsewhereDefault && !p.elsewhereDefault) alerts.push({ type: 'ELSEWHERE_DEFAULT', severity: 'HIGH', detail: 'Now 30+ days past due on a facility with another lender' });
  const prevBad = new Set(prev.facilities.filter(bad).map(idOf));
  const newlyBad = next.facilities.filter((f) => bad(f) && !prevBad.has(idOf(f)));
  // a 30+ dpd default is already reported above; the rest are early-stage delinquencies
  const early = newlyBad.filter((f) => !(f.worstDpd >= 30 && n.elsewhereDefault && !p.elsewhereDefault));
  if (early.length) alerts.push({ type: 'NEW_DELINQUENCY', severity: 'MEDIUM', detail: `${early.length} facility${early.length > 1 ? 'ies are' : 'y is'} newly Unpaid at another lender` });
  if (p.averageScore != null && n.averageScore != null && p.averageScore - n.averageScore >= SCORE_DROP_THRESHOLD) {
    const drop = p.averageScore - n.averageScore;
    alerts.push({ type: 'SCORE_DROP', severity: drop >= 80 ? 'HIGH' : 'MEDIUM', detail: `Bureau score fell ${drop} points (${p.averageScore} to ${n.averageScore})` });
  }
  return alerts;
}

@Injectable()
export class BureauMonitoringService {
  private log = new Logger('BureauMonitoring');
  constructor(
    private prisma: PrismaService, private bureau: BureauService, private consent: ConsentService, private audit: AuditService,
    private notifications: NotificationsService, private settings: BureauSettingsService,
    @Optional() @Inject(LOAN_PORTFOLIO_PORT) private portfolio?: LoanPortfolioPort,
  ) {}

  /** `scheduled` runs respect bureau.monitoring_enabled; a manual run by a manager always executes. */
  async run(opts: { scheduled?: boolean; requestedById?: string | null } = {}): Promise<{ checked: number; alerts: number }> {
    if (opts.scheduled && !(await this.settings.get()).monitoringEnabled) return { checked: 0, alerts: 0 };
    if (!this.portfolio) { this.log.warn('LOAN_PORTFOLIO_PORT not available; nothing to monitor'); return { checked: 0, alerts: 0 }; }
    const ids = await this.portfolio.listActiveBorrowerIds();
    let checked = 0; let alerts = 0;
    for (const customerId of ids) {
      try {
        // no consent: skip silently (a BLOCKED row per borrower per month would only be noise)
        if (!(await this.consent.hasValidConsent(customerId, 'BUREAU_PULL'))) continue;
        const prev = await this.bureau.latestReport(customerId);
        const next = await this.bureau.ensureReport(customerId, { reason: 'MONITORING', force: true, requestedById: opts.requestedById ?? null });
        checked++;
        alerts += await this.raise(customerId, detectChanges(prev, next), next.id);
      } catch (e) {
        this.log.warn(`monitoring failed for a customer: ${scrubError(e)}`);
      }
    }
    await this.audit.record({ action: 'bureau.monitoring_run', resourceType: 'BureauMonitoring', metadata: { checked, alerts, candidates: ids.length, scheduled: !!opts.scheduled } });
    return { checked, alerts };
  }

  private async raise(customerId: string, found: MonitoringAlert[], reportId: string): Promise<number> {
    if (!found.length) return 0;
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { firstName: true, lastName: true } });
    const recipients = await this.prisma.staffUser.findMany({ where: { status: 'ACTIVE', role: { permissions: { some: { permission: { key: 'collections:read' } } } } }, select: { id: true } });
    let raised = 0;
    for (const a of found) {
      const dup = await this.prisma.customerRiskFlag.findFirst({ where: { customerId, type: a.type, source: 'BUREAU_MONITORING', active: true, detail: a.detail } });
      if (dup) continue;
      await this.prisma.customerRiskFlag.create({ data: { customerId, type: a.type, source: 'BUREAU_MONITORING', severity: a.severity, detail: a.detail } });
      await this.audit.record({ action: 'bureau.monitoring_alert', resourceType: 'Customer', resourceId: customerId, metadata: { type: a.type, severity: a.severity, detail: a.detail, reportId } });
      await this.notifications.notifyUsers(recipients.map((r) => r.id), `Credit bureau alert: ${a.type.replace(/_/g, ' ').toLowerCase()}`, `${maskName(customer ? `${customer.firstName} ${customer.lastName}` : 'Customer')}: ${a.detail}`, `/customers/${customerId}`);
      raised++;
    }
    return raised;
  }
}
