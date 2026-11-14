'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Equal, RotateCcw } from 'lucide-react';
import { FACT_FIELDS, type CustomerDto, type EligibilityFacts, type FactFieldMeta, type ScorecardDefinition, type ScorecardDto, type SimulateRequest, type SimulateResponse } from '@damez/shared';
import { EligibilityPanel } from '@/components/applications/eligibility-panel';
import { OutcomeBadge } from '@/components/applications/application-ui';
import { useProductOptions } from '@/components/applications/use-products';
import { CustomerPicker } from '@/components/customers/customer-picker';
import { MoneyInput, MoneyText } from '@/components/money';
import { Callout, NumberInput, SectionCard } from '@/components/staff/ui-bits';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { FormField, Label, Select } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/lib/auth';
import { errorMessage, get, post } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';

const EMPLOYMENT: EligibilityFacts['employmentStatus'][] = ['EMPLOYED', 'SELF_EMPLOYED', 'CIVIL_SERVANT', 'STUDENT', 'UNEMPLOYED', 'RETIRED'];
const NULLABLE = new Set<keyof EligibilityFacts>(['bureauScore', 'bureauWriteOffAgeMonths']);
interface SliderSpec { min: number; max: number; step: number; display?: (v: number) => string }
const SLIDERS: Partial<Record<keyof EligibilityFacts, SliderSpec>> = {
  bureauScore: { min: 300, max: 850, step: 5 },
  avgMonthlyInflowKobo: { min: 0, max: 500_000_000, step: 5_000_000, display: (v) => `₦${(v / 100).toLocaleString('en-NG')}` },
  bureauMonthlyObligationKobo: { min: 0, max: 200_000_000, step: 2_500_000, display: (v) => `₦${(v / 100).toLocaleString('en-NG')}` },
  bureauEnquiries90d: { min: 0, max: 12, step: 1 },
  kycTier: { min: 0, max: 3, step: 1 },
};

function FactInput({ meta, value, onChange, remountKey }: { meta: FactFieldMeta; value: EligibilityFacts[keyof EligibilityFacts] | undefined; onChange: (v: EligibilityFacts[keyof EligibilityFacts]) => void; remountKey: string }) {
  const id = `fact-${meta.key}`;
  const slider = SLIDERS[meta.key];
  if (meta.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <Label htmlFor={id} className="font-normal">{meta.label}</Label>
        <Switch id={id} checked={value === true} onCheckedChange={(v) => onChange(v as never)} aria-label={meta.label} />
      </div>
    );
  }
  if (meta.key === 'employmentStatus') {
    return (
      <FormField label={meta.label} htmlFor={id}>
        <Select id={id} value={String(value ?? 'EMPLOYED')} onChange={(e) => onChange(e.target.value as never)}>{EMPLOYMENT.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
      </FormField>
    );
  }
  const num = typeof value === 'number' ? value : null;
  return (
    <FormField label={meta.label} htmlFor={id}>
      <div className="space-y-1.5">
        {meta.unit === 'kobo' ? (
          <MoneyInput key={remountKey} id={id} value={num ?? 0} onChange={(k) => onChange((k ?? 0) as never)} />
        ) : (
          <div className="flex items-center gap-2">
            <NumberInput key={remountKey} id={id} value={num} nullable={NULLABLE.has(meta.key)} onChange={(n) => onChange(n as never)} />
            {meta.unit && meta.unit !== 'count' && <span className="text-xs text-muted-foreground">{meta.unit}</span>}
          </div>
        )}
        {slider && (
          <input type="range" aria-label={`${meta.label} slider`} className="w-full accent-[hsl(var(--primary))]" min={slider.min} max={slider.max} step={slider.step} value={Math.min(slider.max, Math.max(slider.min, num ?? slider.min))} onChange={(e) => onChange(Number(e.target.value) as never)} />
        )}
      </div>
    </FormField>
  );
}

function Delta({ label, a, b, fmt, better = 'higher' }: { label: string; a: number; b: number; fmt: (n: number) => React.ReactNode; better?: 'higher' | 'lower' }) {
  const d = b - a;
  const good = d === 0 ? null : better === 'higher' ? d > 0 : d < 0;
  const Icon = d === 0 ? Equal : d > 0 ? ArrowUp : ArrowDown;
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{fmt(a)} <span className="text-muted-foreground">→</span> {fmt(b)}</p>
      <p className={`inline-flex items-center gap-0.5 text-xs font-medium ${good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive'}`}><Icon className="size-3" aria-hidden />{d === 0 ? 'no change' : fmt(Math.abs(d))}</p>
    </div>
  );
}

export interface SimulatorProps {
  /** unsaved definition from the scorecard editor; offered as the "Current draft" scorecard */
  draftDefinition?: ScorecardDefinition | null;
  draftKey?: string;
  initialScorecardId?: string;
}

export function EligibilitySimulator({ draftDefinition, draftKey, initialScorecardId }: SimulatorProps) {
  const canRun = useCan('eligibility:run');
  const canScorecards = useCan('scorecard:read');
  const products = useProductOptions();
  const scorecards = useQuery({ queryKey: ['scorecards'], queryFn: () => get<ScorecardDto[]>('/scorecards'), enabled: canScorecards, retry: false });
  const fieldsQ = useQuery({ queryKey: ['scorecard-fields'], queryFn: () => get<FactFieldMeta[]>('/scorecards/fields'), enabled: canScorecards, retry: false, staleTime: 600_000 });
  const fields = fieldsQ.data?.length ? fieldsQ.data : FACT_FIELDS;

  const [productId, setProductId] = React.useState('');
  const [amount, setAmount] = React.useState<number | null>(null);
  const [tenor, setTenor] = React.useState<number | null>(null);
  const [choice, setChoice] = React.useState<string>(draftDefinition ? 'draft' : (initialScorecardId ?? ''));
  const [customer, setCustomer] = React.useState<CustomerDto | null>(null);
  const [overrides, setOverrides] = React.useState<Partial<EligibilityFacts>>({});
  const [compare, setCompare] = React.useState(false);
  const [epoch, setEpoch] = React.useState(0);
  const awaitingBase = React.useRef(false);

  React.useEffect(() => { if (draftDefinition && choice === '') setChoice('draft'); }, [draftDefinition, choice]);
  React.useEffect(() => {
    if (!productId && products.data?.length) {
      const p = products.data.find((x) => x.isActive) ?? products.data[0]!;
      setProductId(p.id);
      setAmount(Math.min(p.maxAmountKobo, Math.max(p.minAmountKobo, 20_000_000)));
      setTenor(Math.min(p.maxTenorMonths, Math.max(p.minTenorMonths, 6)));
      setEpoch((e) => e + 1);
    }
  }, [productId, products.data]);

  const selectedCard = scorecards.data?.find((s) => s.id === choice);
  const activeFor = (key?: string) => scorecards.data?.find((s) => s.status === 'ACTIVE' && (!key || s.key === key)) ?? scorecards.data?.find((s) => s.status === 'ACTIVE');
  const compareTarget = activeFor(selectedCard?.key ?? draftKey);
  const canCompare = !!compareTarget && (choice === 'draft' || (!!selectedCard && selectedCard.id !== compareTarget.id));

  const body = React.useMemo<SimulateRequest | null>(() => {
    if (!productId || !amount || !tenor) return null;
    const b: SimulateRequest = { productId, amountKobo: amount, tenorMonths: tenor };
    if (choice === 'draft' && draftDefinition) b.definition = draftDefinition;
    else if (choice) b.scorecardId = choice;
    if (customer) b.baseCustomerId = customer.id;
    if (Object.keys(overrides).length) b.facts = overrides;
    return b;
  }, [productId, amount, tenor, choice, draftDefinition, customer, overrides]);
  const debounced = useDebounced(body, 400);
  const key = JSON.stringify(debounced);
  const sim = useQuery({
    queryKey: ['simulate', key],
    queryFn: () => post<SimulateResponse>('/eligibility/simulate', debounced),
    enabled: canRun && !!debounced,
    placeholderData: (p) => p,
    retry: false,
  });
  const cmpBody = React.useMemo(() => (debounced && compare && compareTarget ? { ...debounced, definition: undefined, scorecardId: compareTarget.id } : null), [debounced, compare, compareTarget]);
  const cmp = useQuery({
    queryKey: ['simulate-compare', JSON.stringify(cmpBody)],
    queryFn: () => post<SimulateResponse>('/eligibility/simulate', cmpBody),
    enabled: canRun && !!cmpBody && canCompare,
    placeholderData: (p) => p,
    retry: false,
  });

  React.useEffect(() => {
    if (awaitingBase.current && sim.data && !sim.isPlaceholderData) { awaitingBase.current = false; setEpoch((e) => e + 1); }
  }, [sim.data, sim.isPlaceholderData]);

  if (!canRun) return <Callout tone="info">You need the eligibility:run permission to use the simulator.</Callout>;

  const facts = (sim.data?.facts ?? {}) as Partial<EligibilityFacts>;
  const valueOf = (k: keyof EligibilityFacts) => (k in overrides ? overrides[k] : facts[k]);
  const groups = [...new Set(fields.map((f) => f.group))];
  const product = products.data?.find((p) => p.id === productId);
  const remountKey = `${customer?.id ?? 'none'}:${epoch}`;
  const a = sim.data?.result;
  const b = cmp.data?.result;

  return (
    <div className="grid gap-5 xl:grid-cols-[22rem,1fr]" data-testid="simulator">
      <div className="space-y-5 xl:sticky xl:top-20 xl:self-start">
        <SectionCard title="Request">
          <div className="space-y-4">
            <FormField label="Product" htmlFor="sim-product">
              <Select id="sim-product" value={productId} onChange={(e) => { setProductId(e.target.value); const p = products.data?.find((x) => x.id === e.target.value); if (p) { setAmount((a0) => Math.min(p.maxAmountKobo, Math.max(p.minAmountKobo, a0 ?? p.minAmountKobo))); setTenor((t) => Math.min(p.maxTenorMonths, Math.max(p.minTenorMonths, t ?? p.minTenorMonths))); } }}>
                {products.isLoading && <option>Loading…</option>}
                {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isActive ? '' : ' (inactive)'}</option>)}
              </Select>
            </FormField>
            <FormField label="Amount" htmlFor="sim-amount" hint={product ? `Range: ${product.minAmountKobo / 100}-${product.maxAmountKobo / 100}` : undefined}><MoneyInput key={`amt-${epoch}`} id="sim-amount" value={amount} onChange={setAmount} /></FormField>
            <FormField label="Tenor (months)" htmlFor="sim-tenor"><NumberInput id="sim-tenor" value={tenor} onChange={setTenor} /></FormField>
            <FormField label="Scorecard" htmlFor="sim-card">
              <Select id="sim-card" value={choice} onChange={(e) => { setChoice(e.target.value); if (e.target.value === '') setCompare(false); }}>
                <option value="">Active scorecard for the product</option>
                {draftDefinition && <option value="draft">Current unsaved draft</option>}
                {scorecards.data?.map((s) => <option key={s.id} value={s.id}>{s.name} v{s.version} ({s.status})</option>)}
              </Select>
            </FormField>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="sim-compare" className="font-normal">Compare with active scorecard</Label>
              <Switch id="sim-compare" checked={compare && canCompare} disabled={!canCompare} onCheckedChange={setCompare} aria-label="Compare with active scorecard" />
            </div>
            {!canCompare && <p className="text-xs text-muted-foreground">Pick a draft or non-active version to compare it against the active one.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Start from a customer" description="Loads their latest bureau, bank-statement and KYC facts; you can override any of them.">
          <CustomerPicker id="sim-customer" value={customer} onChange={(c) => { setCustomer(c); setOverrides({}); awaitingBase.current = true; }} />
          {customer && <Button size="sm" variant="ghost" className="mt-2" onClick={() => { setCustomer(null); setOverrides({}); awaitingBase.current = true; }}><RotateCcw /> Clear customer</Button>}
        </SectionCard>

        <SectionCard title="Facts" description="Edit any input; results update automatically." actions={Object.keys(overrides).length > 0 && <Button size="sm" variant="ghost" onClick={() => { setOverrides({}); awaitingBase.current = true; }}><RotateCcw /> Reset</Button>}>
          {!sim.data && sim.isLoading ? <Skeleton className="h-40 w-full" /> : (
            <div className="space-y-5">
              {groups.map((g) => (
                <fieldset key={g} className="space-y-3">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</legend>
                  {fields.filter((f) => f.group === g).map((m) => (
                    <FactInput key={m.key} meta={m} remountKey={remountKey} value={valueOf(m.key)} onChange={(v) => setOverrides((o) => ({ ...o, [m.key]: v }))} />
                  ))}
                </fieldset>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="min-w-0 space-y-5" aria-live="polite">
        {sim.isError && !sim.data && <Card><ErrorState message={errorMessage(sim.error)} onRetry={() => sim.refetch()} /></Card>}
        {sim.isError && sim.data && <Callout tone="danger">{errorMessage(sim.error)}</Callout>}
        {!a && sim.isLoading && <Skeleton className="h-96 w-full" />}
        {a && compare && canCompare && (
          <SectionCard title="Draft vs active" description={`${selectedCard ? `${selectedCard.name} v${selectedCard.version}` : 'Current draft'} compared with ${compareTarget?.name} v${compareTarget?.version}`}>
            {!b ? <Skeleton className="h-16 w-full" /> : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="compare-delta">
                <Delta label="Score" a={b.score} b={a.score} fmt={(n) => <span className="tabular">{n}</span>} />
                <Delta label="Max amount" a={b.maxAmountKobo} b={a.maxAmountKobo} fmt={(n) => <MoneyText kobo={n} compact />} />
                <Delta label="DTI" a={b.dtiBps} b={a.dtiBps} better="lower" fmt={(n) => <span className="tabular">{(n / 100).toFixed(1)}%</span>} />
                <div><p className="text-xs text-muted-foreground">Outcome</p><p className="mt-0.5 flex flex-wrap items-center gap-1 text-sm"><OutcomeBadge outcome={b.outcome} /> <span className="text-muted-foreground">→</span> <OutcomeBadge outcome={a.outcome} /></p></div>
              </div>
            )}
          </SectionCard>
        )}
        {a && (compare && canCompare && b ? (
          <div className="grid gap-5 2xl:grid-cols-2">
            <div className="min-w-0 space-y-2"><p className="text-sm font-semibold">Selected: {selectedCard ? `${selectedCard.name} v${selectedCard.version}` : 'Current draft'}</p><EligibilityPanel result={a} dtiLimitBps={(draftDefinition && choice === 'draft' ? draftDefinition : selectedCard?.definition)?.affordability.maxDtiBps} title="Result" /></div>
            <div className="min-w-0 space-y-2"><p className="text-sm font-semibold">Active: {compareTarget?.name} v{compareTarget?.version}</p><EligibilityPanel result={b} dtiLimitBps={compareTarget?.definition.affordability.maxDtiBps} title="Result" /></div>
          </div>
        ) : (
          <EligibilityPanel result={a} dtiLimitBps={(draftDefinition && choice === 'draft' ? draftDefinition : selectedCard?.definition)?.affordability.maxDtiBps} title="Simulation result" />
        ))}
        {sim.isFetching && <p className="text-xs text-muted-foreground">Recalculating…</p>}
      </div>
    </div>
  );
}
