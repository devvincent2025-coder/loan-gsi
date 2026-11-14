import { BadRequestException } from '@nestjs/common';
import { FACT_FIELDS, ScorecardDefinition, scorecardDefinitionSchema } from '@damez/shared';

const FIELD = new Map(FACT_FIELDS.map((f) => [f.key as string, f]));

/** Semantic checks on top of the zod shape: known fields, type-compatible bins/rules, ordered cutoffs, unique codes. Returns error strings keyed by path. */
export function semanticErrors(def: ScorecardDefinition): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const add = (path: string, msg: string) => (errors[path] ??= []).push(msg);

  if (def.cutoffs.refer > def.cutoffs.approve) add('definition.cutoffs', 'refer cutoff must be less than or equal to the approve cutoff');
  if (def.minScore > def.maxScore) add('definition', 'minScore must be less than or equal to maxScore');
  if (def.baseScore < def.minScore || def.baseScore > def.maxScore) add('definition.baseScore', 'baseScore must lie between minScore and maxScore');
  if (def.cutoffs.approve > def.maxScore) add('definition.cutoffs.approve', 'approve cutoff is above the maximum score, so nobody could ever be approved');

  const keys = new Set<string>();
  def.factors.forEach((f, i) => {
    const p = `definition.factors.${i}`;
    if (keys.has(f.key)) add(`${p}.key`, `duplicate factor key "${f.key}"`);
    keys.add(f.key);
    const meta = FIELD.get(f.field);
    if (!meta) { add(`${p}.field`, `unknown field "${f.field}"`); return; }
    f.bins.forEach((b, j) => {
      const bp = `${p}.bins.${j}`;
      if (b.eq !== undefined && typeof b.eq !== meta.type) add(bp, `eq value must be a ${meta.type} for field ${f.field}`);
      if ((b.gte !== undefined || b.lt !== undefined) && meta.type !== 'number') add(bp, `gte/lt only apply to numeric fields (${f.field} is ${meta.type})`);
      if (b.gte !== undefined && b.lt !== undefined && b.gte >= b.lt) add(bp, 'gte must be less than lt');
    });
  });

  const codes = new Set<string>();
  def.policyRules.forEach((r, i) => {
    const p = `definition.policyRules.${i}`;
    if (codes.has(r.code)) add(`${p}.code`, `duplicate rule code "${r.code}"`);
    codes.add(r.code);
    const meta = FIELD.get(r.field);
    if (!meta) { add(`${p}.field`, `unknown field "${r.field}"`); return; }
    if (typeof r.value !== meta.type) add(`${p}.value`, `value must be a ${meta.type} for field ${r.field}`);
    if (['gt', 'gte', 'lt', 'lte'].includes(r.op) && meta.type !== 'number') add(`${p}.op`, `operator ${r.op} only applies to numeric fields`);
  });
  return errors;
}

/** Validate an untrusted definition; throws 400 VALIDATION_FAILED with per-path errors. */
export function validateDefinition(raw: unknown): ScorecardDefinition {
  const r = scorecardDefinitionSchema.safeParse(raw);
  if (!r.success) {
    const errors: Record<string, string[]> = {};
    for (const i of r.error.issues) (errors[['definition', ...i.path].join('.')] ??= []).push(i.message);
    throw new BadRequestException({ statusCode: 400, message: 'Validation failed', code: 'VALIDATION_FAILED', errors });
  }
  const errors = semanticErrors(r.data);
  if (Object.keys(errors).length) throw new BadRequestException({ statusCode: 400, message: 'Validation failed', code: 'VALIDATION_FAILED', errors });
  return r.data;
}
