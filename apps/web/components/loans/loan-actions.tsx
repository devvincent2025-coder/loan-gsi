'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LoanDetailDto, MakeRepaymentDto, RestructureRequestDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { errorMessage } from '@/lib/api';
import { makeRepayment, recordRecovery, requestRestructure, requestWriteOff } from '@/lib/loans-api';

function invalidateLoan(qc: ReturnType<typeof useQueryClient>, loanId: string) {
  void qc.invalidateQueries({ queryKey: ['loan', loanId] });
  void qc.invalidateQueries({ queryKey: ['loans'] });
}

export function RecordRepaymentDialog({ loan, open, onOpenChange }: { loan: LoanDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = React.useState<number | null>(null);
  const [kind, setKind] = React.useState<MakeRepaymentDto['kind']>('PART');
  const [method, setMethod] = React.useState<MakeRepaymentDto['method']>('MANUAL');
  const [reference, setReference] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { if (!open) { setAmount(null); setKind('PART'); setMethod('MANUAL'); setReference(''); setError(null); } }, [open]);

  const m = useMutation({
    mutationFn: () => makeRepayment(loan.id, { amountKobo: amount!, kind, method, reference: reference.trim() || undefined }),
    onSuccess: (r) => { toast.success(`Repayment recorded (receipt ${r.receiptNumber})`); invalidateLoan(qc, loan.id); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    if (amount === null || amount <= 0) { setError('Enter an amount.'); return; }
    setError(null);
    m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record repayment — {loan.reference}</DialogTitle>
          <DialogDescription>Records a manual, cash or transfer repayment against this loan.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Amount" htmlFor="rp-amount" required error={error ?? undefined}>
            <MoneyInput id="rp-amount" value={amount} onChange={setAmount} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Kind" htmlFor="rp-kind">
              <Select id="rp-kind" value={kind} onChange={(e) => setKind(e.target.value as MakeRepaymentDto['kind'])}>
                <option value="EARLY">Early settlement</option>
                <option value="PART">Part payment</option>
                <option value="TOPUP_NET">Top-up (net of balance)</option>
              </Select>
            </FormField>
            <FormField label="Method" htmlFor="rp-method">
              <Select id="rp-method" value={method} onChange={(e) => setMethod(e.target.value as MakeRepaymentDto['method'])}>
                <option value="MANUAL">Manual</option>
                <option value="CASH">Cash</option>
                <option value="TRANSFER">Transfer</option>
              </Select>
            </FormField>
          </div>
          <FormField label="Reference" htmlFor="rp-reference" hint="Optional — e.g. teller slip or transfer reference">
            <Input id="rp-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button onClick={submit} loading={m.isPending}>Record repayment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RestructureDialog({ loan, open, onOpenChange }: { loan: LoanDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [tenor, setTenor] = React.useState(String(loan.tenorMonths));
  const [rate, setRate] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => { if (!open) { setTenor(String(loan.tenorMonths)); setRate(''); setReason(''); setErrors({}); } }, [open, loan.tenorMonths]);

  const m = useMutation({
    mutationFn: () => {
      const body: RestructureRequestDto = { newTenorMonths: Number(tenor), reason: reason.trim() };
      if (rate.trim()) body.newMonthlyRateBps = Number(rate);
      return requestRestructure(loan.id, body);
    },
    onSuccess: () => { toast.success('Restructure submitted for approval'); invalidateLoan(qc, loan.id); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    const er: Record<string, string> = {};
    const t = Number(tenor);
    if (!Number.isInteger(t) || t <= 0) er.tenor = 'Enter a valid tenor in months.';
    if (rate.trim() && (!Number.isInteger(Number(rate)) || Number(rate) <= 0)) er.rate = 'Enter a valid rate in bps.';
    if (reason.trim().length < 5) er.reason = 'Explain the reason (min 5 characters).';
    setErrors(er);
    if (Object.keys(er).length === 0) m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request restructure — {loan.reference}</DialogTitle>
          <DialogDescription>Submits a maker-checker request. Terms change only once a checker approves it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="New tenor (months)" htmlFor="rs-tenor" required error={errors.tenor}>
              <Input id="rs-tenor" type="number" inputMode="numeric" value={tenor} onChange={(e) => setTenor(e.target.value)} />
            </FormField>
            <FormField label="New monthly rate (bps)" htmlFor="rs-rate" error={errors.rate} hint="Optional — leave blank to keep the current rate">
              <Input id="rs-rate" type="number" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Reason" htmlFor="rs-reason" required error={errors.reason}>
            <Textarea id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button onClick={submit} loading={m.isPending}>Submit for approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WriteOffDialog({ loan, open, onOpenChange }: { loan: LoanDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { if (!open) { setReason(''); setError(null); } }, [open]);

  const m = useMutation({
    mutationFn: () => requestWriteOff(loan.id, reason.trim()),
    onSuccess: () => { toast.success('Write-off submitted for approval'); invalidateLoan(qc, loan.id); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    if (reason.trim().length < 5) { setError('Explain the reason (min 5 characters).'); return; }
    setError(null);
    m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off — {loan.reference}</DialogTitle>
          <DialogDescription>Submits a maker-checker request to write off the outstanding balance. This cannot be undone once approved.</DialogDescription>
        </DialogHeader>
        <FormField label="Reason" htmlFor="wo-reason" required error={error ?? undefined}>
          <Textarea id="wo-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={submit} loading={m.isPending}>Submit write-off</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecoveryDialog({ loan, open, onOpenChange }: { loan: LoanDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = React.useState<number | null>(null);
  const [method, setMethod] = React.useState<'MANUAL' | 'CASH' | 'TRANSFER'>('MANUAL');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { if (!open) { setAmount(null); setMethod('MANUAL'); setError(null); } }, [open]);

  const m = useMutation({
    mutationFn: () => recordRecovery(loan.id, { amountKobo: amount!, method }),
    onSuccess: (r) => { toast.success(`Recovery recorded (receipt ${r.receiptNumber})`); invalidateLoan(qc, loan.id); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    if (amount === null || amount <= 0) { setError('Enter an amount.'); return; }
    setError(null);
    m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record recovery — {loan.reference}</DialogTitle>
          <DialogDescription>Records a post-write-off collection against this loan.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Amount" htmlFor="rc-amount" required error={error ?? undefined}>
            <MoneyInput id="rc-amount" value={amount} onChange={setAmount} />
          </FormField>
          <FormField label="Method" htmlFor="rc-method">
            <Select id="rc-method" value={method} onChange={(e) => setMethod(e.target.value as 'MANUAL' | 'CASH' | 'TRANSFER')}>
              <option value="MANUAL">Manual</option>
              <option value="CASH">Cash</option>
              <option value="TRANSFER">Transfer</option>
            </Select>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button onClick={submit} loading={m.isPending}>Record recovery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
