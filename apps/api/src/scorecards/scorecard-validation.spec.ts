import { BadRequestException } from '@nestjs/common';
import { DEFAULT_SCORECARD_V1, ScorecardDefinition } from '@damez/shared';
import { semanticErrors, validateDefinition } from './scorecard-validation';

const clone = (): ScorecardDefinition => JSON.parse(JSON.stringify(DEFAULT_SCORECARD_V1));
const errorsOf = (raw: unknown): Record<string, string[]> => {
  try { validateDefinition(raw); } catch (e) { return ((e as BadRequestException).getResponse() as { errors: Record<string, string[]> }).errors; }
  return {};
};

describe('scorecard validation', () => {
  it('accepts the default scorecard', () => {
    expect(() => validateDefinition(DEFAULT_SCORECARD_V1)).not.toThrow();
    expect(semanticErrors(DEFAULT_SCORECARD_V1)).toEqual({});
  });
  it('rejects unknown factor and rule fields', () => {
    const d = clone();
    d.factors[0].field = 'creditKarma';
    d.policyRules[0].field = 'nope';
    const e = errorsOf(d);
    expect(e['definition.factors.0.field'][0]).toMatch(/unknown field/);
    expect(e['definition.policyRules.0.field'][0]).toMatch(/unknown field/);
  });
  it('rejects refer > approve and inverted score range', () => {
    const d = clone();
    d.cutoffs = { approve: 500, refer: 600 };
    expect(errorsOf(d)['definition.cutoffs']).toBeDefined();
    const d2 = clone(); d2.minScore = 900;
    expect(errorsOf(d2)['definition']).toBeDefined();
  });
  it('rejects type-incompatible bins and rules', () => {
    const d = clone();
    d.factors.find((f) => f.field === 'employmentStatus')!.bins = [{ gte: 3, points: 1 }];
    d.factors.find((f) => f.field === 'bureauThinFile')!.bins = [{ eq: 'yes', points: 1 }];
    d.policyRules[0] = { ...d.policyRules[0], field: 'bureauWriteOff24m', op: 'gt', value: true };
    const e = errorsOf(d);
    expect(Object.values(e).flat().join(' ')).toMatch(/gte\/lt only apply to numeric/);
    expect(Object.values(e).flat().join(' ')).toMatch(/eq value must be a boolean/);
    expect(Object.values(e).flat().join(' ')).toMatch(/operator gt only applies to numeric/);
  });
  it('rejects duplicate keys / codes and impossible bins', () => {
    const d = clone();
    d.factors[1].key = d.factors[0].key;
    d.policyRules[1].code = d.policyRules[0].code;
    d.factors[2].bins = [{ gte: 5, lt: 5, points: 0 }];
    const e = JSON.stringify(errorsOf(d));
    expect(e).toMatch(/duplicate factor key/);
    expect(e).toMatch(/duplicate rule code/);
    expect(e).toMatch(/gte must be less than lt/);
  });
  it('reports zod shape errors with paths', () => {
    const d = clone() as unknown as Record<string, unknown>;
    (d.affordability as Record<string, unknown>).maxDtiBps = 99_999;
    delete d.cutoffs;
    const e = errorsOf(d);
    expect(e['definition.affordability.maxDtiBps']).toBeDefined();
    expect(e['definition.cutoffs']).toBeDefined();
    expect(errorsOf('garbage')['definition']).toBeDefined();
  });
  it('rejects an approve cutoff nobody can reach', () => {
    const d = clone(); d.cutoffs.approve = 900;
    expect(errorsOf(d)['definition.cutoffs.approve']).toBeDefined();
  });
});
