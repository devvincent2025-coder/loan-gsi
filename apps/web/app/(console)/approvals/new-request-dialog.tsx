'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { approvalSubmitSchema, type ApprovalActionType, type ApprovalDto, type ApprovalTypeDto, type LoanProductDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { errorMessage, get, post } from '@/lib/api';

export interface Prefill { type: string; productId?: string }

export function buildPayload(type: string, opts: { productId: string; rateBps: string; json: string }): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (type === 'PRODUCT_RATE_CHANGE') {
    const bps = Number(opts.rateBps);
    if (!opts.productId) return { ok: false, error: 'Choose a product' };
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return { ok: false, error: 'Enter the new monthly rate in basis points (e.g. 450 = 4.50%)' };
    return { ok: true, payload: { productId: opts.productId, newMonthlyRateBps: bps } };
  }
  if (!opts.json.trim()) return { ok: true, payload: {} };
  try {
    const v = JSON.parse(opts.json) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, error: 'Payload must be a JSON object' };
    return { ok: true, payload: v as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'Payload is not valid JSON' };
  }
}

export function NewRequestDialog({ open, onOpenChange, types, prefill }: { open: boolean; onOpenChange: (o: boolean) => void; types: ApprovalTypeDto[]; prefill?: Prefill }) {
  const qc = useQueryClient();
  const [type, setType] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [amount, setAmount] = React.useState<number | null>(null);
  const [productId, setProductId] = React.useState('');
  const [rateBps, setRateBps] = React.useState('');
  const [json, setJson] = React.useState('{}');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const products = useQuery({ queryKey: ['products'], queryFn: () => get<LoanProductDto[]>('/settings/products'), enabled: open && type === 'PRODUCT_RATE_CHANGE' });
  const meta = types.find((t) => t.type === type);

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setType(prefill?.type ?? '');
    setProductId(prefill?.productId ?? '');
    setSummary(''); setReason(''); setAmount(null); setRateBps(''); setJson('{}');
  }, [open, prefill]);

  const selected = products.data?.find((p) => p.id === productId);
  React.useEffect(() => {
    if (selected && type === 'PRODUCT_RATE_CHANGE') {
      setRateBps((r) => r || String(selected.monthlyRateBps));
      setSummary((s) => s || `Change ${selected.name} monthly rate`);
    }
  }, [selected, type]);

  const m = useMutation({
    mutationFn: (body: unknown) => post<ApprovalDto>('/approvals', body),
    onSuccess: () => { toast.success('Request submitted for approval'); void qc.invalidateQueries({ queryKey: ['approvals'] }); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!type) errs.type = 'Choose a request type';
    const p = buildPayload(type, { productId, rateBps, json });
    if (!p.ok) errs.payload = p.error;
    if (meta?.hasAmount && amount === null) errs.amount = 'Enter an amount';
    const body = { type, summary, reason: reason || undefined, amountKobo: meta?.hasAmount ? (amount ?? undefined) : undefined, payload: p.ok ? p.payload : {} };
    const parsed = approvalSubmitSchema.safeParse(body);
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
    setErrors(errs);
    if (Object.keys(errs).length === 0) m.mutate(parsed.success ? parsed.data : body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New approval request</DialogTitle><DialogDescription>A different person with sufficient limit must approve this.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <FormField label="Type" htmlFor="nr-type" required error={errors.type} hint={meta?.description}>
            <Select id="nr-type" value={type} onChange={(e) => setType(e.target.value as ApprovalActionType)}><option value="">Select type…</option>{types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select>
          </FormField>
          <FormField label="Summary" htmlFor="nr-summary" required error={errors.summary}><Input id="nr-summary" value={summary} onChange={(e) => setSummary(e.target.value)} /></FormField>
          {meta?.hasAmount && <FormField label="Amount" htmlFor="nr-amount" required error={errors.amount}><MoneyInput id="nr-amount" value={amount} onChange={setAmount} /></FormField>}
          {type === 'PRODUCT_RATE_CHANGE' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Product" htmlFor="nr-product" required><Select id="nr-product" value={productId} onChange={(e) => { setProductId(e.target.value); setRateBps(''); }}><option value="">Select product…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
              <FormField label="New monthly rate (bps)" htmlFor="nr-bps" required error={errors.payload} hint={selected ? `Current: ${selected.monthlyRateBps} bps (${(selected.monthlyRateBps / 100).toFixed(2)}%)` : '450 = 4.50% per month'}>
                <Input id="nr-bps" inputMode="numeric" value={rateBps} onChange={(e) => setRateBps(e.target.value)} />
              </FormField>
            </div>
          ) : type ? (
            <FormField label="Payload (JSON)" htmlFor="nr-json" error={errors.payload}><Textarea id="nr-json" className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} /></FormField>
          ) : null}
          <FormField label="Reason" htmlFor="nr-reason" error={errors.reason}><Textarea id="nr-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>Submit request</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
