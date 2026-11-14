'use client';
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LedgerAccountDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { errorMessage } from '@/lib/api';
import { postManualEntry } from '@/lib/finance-api';

interface EditableLine {
  accountCode: string;
  side: 'DEBIT' | 'CREDIT';
  amountKobo: number | null;
}

function emptyLine(): EditableLine {
  return { accountCode: '', side: 'DEBIT', amountKobo: null };
}

export function ManualPostingDialog({ accounts }: { accounts: LedgerAccountDto[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [memo, setMemo] = React.useState('');
  const [date, setDate] = React.useState('');
  const [loanId, setLoanId] = React.useState('');
  const [lines, setLines] = React.useState<EditableLine[]>([emptyLine(), emptyLine()]);
  const [error, setError] = React.useState<string | null>(null);

  const reset = () => {
    setMemo('');
    setDate('');
    setLoanId('');
    setLines([emptyLine(), emptyLine()]);
    setError(null);
  };

  const m = useMutation({
    mutationFn: postManualEntry,
    onSuccess: () => {
      toast.success('Manual posting recorded');
      void qc.invalidateQueries({ queryKey: ['ledger'] });
      setOpen(false);
      reset();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const setLine = (i: number, patch: Partial<EditableLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls));

  const debits = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + (l.amountKobo || 0), 0);
  const credits = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + (l.amountKobo || 0), 0);
  const balanced = debits === credits && debits > 0;

  const submit = () => {
    setError(null);
    if (!memo.trim()) return setError('Memo is required');
    if (lines.some((l) => !l.accountCode || !l.amountKobo || l.amountKobo <= 0)) {
      return setError('Every posting needs an account and a positive amount');
    }
    if (!balanced) return setError('Debits must equal credits');
    m.mutate({
      memo: memo.trim(),
      date: date || undefined,
      loanId: loanId.trim() || undefined,
      postings: lines.map((l) => ({ accountCode: l.accountCode, side: l.side, amountKobo: l.amountKobo! })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Manual posting</Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New manual posting</DialogTitle>
          <DialogDescription>Debits must equal credits. This action is audited.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label="Memo" htmlFor="mp-memo" required>
            <Textarea id="mp-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Date" htmlFor="mp-date" hint="Defaults to today">
              <Input id="mp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField label="Loan ID" htmlFor="mp-loan" hint="Optional">
              <Input id="mp-loan" value={loanId} onChange={(e) => setLoanId(e.target.value)} placeholder="Optional" />
            </FormField>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Postings</span>
              <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus /> Add line</Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1.6fr)_auto_minmax(0,1fr)_auto] items-start gap-2">
                  <Select aria-label="Account" value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })}>
                    <option value="">Select account…</option>
                    {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                  </Select>
                  <Select aria-label="Side" className="w-28" value={l.side} onChange={(e) => setLine(i, { side: e.target.value as 'DEBIT' | 'CREDIT' })}>
                    <option value="DEBIT">Debit</option>
                    <option value="CREDIT">Credit</option>
                  </Select>
                  <MoneyInput aria-label="Amount" value={l.amountKobo} onChange={(kobo) => setLine(i, { amountKobo: kobo })} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => removeLine(i)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs tabular">
              <span className={balanced ? 'text-success' : 'text-muted-foreground'}>
                Debits {(debits / 100).toLocaleString('en-NG')} · Credits {(credits / 100).toLocaleString('en-NG')}
              </span>
              <span className={balanced ? 'text-success' : 'text-destructive'}>{balanced ? 'Balanced' : 'Not balanced'}</span>
            </div>
          </div>

          {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={m.isPending}>Cancel</Button>
          <Button loading={m.isPending} disabled={!balanced} onClick={submit}>Post entry</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
