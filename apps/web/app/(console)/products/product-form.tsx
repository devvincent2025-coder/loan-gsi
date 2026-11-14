'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import { buildSchedule, DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type DocumentKind, type InterestMethod, type LoanProductFullDto, type ProductPatchResponse, type ScorecardDto } from '@damez/shared';
import { MoneyInput, MoneyText } from '@/components/money';
import { QuoteSummaryCompact } from './preview';
import { BpsInput, Callout, NumberInput, SectionCard } from '@/components/staff/ui-bits';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField, Input, Label, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/lib/auth';
import { errorMessage, get, patch, post } from '@/lib/api';

export type ProductDraft = Omit<LoanProductFullDto, 'id'>;
export const PRICING_KEYS = ['monthlyRateBps', 'interestMethod', 'processingFeeBps', 'managementFeeBps', 'insuranceFeeBps', 'penaltyBpsPerDay', 'penaltyGraceDays'] as const;

export const BLANK_PRODUCT: ProductDraft = {
  code: '', name: '', description: '', minAmountKobo: 5_000_000, maxAmountKobo: 50_000_000, monthlyRateBps: 450, minTenorMonths: 1, maxTenorMonths: 12,
  isActive: false, interestMethod: 'REDUCING_BALANCE', processingFeeBps: 100, managementFeeBps: 0, insuranceFeeBps: 50, penaltyBpsPerDay: 10, penaltyGraceDays: 3,
  gracePeriodDays: 0, minKycTier: 1, requiredDocs: [], minAge: 18, maxAge: 65, eligibilityOverrides: {}, scorecardKey: 'default', allowGuarantor: false, allowCollateral: false,
};

export function toDraft(p: LoanProductFullDto): ProductDraft {
  const { id: _id, ...rest } = p;
  return { ...rest, requiredDocs: [...rest.requiredDocs] };
}
export function validateProduct(d: ProductDraft, creating: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.name.trim().length < 2) e.name = 'Name is required.';
  if (creating && !/^[A-Z0-9_-]{2,20}$/.test(d.code)) e.code = 'Code: 2-20 chars, A-Z, 0-9, _ or -.';
  if (d.minAmountKobo <= 0) e.minAmountKobo = 'Enter a minimum amount.';
  if (d.maxAmountKobo < d.minAmountKobo) e.maxAmountKobo = 'Maximum must be at least the minimum.';
  if (d.minTenorMonths < 1) e.minTenorMonths = 'At least 1 month.';
  if (d.maxTenorMonths < d.minTenorMonths) e.maxTenorMonths = 'Maximum must be at least the minimum.';
  if (d.monthlyRateBps <= 0) e.monthlyRateBps = 'Rate must be above 0.';
  if (d.minAge < 18) e.minAge = 'Minimum age is 18.';
  if (d.maxAge < d.minAge) e.maxAge = 'Maximum age must be at least the minimum.';
  if (d.minKycTier < 0 || d.minKycTier > 3) e.minKycTier = 'Tier must be 0-3.';
  return e;
}
export function diffProduct(orig: ProductDraft, next: ProductDraft): Partial<ProductDraft> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof ProductDraft)[]) {
    if (JSON.stringify(orig[k]) !== JSON.stringify(next[k])) out[k] = next[k];
  }
  return out as Partial<ProductDraft>;
}

export function ProductForm({ product, onDone }: { product: LoanProductFullDto | null; onDone: (p: LoanProductFullDto) => void }) {
  const qc = useQueryClient();
  const creating = product === null;
  const canEdit = useCan(creating ? 'product:create' : 'product:update');
  const canScorecards = useCan('scorecard:read');
  const original = React.useMemo(() => (product ? toDraft(product) : BLANK_PRODUCT), [product]);
  const [d, setD] = React.useState<ProductDraft>(original);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [approvalId, setApprovalId] = React.useState<string | null>(null);
  const [sampleAmount, setSampleAmount] = React.useState<number | null>(null);
  const [sampleTenor, setSampleTenor] = React.useState<number | null>(null);
  React.useEffect(() => { setD(original); setErrors({}); }, [original]);
  const set = <K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const scorecards = useQuery({ queryKey: ['scorecards'], queryFn: () => get<ScorecardDto[]>('/scorecards'), enabled: canScorecards, retry: false });
  const keys = [...new Set([...(scorecards.data?.map((s) => s.key) ?? []), d.scorecardKey].filter(Boolean))];

  const save = useMutation({
    mutationFn: async () => {
      if (creating) return { product: await post<LoanProductFullDto>('/products', { ...d, isActive: undefined }), approval: null } satisfies ProductPatchResponse;
      return patch<ProductPatchResponse>(`/products/${product!.id}`, diffProduct(original, d));
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      if (r.approval) {
        setApprovalId(r.approval.id);
        toast.info('Pricing changes were submitted for approval');
        // pricing is unchanged until a checker approves: show what the API says is live
        setD(toDraft(r.product));
      } else {
        setApprovalId(null);
        toast.success(creating ? 'Product created (inactive until you activate it)' : 'Product updated');
      }
      onDone(r.product);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const changed = Object.keys(diffProduct(original, d));
  const pricingChanged = changed.filter((k) => (PRICING_KEYS as readonly string[]).includes(k));
  const amt = sampleAmount ?? Math.round((d.minAmountKobo + d.maxAmountKobo) / 2 / 100_00) * 100_00;
  const tenor = Math.min(Math.max(sampleTenor ?? d.maxTenorMonths, d.minTenorMonths), Math.max(d.maxTenorMonths, d.minTenorMonths));
  const preview = React.useMemo(() => {
    try {
      if (amt <= 0 || d.monthlyRateBps <= 0 || tenor < 1) return null;
      return buildSchedule({ principalKobo: amt, monthlyRateBps: d.monthlyRateBps, tenorMonths: tenor, method: d.interestMethod, processingFeeBps: d.processingFeeBps, managementFeeBps: d.managementFeeBps, insuranceFeeBps: d.insuranceFeeBps, graceMonths: Math.floor(d.gracePeriodDays / 30), penaltyBpsPerDay: d.penaltyBpsPerDay, penaltyGraceDays: d.penaltyGraceDays });
    } catch {
      return null;
    }
  }, [amt, tenor, d.monthlyRateBps, d.interestMethod, d.processingFeeBps, d.managementFeeBps, d.insuranceFeeBps, d.gracePeriodDays, d.penaltyBpsPerDay, d.penaltyGraceDays]);

  const submit = () => {
    const e = validateProduct(d, creating);
    setErrors(e);
    if (Object.keys(e).length) return toast.error('Fix the highlighted fields first.');
    if (!creating && changed.length === 0) return toast.info('No changes to save.');
    save.mutate();
  };
  const toggleDoc = (k: DocumentKind, on: boolean) => set('requiredDocs', on ? [...d.requiredDocs, k] : d.requiredDocs.filter((x) => x !== k));

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label={creating ? 'New product' : `Edit ${original.name}`}>
      {approvalId && (
        <Callout tone="info" title="Pricing changes were submitted for approval" data-testid="approval-callout">
          Rate, fee and penalty changes need a checker. The values below remain the live ones until it is approved.{' '}
          <Link href={`/approvals?id=${approvalId}&open=${approvalId}`} className="font-medium text-primary underline-offset-4 hover:underline">Open the approval request</Link>
        </Callout>
      )}
      {!canEdit && <Callout tone="info" icon={<Info className="size-4" aria-hidden />}>Read-only: you need {creating ? 'product:create' : 'product:update'} to edit.</Callout>}
      {!creating && pricingChanged.length > 0 && <Callout tone="warning" title="Pricing change">Saving will submit {pricingChanged.length} pricing field(s) for approval; other edits apply immediately.</Callout>}
      <fieldset disabled={!canEdit || save.isPending} className="space-y-5">
        <SectionCard title="General">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="p-name" required error={errors.name}><Input id="p-name" value={d.name} onChange={(e) => set('name', e.target.value)} /></FormField>
            <FormField label="Code" htmlFor="p-code" required={creating} error={errors.code} hint={creating ? 'Unique, cannot change later' : undefined}>
              <Input id="p-code" value={d.code} disabled={!creating} onChange={(e) => set('code', e.target.value.toUpperCase())} className="font-mono" />
            </FormField>
            <FormField label="Description" htmlFor="p-desc" className="sm:col-span-2"><Textarea id="p-desc" value={d.description} onChange={(e) => set('description', e.target.value)} /></FormField>
            <div className="flex items-center gap-3"><Switch id="p-active" checked={d.isActive} onCheckedChange={(v) => set('isActive', v)} disabled={creating} aria-label="Active" /><Label htmlFor="p-active">Active (available to customers)</Label></div>
          </div>
        </SectionCard>

        <SectionCard title="Pricing" description="Changes to this block go through approval.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Interest method" htmlFor="p-method">
              <Select id="p-method" value={d.interestMethod} onChange={(e) => set('interestMethod', e.target.value as InterestMethod)}><option value="FLAT">Flat</option><option value="REDUCING_BALANCE">Reducing balance</option></Select>
            </FormField>
            <FormField label="Monthly interest rate" htmlFor="p-rate" error={errors.monthlyRateBps}><BpsInput id="p-rate" value={d.monthlyRateBps} onChange={(v) => set('monthlyRateBps', v)} /></FormField>
            <FormField label="Processing fee" htmlFor="p-fee1"><BpsInput id="p-fee1" value={d.processingFeeBps} onChange={(v) => set('processingFeeBps', v)} max={1000} /></FormField>
            <FormField label="Management fee" htmlFor="p-fee2"><BpsInput id="p-fee2" value={d.managementFeeBps} onChange={(v) => set('managementFeeBps', v)} max={1000} /></FormField>
            <FormField label="Insurance fee" htmlFor="p-fee3"><BpsInput id="p-fee3" value={d.insuranceFeeBps} onChange={(v) => set('insuranceFeeBps', v)} max={1000} /></FormField>
            <FormField label="Late penalty per day" htmlFor="p-pen"><BpsInput id="p-pen" value={d.penaltyBpsPerDay} onChange={(v) => set('penaltyBpsPerDay', v)} max={500} /></FormField>
            <FormField label="Penalty grace (days)" htmlFor="p-pgrace"><NumberInput id="p-pgrace" min={0} value={d.penaltyGraceDays} onChange={(v) => set('penaltyGraceDays', v ?? 0)} /></FormField>
            <FormField label="Grace period before first instalment (days)" htmlFor="p-grace"><NumberInput id="p-grace" min={0} value={d.gracePeriodDays} onChange={(v) => set('gracePeriodDays', v ?? 0)} /></FormField>
          </div>
        </SectionCard>

        <SectionCard title="Limits & eligibility">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Minimum amount" htmlFor="p-minamt" error={errors.minAmountKobo}><MoneyInput id="p-minamt" value={d.minAmountKobo} onChange={(v) => set('minAmountKobo', v ?? 0)} /></FormField>
            <FormField label="Maximum amount" htmlFor="p-maxamt" error={errors.maxAmountKobo}><MoneyInput id="p-maxamt" value={d.maxAmountKobo} onChange={(v) => set('maxAmountKobo', v ?? 0)} /></FormField>
            <FormField label="Minimum tenor (months)" htmlFor="p-mint" error={errors.minTenorMonths}><NumberInput id="p-mint" min={1} value={d.minTenorMonths} onChange={(v) => set('minTenorMonths', v ?? 1)} /></FormField>
            <FormField label="Maximum tenor (months)" htmlFor="p-maxt" error={errors.maxTenorMonths}><NumberInput id="p-maxt" min={1} value={d.maxTenorMonths} onChange={(v) => set('maxTenorMonths', v ?? 1)} /></FormField>
            <FormField label="Minimum age" htmlFor="p-minage" error={errors.minAge}><NumberInput id="p-minage" min={18} value={d.minAge} onChange={(v) => set('minAge', v ?? 18)} /></FormField>
            <FormField label="Maximum age" htmlFor="p-maxage" error={errors.maxAge}><NumberInput id="p-maxage" min={18} value={d.maxAge} onChange={(v) => set('maxAge', v ?? 18)} /></FormField>
            <FormField label="Minimum KYC tier" htmlFor="p-tier" error={errors.minKycTier}>
              <Select id="p-tier" value={String(d.minKycTier)} onChange={(e) => set('minKycTier', Number(e.target.value))}>{[0, 1, 2, 3].map((t) => <option key={t} value={t}>{t === 0 ? 'None' : `Tier ${t}`}</option>)}</Select>
            </FormField>
            <FormField label="Scorecard" htmlFor="p-sc">
              {canScorecards && keys.length > 0 ? <Select id="p-sc" value={d.scorecardKey} onChange={(e) => set('scorecardKey', e.target.value)}>{keys.map((k) => <option key={k} value={k}>{k}</option>)}</Select> : <Input id="p-sc" value={d.scorecardKey} onChange={(e) => set('scorecardKey', e.target.value)} />}
            </FormField>
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-medium">Required documents</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Required documents">
                {DOCUMENT_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm"><Checkbox checked={d.requiredDocs.includes(k)} onCheckedChange={(v) => toggleDoc(k, v === true)} aria-label={DOCUMENT_KIND_LABELS[k]} />{DOCUMENT_KIND_LABELS[k]}</label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3"><Switch id="p-guar" checked={d.allowGuarantor} onCheckedChange={(v) => set('allowGuarantor', v)} aria-label="Allow guarantor" /><Label htmlFor="p-guar">Allow guarantor</Label></div>
            <div className="flex items-center gap-3"><Switch id="p-coll" checked={d.allowCollateral} onCheckedChange={(v) => set('allowCollateral', v)} aria-label="Allow collateral" /><Label htmlFor="p-coll">Allow collateral</Label></div>
          </div>
        </SectionCard>
      </fieldset>

      <SectionCard title="Live preview" description="">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Sample amount" htmlFor="pv-amt"><MoneyInput id="pv-amt" value={amt} onChange={setSampleAmount} /></FormField>
          <FormField label="Sample tenor (months)" htmlFor="pv-tenor"><NumberInput id="pv-tenor" min={d.minTenorMonths} max={d.maxTenorMonths} value={tenor} onChange={(v) => setSampleTenor(v)} /></FormField>
        </div>
        {preview ? <QuoteSummaryCompact quote={preview} /> : <p className="text-sm text-muted-foreground">Enter a valid amount, tenor and rate to preview. Sample: <MoneyText kobo={amt} /></p>}
      </SectionCard>

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-2 border-t bg-card/95 px-1 py-3 backdrop-blur">
        {canEdit && <Button type="submit" loading={save.isPending}>{creating ? 'Create product' : 'Save changes'}</Button>}
      </div>
    </form>
  );
}
