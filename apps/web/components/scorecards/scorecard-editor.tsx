'use client';
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { FACT_FIELDS, type FactFieldMeta, type ScorecardDefinition } from '@damez/shared';
import { Callout, NumberInput, SectionCard } from '@/components/staff/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { formatLooseValue, issueAt, parseLooseValue, type DefinitionIssue } from './validate';

type Factor = ScorecardDefinition['factors'][number];
type Rule = ScorecardDefinition['policyRules'][number];
type Bin = Factor['bins'][number];

export function FactSelect({ value, onChange, fields, disabled, id, label }: { value: string; onChange: (v: string) => void; fields: FactFieldMeta[]; disabled?: boolean; id?: string; label: string }) {
  const groups = [...new Set(fields.map((f) => f.group))];
  const known = fields.some((f) => f.key === value);
  return (
    <Select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{value || 'Select a field…'}</option>}
      {groups.map((g) => <optgroup key={g} label={g}>{fields.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>)}
    </Select>
  );
}

const ERR = 'text-xs font-medium text-destructive';
const Err = ({ issues, path }: { issues: DefinitionIssue[]; path: string }) => {
  const m = issueAt(issues, path);
  return m ? <p role="alert" className={ERR} data-testid="field-error">{m}</p> : null;
};
const Num = ({ label, path, value, onChange, issues, disabled, step }: { label: string; path: string; value: number; onChange: (n: number) => void; issues: DefinitionIssue[]; disabled?: boolean; step?: number }) => (
  <div className="space-y-1.5">
    <label className="text-sm font-medium leading-none" htmlFor={`sc-${path}`}>{label}</label>
    <NumberInput id={`sc-${path}`} value={value} step={step} disabled={disabled} onChange={(n) => onChange(n ?? 0)} className={cn(issueAt(issues, path) && 'border-destructive')} />
    <Err issues={issues} path={path} />
  </div>
);

export interface ScorecardEditorProps {
  definition: ScorecardDefinition;
  onChange: (d: ScorecardDefinition) => void;
  readOnly?: boolean;
  issues: DefinitionIssue[];
  fields?: FactFieldMeta[];
}

export function ScorecardEditor({ definition: def, onChange, readOnly, issues, fields = FACT_FIELDS }: ScorecardEditorProps) {
  const mutate = (fn: (d: ScorecardDefinition) => void) => {
    const next = structuredClone(def);
    fn(next);
    onChange(next);
  };
  const fieldMeta = (key: string) => fields.find((f) => f.key === key);
  const ro = !!readOnly;
  return (
    <div className="space-y-5" data-testid="scorecard-editor">
      {issues.length > 0 && (
        <Callout tone="danger" title={`${issues.length} validation issue${issues.length > 1 ? 's' : ''}`} data-testid="validation-summary">
          <ul className="list-disc pl-4 text-sm">{issues.slice(0, 8).map((i, k) => <li key={k}><span className="font-mono text-xs">{i.path || 'definition'}</span>: {i.message}</li>)}{issues.length > 8 && <li>…and {issues.length - 8} more</li>}</ul>
        </Callout>
      )}

      <SectionCard title="Score range & cutoffs" description="Applicant score = base score + factor points, clamped to the range.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Num label="Base score" path="baseScore" value={def.baseScore} issues={issues} disabled={ro} onChange={(n) => mutate((d) => { d.baseScore = n; })} />
          <Num label="Min score" path="minScore" value={def.minScore} issues={issues} disabled={ro} onChange={(n) => mutate((d) => { d.minScore = n; })} />
          <Num label="Max score" path="maxScore" value={def.maxScore} issues={issues} disabled={ro} onChange={(n) => mutate((d) => { d.maxScore = n; })} />
          <Num label="Approve cutoff" path="cutoffs.approve" value={def.cutoffs.approve} issues={issues} disabled={ro} onChange={(n) => mutate((d) => { d.cutoffs.approve = n; })} />
          <Num label="Refer cutoff" path="cutoffs.refer" value={def.cutoffs.refer} issues={issues} disabled={ro} onChange={(n) => mutate((d) => { d.cutoffs.refer = n; })} />
        </div>
      </SectionCard>

      <SectionCard
        title="Factors" description="Each factor maps a fact to points through bins (first matching bin wins)."
        actions={!ro && <Button size="sm" variant="outline" onClick={() => mutate((d) => { d.factors.push({ key: `factor_${d.factors.length + 1}`, label: 'New factor', field: fields[0]!.key, defaultPoints: 0, bins: [{ gte: 0, points: 0 }] }); })}><Plus /> Add factor</Button>}
      >
        <div className="space-y-4">
          {def.factors.map((f, fi) => {
            const meta = fieldMeta(f.field);
            return (
              <div key={fi} className="rounded-lg border p-4" data-testid="factor-card">
                <div className="grid gap-3 md:grid-cols-[1fr,1fr,1fr,7rem,auto] md:items-start">
                  <FormField label="Label" htmlFor={`f-label-${fi}`} error={issueAt(issues, `factors.${fi}.label`)}><Input id={`f-label-${fi}`} value={f.label} disabled={ro} onChange={(e) => mutate((d) => { d.factors[fi]!.label = e.target.value; })} /></FormField>
                  <FormField label="Key" htmlFor={`f-key-${fi}`} error={issueAt(issues, `factors.${fi}.key`)}><Input id={`f-key-${fi}`} className="font-mono" value={f.key} disabled={ro} onChange={(e) => mutate((d) => { d.factors[fi]!.key = e.target.value; })} /></FormField>
                  <FormField label="Fact field" htmlFor={`f-field-${fi}`} error={issueAt(issues, `factors.${fi}.field`)}><FactSelect id={`f-field-${fi}`} label="Fact field" value={f.field} fields={fields} disabled={ro} onChange={(v) => mutate((d) => { d.factors[fi]!.field = v; })} /></FormField>
                  <FormField label="Default pts" htmlFor={`f-def-${fi}`} error={issueAt(issues, `factors.${fi}.defaultPoints`)}><NumberInput id={`f-def-${fi}`} value={f.defaultPoints} disabled={ro} onChange={(n) => mutate((d) => { d.factors[fi]!.defaultPoints = n ?? 0; })} /></FormField>
                  {!ro && <Button variant="ghost" size="icon" className="mt-6" aria-label={`Remove factor ${f.label}`} onClick={() => mutate((d) => { d.factors.splice(fi, 1); })}><Trash2 /></Button>}
                </div>
                {meta?.unit === 'kobo' && <p className="mt-1 text-xs text-muted-foreground">Bin thresholds for this field are in kobo (₦1 = 100).</p>}
                <Err issues={issues} path={`factors.${fi}.bins`} />
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-1 pr-2 font-medium">≥ (gte)</th><th className="pb-1 pr-2 font-medium">&lt; (lt)</th><th className="pb-1 pr-2 font-medium">= (eq)</th><th className="pb-1 pr-2 font-medium">Points</th><th className="pb-1 pr-2 font-medium">Label</th><th /></tr></thead>
                    <tbody>
                      {f.bins.map((b: Bin, bi: number) => (
                        <tr key={bi}>
                          <td className="pr-2 pb-1.5"><NumberInput aria-label={`Factor ${fi + 1} bin ${bi + 1} gte`} nullable disabled={ro} value={b.gte ?? null} onChange={(n) => mutate((d) => { const bin = d.factors[fi]!.bins[bi]!; if (n === null) delete bin.gte; else bin.gte = n; })} /></td>
                          <td className="pr-2 pb-1.5"><NumberInput aria-label={`Factor ${fi + 1} bin ${bi + 1} lt`} nullable disabled={ro} value={b.lt ?? null} onChange={(n) => mutate((d) => { const bin = d.factors[fi]!.bins[bi]!; if (n === null) delete bin.lt; else bin.lt = n; })} /></td>
                          <td className="pr-2 pb-1.5"><Input aria-label={`Factor ${fi + 1} bin ${bi + 1} eq`} disabled={ro} placeholder="true / 3 / CIVIL_SERVANT" value={formatLooseValue(b.eq)} onChange={(e) => mutate((d) => { const bin = d.factors[fi]!.bins[bi]!; if (e.target.value === '') delete bin.eq; else bin.eq = parseLooseValue(e.target.value); })} /></td>
                          <td className="pr-2 pb-1.5"><NumberInput aria-label={`Factor ${fi + 1} bin ${bi + 1} points`} disabled={ro} value={b.points} onChange={(n) => mutate((d) => { d.factors[fi]!.bins[bi]!.points = n ?? 0; })} className={cn(issueAt(issues, `factors.${fi}.bins.${bi}.points`) && 'border-destructive')} /></td>
                          <td className="pr-2 pb-1.5"><Input aria-label={`Factor ${fi + 1} bin ${bi + 1} label`} disabled={ro} value={b.label ?? ''} onChange={(e) => mutate((d) => { const bin = d.factors[fi]!.bins[bi]!; if (e.target.value === '') delete bin.label; else bin.label = e.target.value; })} /></td>
                          <td className="pb-1.5">{!ro && <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove bin ${bi + 1}`} onClick={() => mutate((d) => { d.factors[fi]!.bins.splice(bi, 1); })}><Trash2 /></Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!ro && <Button size="sm" variant="ghost" onClick={() => mutate((d) => { d.factors[fi]!.bins.push({ points: 0 }); })}><Plus /> Add bin</Button>}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Policy rules" description="Hard rules evaluated before scoring: DECLINE ends the application, REFER forces manual review."
        actions={!ro && <Button size="sm" variant="outline" onClick={() => mutate((d) => { d.policyRules.push({ code: `RULE_${d.policyRules.length + 1}`, label: 'New rule', field: fields[0]!.key, op: 'eq', value: true, action: 'REFER', customerMessage: 'We need to review your application.', officerMessage: 'Describe why this rule fires.' }); })}><Plus /> Add rule</Button>}
      >
        {def.policyRules.length === 0 && <p className="text-sm text-muted-foreground">No policy rules.</p>}
        <div className="space-y-3">
          {def.policyRules.map((r: Rule, ri) => {
            const meta = fieldMeta(r.field);
            return (
              <div key={ri} className="rounded-lg border p-4" data-testid="rule-card">
                <div className="grid gap-3 md:grid-cols-6">
                  <FormField label="Code" htmlFor={`r-code-${ri}`} error={issueAt(issues, `policyRules.${ri}.code`)}><Input id={`r-code-${ri}`} className="font-mono" disabled={ro} value={r.code} onChange={(e) => mutate((d) => { d.policyRules[ri]!.code = e.target.value; })} /></FormField>
                  <FormField label="Label" htmlFor={`r-label-${ri}`} className="md:col-span-2" error={issueAt(issues, `policyRules.${ri}.label`)}><Input id={`r-label-${ri}`} disabled={ro} value={r.label} onChange={(e) => mutate((d) => { d.policyRules[ri]!.label = e.target.value; })} /></FormField>
                  <FormField label="Field" htmlFor={`r-field-${ri}`} className="md:col-span-2" error={issueAt(issues, `policyRules.${ri}.field`)}><FactSelect id={`r-field-${ri}`} label="Rule field" value={r.field} fields={fields} disabled={ro} onChange={(v) => mutate((d) => { d.policyRules[ri]!.field = v; })} /></FormField>
                  <div className="flex items-end justify-end">{!ro && <Button variant="ghost" size="icon" aria-label={`Remove rule ${r.code}`} onClick={() => mutate((d) => { d.policyRules.splice(ri, 1); })}><Trash2 /></Button>}</div>
                  <FormField label="Operator" htmlFor={`r-op-${ri}`}><Select id={`r-op-${ri}`} disabled={ro} value={r.op} onChange={(e) => mutate((d) => { d.policyRules[ri]!.op = e.target.value as Rule['op']; })}>{(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const).map((o) => <option key={o} value={o}>{o}</option>)}</Select></FormField>
                  <FormField label="Value" htmlFor={`r-val-${ri}`} error={issueAt(issues, `policyRules.${ri}.value`)}>
                    {meta?.type === 'boolean' ? (
                      <Select id={`r-val-${ri}`} disabled={ro} value={String(r.value)} onChange={(e) => mutate((d) => { d.policyRules[ri]!.value = e.target.value === 'true'; })}><option value="true">true</option><option value="false">false</option></Select>
                    ) : (
                      <Input id={`r-val-${ri}`} disabled={ro} value={formatLooseValue(r.value)} onChange={(e) => mutate((d) => { d.policyRules[ri]!.value = parseLooseValue(e.target.value); })} />
                    )}
                  </FormField>
                  <FormField label="Action" htmlFor={`r-act-${ri}`}><Select id={`r-act-${ri}`} disabled={ro} value={r.action} onChange={(e) => mutate((d) => { d.policyRules[ri]!.action = e.target.value as Rule['action']; })}><option value="DECLINE">DECLINE</option><option value="REFER">REFER</option></Select></FormField>
                  <FormField label="Reapply after (days)" htmlFor={`r-re-${ri}`} error={issueAt(issues, `policyRules.${ri}.reapplyAfterDays`)}><NumberInput id={`r-re-${ri}`} nullable min={1} disabled={ro} value={r.reapplyAfterDays ?? null} onChange={(n) => mutate((d) => { const rule = d.policyRules[ri]!; if (n === null) delete rule.reapplyAfterDays; else rule.reapplyAfterDays = n; })} /></FormField>
                  <div className="flex items-end"><Badge variant={r.action === 'DECLINE' ? 'destructive' : 'warning'}>{r.action}</Badge></div>
                  <FormField label="Customer message" htmlFor={`r-cm-${ri}`} className="md:col-span-3" error={issueAt(issues, `policyRules.${ri}.customerMessage`)}><Input id={`r-cm-${ri}`} disabled={ro} value={r.customerMessage} onChange={(e) => mutate((d) => { d.policyRules[ri]!.customerMessage = e.target.value; })} /></FormField>
                  <FormField label="Officer message" htmlFor={`r-om-${ri}`} className="md:col-span-3" error={issueAt(issues, `policyRules.${ri}.officerMessage`)}><Input id={`r-om-${ri}`} disabled={ro} value={r.officerMessage} onChange={(e) => mutate((d) => { d.policyRules[ri]!.officerMessage = e.target.value; })} /></FormField>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Affordability" description="Debt-to-income and income recognition parameters.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium leading-none" htmlFor="sc-maxdti">Max DTI (%)</label>
            <Input id="sc-maxdti" className="tabular" inputMode="decimal" disabled={ro} value={String(def.affordability.maxDtiBps / 100)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) mutate((d) => { d.affordability.maxDtiBps = Math.round(n * 100); }); }} aria-invalid={!!issueAt(issues, 'affordability.maxDtiBps') || undefined} />
            <p className="text-xs text-muted-foreground">{def.affordability.maxDtiBps} bps</p>
            <Err issues={issues} path="affordability.maxDtiBps" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium leading-none" htmlFor="sc-infl">Inflow recognition (%)</label>
            <Input id="sc-infl" className="tabular" inputMode="decimal" disabled={ro} value={String(def.affordability.inflowRecognitionBps / 100)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) mutate((d) => { d.affordability.inflowRecognitionBps = Math.round(n * 100); }); }} aria-invalid={!!issueAt(issues, 'affordability.inflowRecognitionBps') || undefined} />
            <p className="text-xs text-muted-foreground">{def.affordability.inflowRecognitionBps} bps</p>
            <Err issues={issues} path="affordability.inflowRecognitionBps" />
          </div>
          <Num label="Min statement months" path="affordability.minStatementMonths" value={def.affordability.minStatementMonths} issues={issues} disabled={ro} onChange={(n) => mutate((d) => { d.affordability.minStatementMonths = n; })} />
          <Num label="Guarantor within (points)" path="affordability.guarantorWithinPoints" value={def.affordability.guarantorWithinPoints} issues={issues} disabled={ro} onChange={(n) => mutate((d) => { d.affordability.guarantorWithinPoints = n; })} />
        </div>
      </SectionCard>
    </div>
  );
}
