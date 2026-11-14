'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, MessageSquareWarning, Send, ShieldQuestion, XCircle } from 'lucide-react';
import type { ApplicationDetailDto, DecisionAction, StaffDirectoryEntryDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { NumberInput, SectionCard } from '@/components/staff/ui-bits';
import { StaffToPicker } from '@/components/staff/staff-to-picker';
import { errorMessage } from '@/lib/api';
import { decideApplication } from '@/lib/underwriting-api';

const ACTION_META: Record<DecisionAction, { label: string; icon: React.ComponentType<{ className?: string }>; variant: 'default' | 'outline' | 'destructive'; description: string }> = {
  APPROVE: { label: 'Approve', icon: CheckCircle2, variant: 'default', description: 'Approve this application at the requested amount and tenor.' },
  REJECT: { label: 'Reject', icon: XCircle, variant: 'destructive', description: 'Reject this application. A reason is required and is kept in the event history.' },
  REFER: { label: 'Refer', icon: ShieldQuestion, variant: 'outline', description: 'Refer this application to another reviewer or committee, with a note.' },
  REQUEST_INFO: { label: 'Request info', icon: MessageSquareWarning, variant: 'outline', description: 'Ask the customer or branch for more information before deciding.' },
  COUNTER_OFFER: { label: 'Counter-offer', icon: Send, variant: 'outline', description: 'Approve at a different amount and/or tenor than requested.' },
};

export function DecisionPanel({ app, onUpdated }: { app: ApplicationDetailDto; onUpdated: (a: ApplicationDetailDto) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState<DecisionAction | null>(null);
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const [amountKobo, setAmountKobo] = React.useState<number | null>(app.amountKobo);
  const [tenorMonths, setTenorMonths] = React.useState<number | null>(app.tenorMonths);
  const [assignees, setAssignees] = React.useState<StaffDirectoryEntryDto[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (action: DecisionAction) =>
      decideApplication(app.id, {
        action,
        reason: reason.trim() || undefined,
        note: note.trim() || undefined,
        amountKobo: action === 'COUNTER_OFFER' ? (amountKobo ?? undefined) : undefined,
        tenorMonths: action === 'COUNTER_OFFER' ? (tenorMonths ?? undefined) : undefined,
        assigneeIds: action === 'REFER' ? assignees.map((s) => s.id) : undefined,
      }),
    onSuccess: (a, action) => {
      toast.success(`Decision recorded: ${ACTION_META[action].label}`);
      setOpen(null);
      setReason('');
      setNote('');
      setAssignees([]);
      onUpdated(a);
      void qc.invalidateQueries({ queryKey: ['application-notes', app.id] });
      void qc.invalidateQueries({ queryKey: ['underwriting-queue'] });
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  const openDialog = (action: DecisionAction) => {
    setOpen(action);
    setErr(null);
    setReason('');
    setNote('');
    setAssignees([]);
    setAmountKobo(app.amountKobo);
    setTenorMonths(app.tenorMonths);
  };

  const submit = () => {
    if (!open) return;
    if (open === 'REJECT' && reason.trim().length < 3) return setErr('Give a reason of at least 3 characters.');
    if (open === 'REFER' && assignees.length === 0) return setErr('Pick 1 or 2 staff members to refer this application to.');
    if ((open === 'REFER' || open === 'REQUEST_INFO') && note.trim().length < 3) return setErr('Give a note of at least 3 characters.');
    if (open === 'COUNTER_OFFER' && (!amountKobo || !tenorMonths)) return setErr('Enter both an amount and a tenor.');
    setErr(null);
    decide.mutate(open);
  };

  const meta = open ? ACTION_META[open] : null;

  return (
    <SectionCard title="Decision" description="Record an underwriting decision for this application.">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ACTION_META) as DecisionAction[]).map((action) => {
          const { label, icon: Icon, variant } = ACTION_META[action];
          return (
            <Button key={action} size="sm" variant={variant} onClick={() => openDialog(action)}>
              <Icon /> {label}
            </Button>
          );
        })}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{meta?.label}</DialogTitle>
            <DialogDescription>{meta?.description}</DialogDescription>
          </DialogHeader>

          {(open === 'APPROVE' || open === 'REJECT') && (
            <FormField label="Reason" htmlFor="dec-reason" required={open === 'REJECT'}>
              <Textarea id="dec-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          )}

          {open === 'REFER' && (
            <FormField label="To" htmlFor="dec-assignees" required>
              <StaffToPicker value={assignees} onChange={setAssignees} max={2} id="dec-assignees" placeholder="Search staff by name or email…" autoFocus />
            </FormField>
          )}

          {(open === 'REFER' || open === 'REQUEST_INFO') && (
            <FormField label="Note" htmlFor="dec-note" required>
              <Textarea id="dec-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          )}

          {open === 'COUNTER_OFFER' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Amount" htmlFor="dec-amount" required>
                  <MoneyInput id="dec-amount" value={amountKobo} onChange={setAmountKobo} />
                </FormField>
                <FormField label="Tenor (months)" htmlFor="dec-tenor" required>
                  <NumberInput id="dec-tenor" value={tenorMonths} onChange={setTenorMonths} min={1} max={120} />
                </FormField>
              </div>
              <FormField label="Note (optional)" htmlFor="dec-note-2">
                <Textarea id="dec-note-2" value={note} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            </>
          )}

          {err && <p role="alert" className="text-xs font-medium text-destructive">{err}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={decide.isPending}>Cancel</Button>
            <Button variant={meta?.variant} loading={decide.isPending} onClick={submit}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
