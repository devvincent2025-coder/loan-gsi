import type { BureauFacilityDto, ScoreBand } from '@damez/shared';

export const BAND_ORDER: ScoreBand[] = ['POOR', 'FAIR', 'GOOD', 'VERY_GOOD', 'EXCELLENT'];
export const BAND_LABEL: Record<ScoreBand, string> = { POOR: 'Poor', FAIR: 'Fair', GOOD: 'Good', VERY_GOOD: 'Very good', EXCELLENT: 'Excellent' };
/** red → green; fixed hues so the bands read the same in light and dark mode */
export const BAND_COLOR: Record<ScoreBand, string> = { POOR: '#dc2626', FAIR: '#f97316', GOOD: '#eab308', VERY_GOOD: '#65a30d', EXCELLENT: '#059669' };

/** Position of a score inside a bureau's own range, 0..1 */
export function scoreFraction(score: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (score - min) / (max - min)));
}
/** The five bands split each bureau range evenly. */
export function bandForScore(score: number, min: number, max: number): ScoreBand {
  const f = scoreFraction(score, min, max);
  return BAND_ORDER[Math.min(4, Math.floor(f * 5))]!;
}

export type DpdBucket = 'none' | 'current' | 'dpd1' | 'dpd30' | 'dpd60' | 'dpd90';
export interface DpdStyle { bucket: DpdBucket; label: string; className: string }
/** Repayment heatmap colouring: 0 green, 1-29 yellow, 30-59 orange, 60-89 deep orange, 90+ red, no data grey. */
export function dpdStyle(dpd: number | null | undefined): DpdStyle {
  if (dpd === null || dpd === undefined) return { bucket: 'none', label: 'No data', className: 'bg-muted' };
  if (dpd <= 0) return { bucket: 'current', label: 'Current (0 days)', className: 'bg-emerald-500' };
  if (dpd < 30) return { bucket: 'dpd1', label: '1-29 days', className: 'bg-yellow-400' };
  if (dpd < 60) return { bucket: 'dpd30', label: '30-59 days', className: 'bg-orange-400' };
  if (dpd < 90) return { bucket: 'dpd60', label: '60-89 days', className: 'bg-orange-600' };
  return { bucket: 'dpd90', label: '90+ days', className: 'bg-red-600' };
}
export const DPD_LEGEND: DpdStyle[] = [0, 1, 30, 60, 90].map((d) => dpdStyle(d)).concat(dpdStyle(null));

/** Defaults, write-offs, sold-to-collections and legal action are the rows a credit officer must not miss. */
export function isRedFacility(f: Pick<BureauFacilityDto, 'status' | 'soldToCollections' | 'legalAction'>): boolean {
  return f.status === 'DEFAULTED' || f.status === 'WRITTEN_OFF' || f.soldToCollections || f.legalAction;
}
export const RED_ROW_CLASS = 'bg-destructive/10 hover:bg-destructive/15 border-l-2 border-l-destructive';

export const BUREAU_LABEL: Record<string, string> = { CRC: 'CRC', FIRSTCENTRAL: 'FirstCentral', CREDITREGISTRY: 'CreditRegistry', INTERSWITCH: 'Interswitch', ALL: 'All bureaus' };
export const SOURCE_SHORT: Record<string, string> = { CRC: 'CRC', FIRSTCENTRAL: 'FC', CREDITREGISTRY: 'CR', INTERSWITCH: 'ISW' };
