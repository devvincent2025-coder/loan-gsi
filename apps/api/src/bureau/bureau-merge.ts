/**
 * Pure cross-bureau logic: score normalisation, facility de-duplication, conflict reconciliation and the
 * summary every credit decision reads. No I/O so it is unit-tested exhaustively and reused by seeds.
 */
import { createHash } from 'crypto';
import type { BureauName, FacilityStatus, ScoreBand } from '@damez/shared';
import {
  ACTIVE_STATUSES, BureauSummary, MergedEnquiry, MergedFacility, MergedFlag, MergedReport, MergedScore, NORM_MAX, NORM_MIN,
  PerBureauOutcome, RawBureauResult, RawFacility, STATUS_SEVERITY, ALL_BUREAUS,
} from './bureau.types';

/* ── dates ── */
export const monthKey = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
export const addMonths = (d: Date, n: number): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), 28)));
export const monthsBetween = (from: Date, to: Date): number => (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
export const daysBetween = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / 86_400_000);
export const dateOnly = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/* ── scores ── */
/** Map a bureau-native score onto the common 300-850 scale. */
export function normalizeScore(score: number, min: number, max: number): number {
  if (max <= min) return score;
  const f = Math.min(1, Math.max(0, (score - min) / (max - min)));
  return Math.round(NORM_MIN + f * (NORM_MAX - NORM_MIN));
}
/** Bands (on the normalised scale): Poor <500, Fair 500-579, Good 580-669, Very good 670-739, Excellent 740+. */
export const SCORE_BANDS: { band: ScoreBand; label: string; min: number; max: number }[] = [
  { band: 'POOR', label: 'Poor', min: NORM_MIN, max: 499 },
  { band: 'FAIR', label: 'Fair', min: 500, max: 579 },
  { band: 'GOOD', label: 'Good', min: 580, max: 669 },
  { band: 'VERY_GOOD', label: 'Very good', min: 670, max: 739 },
  { band: 'EXCELLENT', label: 'Excellent', min: 740, max: NORM_MAX },
];
export function bandFor(normalizedScore: number): ScoreBand {
  if (normalizedScore >= 740) return 'EXCELLENT';
  if (normalizedScore >= 670) return 'VERY_GOOD';
  if (normalizedScore >= 580) return 'GOOD';
  if (normalizedScore >= 500) return 'FAIR';
  return 'POOR';
}

/* ── dedupe key ── */
const LENDER_ALIASES: Record<string, string> = {
  gtbank: 'guarantytrust', gtb: 'guarantytrust', guarantytrustbank: 'guarantytrust', gtco: 'guarantytrust',
  firstbankofnigeria: 'firstbank', fbn: 'firstbank', firstbank: 'firstbank',
  unitedbankforafrica: 'uba', uba: 'uba', accessbankplc: 'access', accessbank: 'access',
  zenithbank: 'zenith', branchinternational: 'branch', branchmicrofinancebank: 'branch', carbonpaylater: 'carbon', stanbicibtc: 'stanbic', stanbicibtcbank: 'stanbic',
};
/** Lender names differ per bureau ("GTBank" / "Guaranty Trust Bank Plc"): normalise before comparing. */
export function normalizeLender(name: string): string {
  const base = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  if (LENDER_ALIASES[base]) return LENDER_ALIASES[base];
  let cur = base;
  for (let i = 0; i < 4; i++) {
    const next = cur.replace(/(microfinancebank|microfinance|mfb|limited|ltd|plc|bank|nigeria|nig|finance|financial|services)$/, '');
    if (!next || next === cur) break;
    cur = next;
    if (LENDER_ALIASES[cur]) return LENDER_ALIASES[cur];
  }
  return cur;
}
/** ₦50k buckets absorb small per-bureau rounding differences of the granted amount. */
export const AMOUNT_BUCKET_KOBO = 5_000_000;
export function scopeHash(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 8);
}
/** BVN-scoped (customer-scoped, hashed: no clear BVN) key: lender + opened month + amount bucket. */
export function facilityDedupeKey(scope: string, f: Pick<RawFacility, 'lender' | 'openedAt' | 'amountGrantedKobo'>): string {
  return `${scopeHash(scope)}:${normalizeLender(f.lender)}:${monthKey(f.openedAt)}:${Math.round(f.amountGrantedKobo / AMOUNT_BUCKET_KOBO)}`;
}
/** Same notion for DTO-level comparison (monitoring diffs). */
export function facilityIdentity(lender: string, openedAt: string | Date, amountKobo: number): string {
  const d = typeof openedAt === 'string' ? new Date(openedAt) : openedAt;
  return `${normalizeLender(lender)}:${monthKey(d)}:${Math.round(amountKobo / AMOUNT_BUCKET_KOBO)}`;
}

const isActiveStatus = (s: FacilityStatus): boolean => ACTIVE_STATUSES.includes(s);
const maxDate = (a: Date | null, b: Date | null): Date | null => (a && b ? (a > b ? a : b) : a ?? b);

/* ── merge ── */
export function mergeFacilities(items: { bureau: BureauName; facility: RawFacility }[], scope: string): MergedFacility[] {
  const groups = new Map<string, { bureau: BureauName; facility: RawFacility }[]>();
  for (const it of items) {
    const k = facilityDedupeKey(scope, it.facility);
    const g = groups.get(k);
    if (g) g.push(it); else groups.set(k, [it]);
  }
  const out: MergedFacility[] = [];
  for (const [dedupeKey, g] of groups) {
    // most severe status wins; ties resolved by bureau order so the result is deterministic
    const ordered = [...g].sort((a, b) => STATUS_SEVERITY[b.facility.status] - STATUS_SEVERITY[a.facility.status] || ALL_BUREAUS.indexOf(a.bureau) - ALL_BUREAUS.indexOf(b.bureau));
    const lead = ordered[0].facility;
    const months = new Map<string, number>();
    for (const { facility } of g) for (const h of facility.history) months.set(h.month, Math.max(months.get(h.month) ?? 0, h.dpd));
    const history = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, dpd]) => ({ month, dpd })).slice(-36);
    const status = lead.status;
    const statuses = new Set(g.map((x) => x.facility.status));
    const worstDpd = Math.max(0, ...g.map((x) => x.facility.worstDpd), ...history.map((h) => h.dpd));
    const tenors = g.map((x) => x.facility.tenorMonths).filter((t): t is number => t != null);
    let lastPaymentAt: Date | null = null;
    for (const { facility } of g) lastPaymentAt = maxDate(lastPaymentAt, facility.lastPaymentAt);
    out.push({
      dedupeKey,
      sources: ALL_BUREAUS.filter((b) => g.some((x) => x.bureau === b)),
      lender: lead.lender,
      productType: lead.productType,
      amountGrantedKobo: Math.max(...g.map((x) => x.facility.amountGrantedKobo)),
      // a lagging bureau may still show an older (higher) balance, a prudent view keeps the larger one for live facilities
      outstandingKobo: status === 'CLOSED' ? 0 : Math.max(...g.map((x) => x.facility.outstandingKobo)),
      status,
      tenorMonths: tenors.length ? Math.max(...tenors) : null,
      monthlyPaymentKobo: Math.max(...g.map((x) => x.facility.monthlyPaymentKobo)),
      openedAt: g.map((x) => x.facility.openedAt).sort((a, b) => a.getTime() - b.getTime())[0],
      closedAt: status === 'CLOSED' || status === 'WRITTEN_OFF' ? (lead.closedAt ?? g.map((x) => x.facility.closedAt).find((d) => d) ?? null) : null,
      lastPaymentAt,
      worstDpd,
      isActive: isActiveStatus(status),
      legalAction: g.some((x) => x.facility.legalAction),
      soldToCollections: g.some((x) => x.facility.soldToCollections),
      isGuarantor: g.some((x) => x.facility.isGuarantor),
      conflict: statuses.size > 1,
      history,
    });
  }
  return out.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
}

export function mergeEnquiries(items: { bureau: BureauName; lender: string; date: Date; purpose: string }[]): MergedEnquiry[] {
  const m = new Map<string, MergedEnquiry>();
  for (const e of items) {
    const k = `${normalizeLender(e.lender)}:${e.date.toISOString().slice(0, 10)}`;
    const cur = m.get(k);
    if (cur) { if (!cur.sources.includes(e.bureau)) cur.sources.push(e.bureau); } else m.set(k, { lender: e.lender, date: e.date, purpose: e.purpose, sources: [e.bureau] });
  }
  return [...m.values()].map((e) => ({ ...e, sources: ALL_BUREAUS.filter((b) => e.sources.includes(b)) })).sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function mergeFlags(items: { bureau: BureauName; type: MergedFlag['type']; detail: string; date: Date }[]): MergedFlag[] {
  const m = new Map<string, MergedFlag>();
  for (const f of items) {
    const k = `${f.type}:${f.date.toISOString().slice(0, 10)}`;
    if (!m.has(k)) m.set(k, { type: f.type, source: f.bureau, detail: f.detail, date: f.date });
  }
  return [...m.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

/* ── summary ── */
export function computeSummary(
  p: { scores: MergedScore[]; facilities: MergedFacility[]; enquiries: MergedEnquiry[]; flags: MergedFlag[] },
  now: Date,
): BureauSummary {
  const norm = p.scores.filter((s) => s.score != null).map((s) => normalizeScore(s.score as number, s.minScore, s.maxScore));
  const averageScore = norm.length ? Math.round(norm.reduce((a, b) => a + b, 0) / norm.length) : null;
  // guarantor facilities are someone else's debt: they feed guarantor exposure, not the borrower's own metrics
  const own = p.facilities.filter((f) => !f.isGuarantor);
  const active = own.filter((f) => f.isActive);
  const writeOffs = own.filter((f) => f.status === 'WRITTEN_OFF');
  const writeOffAges = writeOffs.map((f) => monthsBetween(f.closedAt ?? f.lastPaymentAt ?? f.openedAt, now)).map((n) => Math.max(0, n));
  const lastWriteOffMonthsAgo = writeOffAges.length ? Math.min(...writeOffAges) : null;
  const cutoff12 = monthKey(addMonths(now, -11));
  const allMonths = new Set<string>();
  for (const f of p.facilities) for (const h of f.history) allMonths.add(h.month);
  const enquiriesWithin = (days: number) => p.enquiries.filter((e) => { const d = daysBetween(e.date, now); return d >= 0 && d <= days; }).length;
  return {
    bestScore: norm.length ? Math.max(...norm) : null,
    lowestScore: norm.length ? Math.min(...norm) : null,
    averageScore,
    scoreBand: averageScore == null ? null : bandFor(averageScore),
    worstDpdEver: Math.max(0, ...own.map((f) => f.worstDpd)),
    activeFacilityCount: active.length,
    totalOutstandingKobo: active.reduce((a, f) => a + f.outstandingKobo, 0),
    totalMonthlyObligationKobo: active.reduce((a, f) => a + f.monthlyPaymentKobo, 0),
    enquiries30d: enquiriesWithin(30),
    enquiries90d: enquiriesWithin(90),
    enquiries180d: enquiriesWithin(180),
    // a write-off is a default too
    defaultCount: own.filter((f) => f.status === 'DEFAULTED' || f.status === 'WRITTEN_OFF').length,
    writeOffCount: writeOffs.length,
    hasWriteOff24m: lastWriteOffMonthsAgo != null && lastWriteOffMonthsAgo <= 24,
    lastWriteOffMonthsAgo,
    hasDpd90In12m: own.some((f) => f.history.some((h) => h.month >= cutoff12 && h.dpd >= 90)),
    elsewhereDefault: active.some((f) => (f.status === 'Unpaid' || f.status === 'DEFAULTED') && f.worstDpd >= 30 && currentDpd(f) >= 30),
    fraudFlag: p.flags.some((f) => f.type === 'FRAUD' || f.type === 'WATCHLIST'),
    legalActionCount: own.filter((f) => f.legalAction).length,
    soldToCollectionsCount: own.filter((f) => f.soldToCollections).length,
    guarantorExposureKobo: p.facilities.filter((f) => f.isGuarantor && f.isActive).reduce((a, f) => a + f.outstandingKobo, 0),
    thinFile: p.facilities.length < 2 || allMonths.size < 6,
  };
}
/** Latest history month's DPD (the facility's current delinquency), falling back to worst when there is no history. */
function currentDpd(f: MergedFacility): number {
  return f.history.length ? f.history[f.history.length - 1].dpd : f.worstDpd;
}

/** Combine outcomes from every bureau queried into one report model (scores stay per bureau). */
export function buildMergedReport(outcomes: PerBureauOutcome[], scope: string, now: Date = new Date()): MergedReport {
  const ok = outcomes.filter((o): o is PerBureauOutcome & { result: RawBureauResult } => (o.status === 'SUCCESS' || o.status === 'NO_HIT') && !!o.result);
  const scores: MergedScore[] = ok.map((o) => ({
    bureau: o.bureau,
    score: o.result.notFound ? null : o.result.score,
    band: o.result.notFound || o.result.score == null ? null : bandFor(normalizeScore(o.result.score, o.result.minScore, o.result.maxScore)),
    minScore: o.result.minScore,
    maxScore: o.result.maxScore,
  }));
  const found = ok.filter((o) => !o.result.notFound);
  const facilities = mergeFacilities(found.flatMap((o) => o.result.facilities.map((facility) => ({ bureau: o.bureau, facility }))), scope);
  const enquiries = mergeEnquiries(found.flatMap((o) => o.result.enquiries.map((e) => ({ bureau: o.bureau, ...e }))));
  const flags = mergeFlags(found.flatMap((o) => o.result.flags.map((f) => ({ bureau: o.bureau, ...f }))));
  const summary = computeSummary({ scores, facilities, enquiries, flags }, now);
  return {
    bureausQueried: outcomes.map((o) => o.bureau),
    bureausFailed: outcomes.filter((o) => o.status === 'FAILED').map((o) => ({ bureau: o.bureau, error: o.error ?? 'failed' })),
    scores, facilities, enquiries, flags, summary,
  };
}
