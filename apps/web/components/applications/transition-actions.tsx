'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightCircle, RotateCw } from 'lucide-react';
import type { AllowedTransitionDto, ApplicationDetailDto, ApplicationStatus } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/form';
import { Tooltip } from '@/components/ui/tooltip';
import { useCan, useMe } from '@/lib/auth';
import { errorMessage, post } from '@/lib/api';
import { isNotImplemented } from '@/lib/staff-api-extra';
import { statusLabel } from './application-ui';

export function TransitionActions({ app, onUpdated }: { app: ApplicationDetailDto; onUpdated: (a: ApplicationDetailDto) => void }) {
  const me = useMe();
  const canReassess = useCan('eligibility:run');
  const [pending, setPending] = React.useState<AllowedTransitionDto | null>(null);
  const [reason, setReason] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);

  const transition = useMutation({
    mutationFn: (t: AllowedTransitionDto) => post<ApplicationDetailDto>(`/applications/${app.id}/transition`, { to: t.to, reason: reason.trim() || undefined }),
    onSuccess: (a, t) => { toast.success(`Application moved to ${statusLabel(t.to)}`); setPending(null); setReason(''); onUpdated(a); },
    onError: (e) => {
      if (isNotImplemented(e)) { toast.info('This step is not available yet. It arrives with the next build phase.'); setPending(null); }
      else toast.error(errorMessage(e));
    },
  });
  const reassess = useMutation({
    mutationFn: () => post<ApplicationDetailDto>(`/applications/${app.id}/reassess`),
    onSuccess: (a) => { toast.success('Eligibility re-assessed'); onUpdated(a); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const run = (t: AllowedTransitionDto) => {
    if (t.requiresReason) { setPending(t); setReason(''); setErr(null); } else transition.mutate(t);
  };

  // As of prompt 3, these targets are rejected by the generic transition endpoint (409 USE_DEDICATED_ENDPOINT) and are
  // handled by dedicated panels instead: APPROVED/OFFER_SENT/OFFER_ACCEPTED/DISBURSED by the Decision/Offer/Disbursement
  // panels on this page, and RESTRUCTURED/Unpaid/CLOSED/WRITTEN_OFF by the Loans section (reached from a booked loan).
  const DEDICATED_FLOW_TARGETS = new Set<ApplicationStatus>([
    'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED', 'CLOSED', 'WRITTEN_OFF',
  ]);
  const visibleTransitions = app.allowedTransitions.filter((t) => !DEDICATED_FLOW_TARGETS.has(t.to));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="transition-actions">
      {visibleTransitions.map((t) => {
        const allowed = !t.permission || me.permissions.includes(t.permission);
        const disabled = !t.implemented || !allowed;
        const tip = !t.implemented ? 'Prompt 3: not implemented yet' : !allowed ? `Requires ${t.permission}` : undefined;
        const destructive = ['REJECTED', 'CANCELLED', 'WRITTEN_OFF'].includes(t.to);
        return (
          <Tooltip key={t.to} content={tip} disabled={!tip}>
            <span>
              <Button size="sm" variant={destructive ? 'outline' : 'default'} disabled={disabled} loading={transition.isPending && transition.variables?.to === t.to && !pending} onClick={() => run(t)}>
                <ArrowRightCircle /> {t.label}
              </Button>
            </span>
          </Tooltip>
        );
      })}
      {visibleTransitions.length === 0 && <span className="text-sm text-muted-foreground">No actions available.</span>}
      {canReassess && (
        <Button size="sm" variant="outline" loading={reassess.isPending} onClick={() => reassess.mutate()}><RotateCw /> Re-assess eligibility</Button>
      )}
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>{pending?.label}</DialogTitle><DialogDescription>{pending ? `Move ${app.reference} to ${statusLabel(pending.to)}. A reason is required and is kept in the event history.` : ''}</DialogDescription></DialogHeader>
          <FormField label="Reason" htmlFor="tr-reason" required error={err ?? undefined}><Textarea id="tr-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={transition.isPending}>Cancel</Button>
            <Button loading={transition.isPending} onClick={() => { if (reason.trim().length < 3) return setErr('Give a reason of at least 3 characters.'); setErr(null); transition.mutate(pending!); }}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
