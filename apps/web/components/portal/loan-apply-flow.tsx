'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, Plus, Trash2 } from 'lucide-react';
import type { EligibilityCustomerDto, LoanQuoteDto, PortalApplicationDto, PortalProductDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { MoneyInput, MoneyText } from '@/components/money';
import { useDebounced } from '@/lib/hooks';
import { isCode, pPost, portalErrorMessage } from '@/lib/portal-api';
import { cn } from '@/lib/utils';
import { ConsentCard } from './consent-card';
import { EligibilityResultView } from './eligibility-result';
import { KEYS, useProducts } from './hooks';
import { QuoteSummary } from './quote-summary';

const STEP_KOBO = 100_000; // ₦1,000 slider steps
const PURPOSES = ['Business', 'Education', 'Medical', 'Rent', 'Personal', 'Other'];
const RELATIONSHIPS = ['Spouse', 'Parent', 'Sibling', 'Child', 'Friend', 'Colleague', 'Employer', 'Other'];
const ID_TYPES = [
  { value: 'NIN', label: 'National ID (NIN)' },
  { value: 'INTL_PASSPORT', label: 'International Passport' },
  { value: 'DRIVERS_LICENSE', label: "Driver's Licence" },
  { value: 'VOTERS_CARD', label: "Voter's Card" },
];

export function ProductCard({ p, selected, onSelect }: { p: PortalProductDto; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button" disabled={!p.available} onClick={onSelect} aria-pressed={selected} data-testid={`product-${p.code}`} data-available={p.available}
      className={cn('w-full rounded-lg border bg-card p-4 text-left shadow-card transition-colors', selected && 'border-primary ring-2 ring-primary/30', !p.available && 'cursor-not-allowed opacity-60 grayscale', p.available && !selected && 'hover:border-primary/50')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{p.name}</p>
        {!p.available && <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Locked" />}
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">{p.description}</p>
      <p className="mt-2 text-sm"><MoneyText kobo={p.minAmountKobo} compact /> to <MoneyText kobo={p.maxAmountKobo} compact /> · {p.minTenorMonths}-{p.maxTenorMonths} months · {(p.monthlyRateBps / 100).toFixed(2)}% a month</p>
      <p className="mt-1 text-xs text-muted-foreground">{p.feesSummary}</p>
      {!p.available && <p className="mt-2 text-xs font-medium text-warning">{p.lockedReason ?? `Complete Tier ${p.minKycTier} to unlock`}{p.lockedReason && !/tier/i.test(p.lockedReason) ? ` (complete Tier ${p.minKycTier})` : ''}</p>}
    </button>
  );
}

/* ── Guarantor form ── */

interface GuarantorInput {
  firstName: string; lastName: string; phone: string; relationship: string;
  occupation: string; address: string; city: string; state: string; idType: string;
}

const EMPTY_GUARANTOR: GuarantorInput = { firstName: '', lastName: '', phone: '', relationship: 'Friend', occupation: '', address: '', city: '', state: '', idType: '' };

function GuarantorForm({ idx, value, onChange, onRemove }: { idx: number; value: GuarantorInput; onChange: (v: GuarantorInput) => void; onRemove?: () => void }) {
  const set = (k: keyof GuarantorInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Guarantor {idx + 1}</p>
          {onRemove && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={onRemove}><Trash2 className="size-4" /></Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="First name" htmlFor={`g${idx}-fn`}><Input id={`g${idx}-fn`} value={value.firstName} onChange={set('firstName')} placeholder="First name" /></FormField>
          <FormField label="Last name" htmlFor={`g${idx}-ln`}><Input id={`g${idx}-ln`} value={value.lastName} onChange={set('lastName')} placeholder="Last name" /></FormField>
          <FormField label="Phone number" htmlFor={`g${idx}-ph`}><Input id={`g${idx}-ph`} value={value.phone} onChange={set('phone')} placeholder="0801 234 5678" type="tel" /></FormField>
          <FormField label="Relationship" htmlFor={`g${idx}-rel`}>
            <Select id={`g${idx}-rel`} value={value.relationship} onChange={set('relationship')}>
              {RELATIONSHIPS.map((r) => <option key={r} value={r.toUpperCase().replace(' ', '_')}>{r}</option>)}
            </Select>
          </FormField>
          <FormField label="Occupation" htmlFor={`g${idx}-occ`}><Input id={`g${idx}-occ`} value={value.occupation} onChange={set('occupation')} placeholder="Occupation (optional)" /></FormField>
          <FormField label="ID type" htmlFor={`g${idx}-id`}>
            <Select id={`g${idx}-id`} value={value.idType} onChange={set('idType')}>
              <option value="">Select ID type (optional)</option>
              {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Home address" htmlFor={`g${idx}-addr`}><Input id={`g${idx}-addr`} value={value.address} onChange={set('address')} placeholder="Street address" /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="City" htmlFor={`g${idx}-city`}><Input id={`g${idx}-city`} value={value.city} onChange={set('city')} placeholder="City" /></FormField>
          <FormField label="State" htmlFor={`g${idx}-state`}><Input id={`g${idx}-state`} value={value.state} onChange={set('state')} placeholder="State" /></FormField>
        </div>
      </CardContent>
    </Card>
  );
}

function isGuarantorValid(g: GuarantorInput): boolean {
  return !!(g.firstName.trim() && g.lastName.trim() && g.phone.trim() && g.relationship && g.address.trim() && g.city.trim() && g.state.trim());
}

/* ── main flow ── */

type Stage = 'form' | 'collateral' | 'guarantors' | 'result';

export function LoanApplyFlow() {
  const router = useRouter();
  const qc = useQueryClient();
  const products = useProducts();
  const [productId, setProductId] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState<number | null>(null);
  const [amountKey, setAmountKey] = React.useState(0);
  const [tenor, setTenor] = React.useState<number | null>(null);
  const [purpose, setPurpose] = React.useState('Personal');
  const [selfIncome, setSelfIncome] = React.useState<number | null>(null);
  const [selfOutstanding, setSelfOutstanding] = React.useState<number | null>(null);
  const [stockDesc, setStockDesc] = React.useState('');
  const [propertyDesc, setPropertyDesc] = React.useState('');
  const [guarantors, setGuarantors] = React.useState<GuarantorInput[]>([{ ...EMPTY_GUARANTOR }]);
  const [stage, setStage] = React.useState<Stage>('form');
  const [result, setResult] = React.useState<EligibilityCustomerDto | null>(null);
  const [needConsent, setNeedConsent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [accepted, setAccepted] = React.useState(false);

  const product = products.data?.find((p) => p.id === productId) ?? null;
  const setAmountExternal = (k: number | null) => { setAmount(k); setAmountKey((n) => n + 1); };

  const choose = (p: PortalProductDto) => {
    setProductId(p.id);
    const start = Math.min(p.maxAmountKobo, Math.max(p.minAmountKobo, Math.round(((p.minAmountKobo + p.maxAmountKobo) / 4) / STEP_KOBO) * STEP_KOBO));
    setAmountExternal(start);
    setTenor(Math.min(p.maxTenorMonths, Math.max(p.minTenorMonths, 3)));
    setStage('form');
    setResult(null);
  };

  const amountOk = !!product && amount !== null && amount >= product.minAmountKobo && amount <= product.maxAmountKobo;
  const tenorOk = !!product && tenor !== null && tenor >= product.minTenorMonths && tenor <= product.maxTenorMonths;
  const valid = amountOk && tenorOk;

  // live preview: debounced so slider drags do not hammer the API
  const dAmount = useDebounced(amount, 350);
  const dTenor = useDebounced(tenor, 350);
  const dValid = !!product && dAmount !== null && dTenor !== null && dAmount >= product.minAmountKobo && dAmount <= product.maxAmountKobo && dTenor >= product.minTenorMonths && dTenor <= product.maxTenorMonths;
  const preview = useQuery({
    queryKey: ['portal', 'schedule-preview', productId, dAmount, dTenor],
    queryFn: () => pPost<LoanQuoteDto>('/loans/schedule-preview', { productId, amountKobo: dAmount, tenorMonths: dTenor }),
    enabled: dValid && stage === 'form',
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const check = useMutation({
    mutationFn: (v: { productId: string; amountKobo: number; tenorMonths: number }) => pPost<EligibilityCustomerDto>('/eligibility/preview', v),
    onSuccess: (r) => { setResult(r); setStage('result'); setNeedConsent(false); setError(null); setAccepted(false); },
    onError: (e) => {
      if (isCode(e, 'CONSENT_REQUIRED')) { setNeedConsent(true); setError(null); } else setError(portalErrorMessage(e));
    },
  });
  const runCheck = (over?: { productId?: string; amountKobo?: number; tenorMonths?: number }) => {
    const v = { productId: over?.productId ?? productId, amountKobo: over?.amountKobo ?? amount, tenorMonths: over?.tenorMonths ?? tenor };
    if (v.productId && v.amountKobo && v.tenorMonths) check.mutate({ productId: v.productId, amountKobo: v.amountKobo, tenorMonths: v.tenorMonths });
  };

  const guarantorPayload = guarantors.filter(isGuarantorValid).map((g) => ({
    firstName: g.firstName.trim(), lastName: g.lastName.trim(), phone: g.phone.trim(),
    relationship: g.relationship, occupation: g.occupation.trim() || undefined,
    address: { line1: g.address.trim(), city: g.city.trim(), state: g.state.trim() },
    idType: g.idType || undefined,
  }));

  const submit = useMutation({
    mutationFn: () => pPost<PortalApplicationDto>('/applications', {
      productId, amountKobo: amount, tenorMonths: tenor, purpose, acceptDisclosure: true,
      selfReportedIncomeKobo: selfIncome ?? undefined,
      selfReportedOutstandingKobo: selfOutstanding ?? undefined,
      collateralStockDesc: stockDesc.trim() || undefined,
      collateralPropertyDesc: propertyDesc.trim() || undefined,
      guarantors: product?.allowGuarantor && guarantorPayload.length ? guarantorPayload : undefined,
    }),
    onSuccess: (a) => { void qc.invalidateQueries({ queryKey: KEYS.applications }); router.push(`/portal/loans/${a.id}`); },
    onError: (e) => setError(portalErrorMessage(e)),
  });

  const proceedFromForm = () => {
    if (!valid) return;
    if (product?.allowCollateral) { setStage('collateral'); return; }
    if (product?.allowGuarantor) { setStage('guarantors'); return; }
    runCheck();
  };

  const proceedFromCollateral = () => {
    if (product?.allowGuarantor) { setStage('guarantors'); return; }
    runCheck();
  };

  if (products.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
  if (products.isError) return <ErrorState message={portalErrorMessage(products.error)} onRetry={() => void products.refetch()} />;
  if (!products.data?.length) return <Card><EmptyState title="No loan products available" description="Please check back soon." /></Card>;

  /* ── result stage ── */
  if (stage === 'result' && result) {
    const canSubmit = result.outcome !== 'INELIGIBLE';
    const applyChange = (c: { amountKobo?: number; tenorMonths?: number }) => {
      const a = c.amountKobo ?? amount ?? 0;
      const t = c.tenorMonths ?? tenor ?? 0;
      setAmountExternal(a); setTenor(t); runCheck({ amountKobo: a, tenorMonths: t });
    };
    const applyAlt = (alt: EligibilityCustomerDto['alternatives'][number]) => {
      setProductId(alt.productId); setAmountExternal(alt.amountKobo); setTenor(alt.tenorMonths);
      runCheck({ productId: alt.productId, amountKobo: alt.amountKobo, tenorMonths: alt.tenorMonths });
    };
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setStage('form')}><ArrowLeft /> Change my loan details</Button>
        <p className="text-sm text-muted-foreground">{product?.name}: <MoneyText kobo={amount} trimZeroKobo className="font-medium text-foreground" /> over {tenor} months</p>
        <div className={check.isPending ? 'opacity-60' : undefined} aria-busy={check.isPending}>
          <EligibilityResultView result={result} onApplySuggestion={applyChange} onApplyAlternative={applyAlt} />
        </div>
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        {canSubmit && (
          <Card><CardContent className="space-y-4 p-4">
            {preview.data && <p className="text-sm">You will pay <MoneyText kobo={preview.data.cost.monthlyInstalmentKobo} trimZeroKobo className="font-semibold" /> a month and <MoneyText kobo={preview.data.cost.totalRepayableKobo} trimZeroKobo className="font-semibold" /> in total.</p>}
            <div className="flex items-start gap-3">
              <Checkbox id="disclosure" className="mt-0.5 size-5" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} />
              <label htmlFor="disclosure" className="text-sm leading-snug">I have read the total cost of credit (interest, fees and the repayment schedule) and I understand what I will pay.</label>
            </div>
            <Button size="lg" className="w-full" disabled={!accepted || check.isPending} loading={submit.isPending} onClick={() => { setError(null); submit.mutate(); }}>Submit application</Button>
          </CardContent></Card>
        )}
      </div>
    );
  }

  /* ── guarantors stage ── */
  if (stage === 'guarantors' && product?.allowGuarantor) {
    const allValid = guarantors.every(isGuarantorValid);
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setStage(product.allowCollateral ? 'collateral' : 'form')}><ArrowLeft /> Back</Button>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Guarantor details</h2>
          <p className="text-sm text-muted-foreground">This loan requires at least one guarantor. They will co-sign your application.</p>
        </div>
        <div className="space-y-4">
          {guarantors.map((g, i) => (
            <GuarantorForm key={i} idx={i} value={g} onChange={(v) => setGuarantors((gs) => gs.map((x, j) => j === i ? v : x))} onRemove={guarantors.length > 1 ? () => setGuarantors((gs) => gs.filter((_, j) => j !== i)) : undefined} />
          ))}
          {guarantors.length < 2 && (
            <Button type="button" variant="outline" className="w-full" onClick={() => setGuarantors((gs) => [...gs, { ...EMPTY_GUARANTOR }])}>
              <Plus className="mr-2 size-4" /> Add second guarantor
            </Button>
          )}
        </div>
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <Button size="lg" className="w-full" disabled={!allValid} onClick={() => { setError(null); runCheck(); }}>Check my eligibility</Button>
        {product && needConsent && <ConsentCard purpose="BUREAU_PULL" agreeLabel="I agree and check my eligibility" explain="To give you a fair decision we need to check your credit history with licensed bureaus." onGranted={() => runCheck()} />}
      </div>
    );
  }

  /* ── collateral stage ── */
  if (stage === 'collateral' && product?.allowCollateral) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setStage('form')}><ArrowLeft /> Back to loan details</Button>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Collateral information</h2>
          <p className="text-sm text-muted-foreground">Describe the assets you are pledging as security for this loan. You can provide stock/securities, property, or both.</p>
        </div>
        <Card><CardContent className="space-y-4 p-4">
          <FormField label="Stock / securities (optional)" htmlFor="stock-desc" hint="e.g. NSE shares, Stanbic IBTC funds — include name, volume and estimated value">
            <Textarea id="stock-desc" value={stockDesc} onChange={(e) => setStockDesc(e.target.value)} placeholder="Describe your stock or securities holdings…" rows={3} />
          </FormField>
          <FormField label="Property (optional)" htmlFor="prop-desc" hint="e.g. residential property at 12 Adeola Street, Lagos — include estimated market value">
            <Textarea id="prop-desc" value={propertyDesc} onChange={(e) => setPropertyDesc(e.target.value)} placeholder="Describe the property you are pledging…" rows={3} />
          </FormField>
          <FormField label="Monthly income (optional)" htmlFor="self-income" hint="Self-reported net monthly income — helps us give you a faster decision">
            <MoneyInput id="self-income" value={selfIncome} onChange={setSelfIncome} />
          </FormField>
          <FormField label="Outstanding loan balance (optional)" htmlFor="self-outstanding" hint="Total amount you currently owe on other loans">
            <MoneyInput id="self-outstanding" value={selfOutstanding} onChange={setSelfOutstanding} />
          </FormField>
        </CardContent></Card>
        <Button size="lg" className="w-full" onClick={proceedFromCollateral}>
          {product.allowGuarantor ? 'Next: Guarantor details' : 'Check my eligibility'}
        </Button>
      </div>
    );
  }

  /* ── form stage ── */
  const sliderMin = product ? Math.ceil(product.minAmountKobo / STEP_KOBO) : 0;
  const sliderMax = product ? Math.floor(product.maxAmountKobo / STEP_KOBO) : 0;
  const tenors = product ? Array.from({ length: product.maxTenorMonths - product.minTenorMonths + 1 }, (_, i) => product.minTenorMonths + i) : [];
  const stepCount = 3 + (product?.allowCollateral ? 1 : 0) + (product?.allowGuarantor ? 1 : 0);
  const currentStep = 3;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Apply for a loan</h1>
        <p className="text-sm text-muted-foreground">Pick a product, choose an amount and see exactly what you will pay.</p>
      </div>

      <section aria-labelledby="s-product" className="space-y-2">
        <h2 id="s-product" className="text-sm font-semibold">1. Choose a loan</h2>
        <div className="grid gap-3 md:grid-cols-2">{products.data.map((p) => <ProductCard key={p.id} p={p} selected={p.id === productId} onSelect={() => choose(p)} />)}</div>
      </section>

      {product && (
        <section aria-labelledby="s-amount" className="space-y-4">
          <h2 id="s-amount" className="text-sm font-semibold">2. How much and for how long?</h2>
          <FormField label="Amount" htmlFor="amount" error={amount !== null && !amountOk ? `Choose between ${formatRange(product)}` : undefined}>
            <MoneyInput key={amountKey} id="amount" value={amount} onChange={setAmount} className="h-12 text-lg font-semibold" aria-label="Loan amount" />
          </FormField>
          {sliderMax > sliderMin && (
            <input
              type="range" aria-label="Loan amount slider" className="w-full accent-[hsl(var(--primary))]" min={sliderMin} max={sliderMax} step={1}
              value={Math.min(sliderMax, Math.max(sliderMin, Math.round((amount ?? product.minAmountKobo) / STEP_KOBO)))}
              onChange={(e) => setAmountExternal(Number(e.target.value) * STEP_KOBO)}
            />
          )}
          <FormField label="Repayment period" htmlFor="tenor">
            {tenors.length <= 12 ? (
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Repayment period in months">
                {tenors.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tenor === t} onClick={() => setTenor(t)} className={cn('h-11 rounded-md border text-sm font-medium', tenor === t ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}>{t} mo</button>
                ))}
              </div>
            ) : (
              <Select id="tenor" className="h-12 text-base" value={tenor ?? ''} onChange={(e) => setTenor(Number(e.target.value))}>{tenors.map((t) => <option key={t} value={t}>{t} months</option>)}</Select>
            )}
          </FormField>
          <FormField label="What is the loan for?" htmlFor="purpose">
            <Select id="purpose" className="h-12 text-base" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{PURPOSES.map((p) => <option key={p}>{p}</option>)}</Select>
          </FormField>
        </section>
      )}

      {product && (
        <section aria-labelledby="s-preview" className="space-y-3">
          <h2 id="s-preview" className="text-sm font-semibold">{currentStep}. Your repayment plan</h2>
          {!valid ? <p className="text-sm text-muted-foreground">Enter an amount and period within the limits to see your plan.</p>
            : preview.data ? <QuoteSummary quote={preview.data} loading={preview.isFetching} />
            : preview.isError ? <ErrorState message={portalErrorMessage(preview.error)} onRetry={() => void preview.refetch()} />
            : <Skeleton className="h-52 w-full" />}
        </section>
      )}

      {product && !product.allowCollateral && !product.allowGuarantor && needConsent && (
        <ConsentCard purpose="BUREAU_PULL" agreeLabel="I agree and check my eligibility" explain="To give you a fair decision we need to check your credit history with licensed bureaus." onGranted={() => runCheck()} />
      )}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      {product && (
        <Button size="lg" className="h-12 w-full text-base" disabled={!valid} loading={check.isPending && stage === 'form'} onClick={() => { setError(null); proceedFromForm(); }}>
          {product.allowCollateral ? `Next: Collateral (${stepCount - currentStep} more step${stepCount - currentStep !== 1 ? 's' : ''})` : product.allowGuarantor ? 'Next: Guarantor details' : 'Check my eligibility'}
        </Button>
      )}
      <p className="text-center text-xs text-muted-foreground">Checking eligibility does not commit you to anything. <Link href="/portal/loans" className="underline">My loans</Link></p>
    </div>
  );
}

function formatRange(p: PortalProductDto) {
  const f = (k: number) => `₦${(k / 100).toLocaleString('en-NG')}`;
  return `${f(p.minAmountKobo)} and ${f(p.maxAmountKobo)}`;
}
