'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, RotateCw } from 'lucide-react';
import type { ApplicationDetailDto, DisbursementStatus } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/form';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { KeyValue, SectionCard } from '@/components/staff/ui-bits';
import { useCan } from '@/lib/auth';
import { ApiClientError, errorMessage } from '@/lib/api';
import { disburse, disburseManual, getDisbursement } from '@/lib/underwriting-api';

const STATUS_VARIANT: Record<DisbursementStatus, NonNullable<BadgeProps['variant']>> = {
  PENDING: 'secondary', NAME_ENQUIRY_DONE: 'info', PROCESSING: 'warning', SUCCESS: 'success', FAILED: 'destructive', REVERSED: 'destructive',
};

export function DisbursementPanel({ app }: { app: ApplicationDetailDto }) {
  const qc = useQueryClient();
  const canDisburse = useCan('loan:disburse');
  const canDisburseManual = useCan('loan:disburse_manual');
  const [manualOpen, setManualOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: ['disbursement', app.id],
    queryFn: () => getDisbursement(app.id),
    retry: false,
  });
  const notFound = q.isError && q.error instanceof ApiClientError && q.error.statusCode === 404;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['disbursement', app.id] });

  const run = useMutation({
    mutationFn: () => disburse(app.id),
    onSuccess: (d) => {
      qc.setQueryData(['disbursement', app.id], d);
      if (d.status === 'SUCCESS') toast.success('Loan disbursed');
      else if (d.status === 'FAILED') toast.error(d.failureReason ?? 'Disbursement failed');
      else toast.info(`Disbursement status: ${d.status}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const runManual = useMutation({
    mutationFn: () => disburseManual(app.id, reason.trim()),
    onSuccess: () => { toast.success('Manual disbursement submitted for approval'); setManualOpen(false); setReason(''); refresh(); },
    onError: (e) => setErr(errorMessage(e)),
  });

  if (!canDisburse && !canDisburseManual) return null;

  return (
    <SectionCard title="Disbursement" description="Trigger an automated payout, or request a manual disbursement that goes through approval checks.">
      <div className="space-y-4">
        {q.isLoading ? null : notFound ? (
          <p className="text-sm text-muted-foreground">No disbursement has been initiated yet.</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">{errorMessage(q.error)}</p>
        ) : q.data ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KeyValue label="Status"><Badge variant={STATUS_VARIANT[q.data.status]}>{q.data.status}</Badge></KeyValue>
            <KeyValue label="Amount"><MoneyText kobo={q.data.amountKobo} /></KeyValue>
            <KeyValue label="Method">{q.data.method === 'AUTOMATED' ? 'Automated' : 'Manual'}</KeyValue>
            <KeyValue label="Provider ref">{q.data.providerRef ?? '—'}</KeyValue>
            <KeyValue label="Initiated"><DateTime value={q.data.createdAt} style="short" /></KeyValue>
            <KeyValue label="Completed"><DateTime value={q.data.completedAt} style="short" /></KeyValue>
            {q.data.failureReason && <KeyValue label="Failure reason" className="col-span-2 sm:col-span-4">{q.data.failureReason}</KeyValue>}
          </dl>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canDisburse && (!q.data || q.data.status === 'FAILED') && (
            <Button size="sm" loading={run.isPending} onClick={() => run.mutate()}>
              {q.data?.status === 'FAILED' ? <><RotateCw /> Retry disbursement</> : <><Banknote /> Disburse</>}
            </Button>
          )}
          {canDisburseManual && !q.data && (
            <Button size="sm" variant="outline" onClick={() => { setManualOpen(true); setReason(''); setErr(null); }}>Request manual disbursement</Button>
          )}
        </div>
      </div>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Request manual disbursement</DialogTitle>
            <DialogDescription>This submits a maker-checker approval (MANUAL_DISBURSEMENT). A different staff member must approve it before the loan is booked.</DialogDescription>
          </DialogHeader>
          <FormField label="Reason" htmlFor="manual-reason" required error={err ?? undefined}>
            <Textarea id="manual-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)} disabled={runManual.isPending}>Cancel</Button>
            <Button
              loading={runManual.isPending}
              onClick={() => { if (reason.trim().length < 5) return setErr('Give a reason of at least 5 characters.'); setErr(null); runManual.mutate(); }}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
