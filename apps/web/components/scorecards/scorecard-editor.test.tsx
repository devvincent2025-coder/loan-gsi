import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SCORECARD_V1, type ScorecardDefinition } from '@damez/shared';
import { ScorecardEditor } from './scorecard-editor';
import { validateDefinition } from './validate';

const clone = () => structuredClone(DEFAULT_SCORECARD_V1);
// getByLabelText scans every label of the (large) editor and is very slow in jsdom: query by id instead
const dtiInput = () => document.getElementById('sc-maxdti') as HTMLInputElement;

describe('validateDefinition', () => {
  it('accepts the seeded default scorecard', () => {
    expect(validateDefinition(DEFAULT_SCORECARD_V1).ok).toBe(true);
  });
  it('surfaces schema errors with paths', () => {
    const d = clone();
    d.affordability.maxDtiBps = 100;
    d.policyRules[0]!.code = 'bad code';
    const r = validateDefinition(d);
    expect(r.ok).toBe(false);
    expect(r.issues.find((i) => i.path === 'affordability.maxDtiBps')?.message).toMatch(/greater than or equal to 500/i);
    expect(r.issues.some((i) => i.path === 'policyRules.0.code')).toBe(true);
  });
  it('rejects non-objects, empty factors and impossible cutoffs', () => {
    expect(validateDefinition(null).ok).toBe(false);
    const d = clone();
    d.factors = [];
    expect(validateDefinition(d).issues.some((i) => i.path === 'factors')).toBe(true);
    const e = clone();
    e.cutoffs = { approve: 500, refer: 600 };
    expect(validateDefinition(e).issues.some((i) => i.path === 'cutoffs.refer')).toBe(true);
  });
  it('flags unknown fields and duplicate keys', () => {
    const d = clone();
    d.factors[0]!.field = 'notAFact';
    d.factors[1]!.key = d.factors[0]!.key;
    const paths = validateDefinition(d).issues.map((i) => i.path);
    expect(paths).toContain('factors.0.field');
    expect(paths).toContain('factors.1.key');
  });
});

function Harness({ initial, readOnly }: { initial: ScorecardDefinition; readOnly?: boolean }) {
  const [d, setD] = useState(initial);
  const check = validateDefinition(d);
  return <ScorecardEditor definition={d} onChange={setD} readOnly={readOnly} issues={check.ok ? [] : check.issues} />;
}

describe('ScorecardEditor', () => {
  it('renders factors, rules and affordability with DTI shown as a percentage', () => {
    render(<Harness initial={clone()} />);
    expect(screen.getAllByTestId('factor-card')).toHaveLength(DEFAULT_SCORECARD_V1.factors.length);
    expect(screen.getAllByTestId('rule-card')).toHaveLength(DEFAULT_SCORECARD_V1.policyRules.length);
    expect(dtiInput()).toHaveValue('40');
    expect(screen.queryByTestId('validation-summary')).not.toBeInTheDocument();
  });
  it('surfaces schema errors inline and in a summary when a value goes out of range', () => {
    render(<Harness initial={clone()} />);
    const dti = dtiInput();
    fireEvent.change(dti, { target: { value: '1' } });
    expect(screen.getByTestId('validation-summary')).toHaveTextContent(/affordability\.maxDtiBps/);
    expect(screen.getAllByTestId('field-error')[0]).toHaveTextContent(/greater than or equal to 500/i);
  });
  it('disables every control when read-only', () => {
    render(<Harness initial={clone()} readOnly />);
    expect(dtiInput()).toBeDisabled();
    expect(screen.queryByText('Add factor')).not.toBeInTheDocument();
  });
});
