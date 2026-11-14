import { Injectable } from '@nestjs/common';
import type { BureauName } from '@damez/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BUREAUS, BureauSettings } from './bureau.types';

export const DEFAULT_BUREAU_SETTINGS: BureauSettings = {
  cacheTtlDays: 30,
  preDisbursementMaxAgeDays: 14,
  // Interswitch's Credit History Lookup already sources from 2+ bureaus in one call, satisfying the CBN
  // "at least two bureaus" rule on its own. CRC/FirstCentral/CreditRegistry stay fully wired and can be
  // re-enabled from Settings if a direct relationship with one of them is ever needed again.
  enabledBureaus: ['INTERSWITCH'],
  costsKobo: { CRC: 15000, FIRSTCENTRAL: 12000, CREDITREGISTRY: 10000, INTERSWITCH: 20000 },
  retry: { maxAttempts: 3, baseDelayMs: 200 },
  monitoringEnabled: true,
  furnishingEnabled: true,
};

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

/** Reads the `bureau.*` system settings on every call (cheap, and edits in Settings apply immediately). */
@Injectable()
export class BureauSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(): Promise<BureauSettings> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: 'bureau.' } } });
    const m = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const d = DEFAULT_BUREAU_SETTINGS;
    const enabled = m.get('bureau.enabled_bureaus');
    const costs = (m.get('bureau.costs_kobo') ?? {}) as Partial<Record<BureauName, number>>;
    const retry = (m.get('bureau.retry') ?? {}) as { maxAttempts?: number; baseDelayMs?: number };
    const enabledBureaus = Array.isArray(enabled) ? BUREAUS.filter((b) => (enabled as unknown[]).includes(b)) : d.enabledBureaus;
    return {
      cacheTtlDays: num(m.get('bureau.cache_ttl_days'), d.cacheTtlDays),
      preDisbursementMaxAgeDays: num(m.get('bureau.pre_disbursement_max_age_days'), d.preDisbursementMaxAgeDays),
      enabledBureaus: enabledBureaus.length ? enabledBureaus : d.enabledBureaus,
      costsKobo: {
        CRC: num(costs.CRC, d.costsKobo.CRC), FIRSTCENTRAL: num(costs.FIRSTCENTRAL, d.costsKobo.FIRSTCENTRAL),
        CREDITREGISTRY: num(costs.CREDITREGISTRY, d.costsKobo.CREDITREGISTRY), INTERSWITCH: num(costs.INTERSWITCH, d.costsKobo.INTERSWITCH),
      },
      retry: { maxAttempts: Math.max(1, num(retry.maxAttempts, d.retry.maxAttempts)), baseDelayMs: num(retry.baseDelayMs, d.retry.baseDelayMs) },
      monitoringEnabled: m.get('bureau.monitoring_enabled') !== false,
      furnishingEnabled: m.get('bureau.furnishing_enabled') !== false,
    };
  }
}
