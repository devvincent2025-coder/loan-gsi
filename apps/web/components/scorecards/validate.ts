import { FACT_FIELDS, scorecardDefinitionSchema, type ScorecardDefinition } from '@damez/shared';

export interface DefinitionIssue { path: string; message: string }
export type DefinitionCheck = { ok: true; data: ScorecardDefinition; issues: DefinitionIssue[] } | { ok: false; issues: DefinitionIssue[] };

const FIELD_KEYS = new Set<string>(FACT_FIELDS.map((f) => f.key));

/** Schema validation (shared zod schema, same one the API uses) plus cross-field sanity checks. */
export function validateDefinition(def: unknown): DefinitionCheck {
  const parsed = scorecardDefinitionSchema.safeParse(def);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  const d = parsed.data;
  const extra: DefinitionIssue[] = [];
  if (d.minScore >= d.maxScore) extra.push({ path: 'maxScore', message: 'Max score must be greater than min score.' });
  if (d.cutoffs.refer > d.cutoffs.approve) extra.push({ path: 'cutoffs.refer', message: 'Refer cutoff cannot be above the approve cutoff.' });
  const seen = new Set<string>();
  d.factors.forEach((f, i) => {
    if (seen.has(f.key)) extra.push({ path: `factors.${i}.key`, message: `Duplicate factor key "${f.key}".` });
    seen.add(f.key);
    if (!FIELD_KEYS.has(f.field)) extra.push({ path: `factors.${i}.field`, message: `Unknown fact field "${f.field}".` });
  });
  const codes = new Set<string>();
  d.policyRules.forEach((r, i) => {
    if (codes.has(r.code)) extra.push({ path: `policyRules.${i}.code`, message: `Duplicate rule code "${r.code}".` });
    codes.add(r.code);
    if (!FIELD_KEYS.has(r.field)) extra.push({ path: `policyRules.${i}.field`, message: `Unknown fact field "${r.field}".` });
  });
  return extra.length ? { ok: false, issues: extra } : { ok: true, data: d, issues: [] };
}

/** "true" → true, "12" → 12, anything else stays a string (used for bin `eq` and rule `value`). */
export function parseLooseValue(text: string): number | boolean | string {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  return text;
}
export const formatLooseValue = (v: number | boolean | string | undefined): string => (v === undefined ? '' : String(v));

export const issuesUnder = (issues: DefinitionIssue[], prefix: string) => issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));
export const issueAt = (issues: DefinitionIssue[], path: string) => issues.find((i) => i.path === path)?.message;
