'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, CircleDot, X } from 'lucide-react';
import { formatNaira, type ApprovalDto } from '@damez/shared';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { StatusBadge } from '@/components/status-badge';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { useMe } from '@/lib/auth';
import { errorMessage, get, post } from '@/lib/api';
import { cn } from '@/lib/utils';

export function escalationMessage(a: Pick<ApprovalDto, 'status' | 'steps' | 'amountKobo'>): string | null {
  if (a.status !== 'ESCALATED') return null;
  const last = [...a.steps].reverse().find((x) => x.decision === 'ESCALATED');
  const who = last ? `${last.approver.name} (${last.approver.role})` : 'The previous approver';
  return `Escalated: ${who} approved within their limit, but ${formatNaira(a.amountKobo, { trimZeroKobo: true })} needs a higher approval authority`;
}

export function ApprovalDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const [comment, setComment] = React.useState('');
  const q = useQuery({ queryKey: ['approval', id], queryFn: () => get<ApprovalDto>(`/approvals/${id}`), enabled: !!id });
  React.useEffect(() => setComment(''), [id]);

  const decide = useMutation({
    mutationFn: ({ action }: { action: 'approve' | 'reject' | 'cancel' }) => post<ApprovalDto>(`/approvals/${id}/${action}`, action === 'cancel' ? {} : { comment: comment || undefined }),
    onSuccess: (a, v) => {
      toast.success(v.action === 'approve' ? (a.status === 'ESCALATED' ? 'Approved, escalated to a higher authority' : 'Approved') : v.action === 'reject' ? 'Rejected' : 'Request cancelled');
      qc.setQueryData(['approval', id], a);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      setComment('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const a = q.data;
  const open = a ? a.status === 'PENDING' || a.status === 'ESCALATED' : false;
  const esc = a ? escalationMessage(a) : null;
  const isMaker = a?.maker.id === me.id;

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>{a?.typeLabel ?? 'Approval request'}</SheetTitle>
          <SheetDescription>{a?.summary ?? 'Loading…'}</SheetDescription>
        </SheetHeader>
        {q.isLoading && <Skeleton className="h-64" />}
        {q.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(q.error)}</p>}
        {a && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={a.status} label={a.status === 'EXECUTED' ? 'Approved' : undefined} />{a.amountKobo !== null && <MoneyText kobo={a.amountKobo} className="text-lg font-semibold" />}</div>
            {esc && (
              <div role="status" className="flex gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />{esc}</div>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Maker</dt><dd>{a.maker.name}<span className="block text-xs text-muted-foreground">{a.maker.role}</span></dd></div>
              <div><dt className="text-xs text-muted-foreground">Submitted</dt><dd><DateTime value={a.createdAt} /></dd></div>
              <div><dt className="text-xs text-muted-foreground">Branch</dt><dd>{a.branch?.name ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Decided</dt><dd><DateTime value={a.decidedAt} /></dd></div>
              {a.reason && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Reason</dt><dd>{a.reason}</dd></div>}
            </dl>
          
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Timeline</p>
              <ol className="space-y-3 border-l pl-4">
                <li className="relative"><CircleDot className="absolute -left-[1.45rem] top-0.5 size-3.5 bg-card text-muted-foreground" aria-hidden /><p className="text-sm">Submitted by {a.maker.name}</p><p className="text-xs text-muted-foreground"><DateTime value={a.createdAt} /></p></li>
                {a.steps.map((s) => (
                  <li key={s.id} className="relative">
                    <span className={cn('absolute -left-[1.55rem] top-0 flex size-4 items-center justify-center rounded-full text-white', s.decision === 'APPROVED' && 'bg-success', s.decision === 'REJECTED' && 'bg-destructive', s.decision === 'ESCALATED' && 'bg-info')} aria-hidden>
                      {s.decision === 'REJECTED' ? <X className="size-3" /> : s.decision === 'ESCALATED' ? <AlertTriangle className="size-2.5" /> : <Check className="size-3" />}
                    </span>
                    <p className="text-sm"><b>{s.decision === 'ESCALATED' ? 'Approved (escalated)' : s.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</b> by {s.approver.name} <span className="text-muted-foreground">({s.approver.role})</span></p>
                    {s.comment && <p className="mt-0.5 rounded bg-muted px-2 py-1 text-xs">“{s.comment}”</p>}
                    <p className="text-xs text-muted-foreground"><DateTime value={s.createdAt} /></p>
                  </li>
                ))}
              </ol>
            </div>
            {/* {a.executionResult != null && (
              <div><p className="mb-1 text-xs font-medium text-muted-foreground">Execution result</p><p className="text-sm">{String((a.executionResult as Record<string, unknown>).note ?? '')}</p></div>
            )} */}
            {open && (
              <div className="space-y-3 border-t pt-4"> 
                <label htmlFor="decision-comment" className="text-sm font-medium">Comment (optional)</label>
                <Textarea id="decision-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
                <div className="flex flex-wrap gap-2">
                  <Tooltip content={a.cannotDecideReason} disabled={a.canDecide}>
                    <span><Button disabled={!a.canDecide || decide.isPending} loading={decide.isPending && decide.variables?.action === 'approve'} onClick={() => decide.mutate({ action: 'approve' })}><Check /> Approve</Button></span>
                  </Tooltip>
                  <Tooltip content={a.cannotDecideReason} disabled={a.canDecide}>
                    <span><Button variant="destructive" disabled={!a.canDecide || decide.isPending} loading={decide.isPending && decide.variables?.action === 'reject'} onClick={() => decide.mutate({ action: 'reject' })}><X /> Reject</Button></span>
                  </Tooltip>
                  {isMaker && <Button variant="outline" className="ml-auto" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'cancel' })}>Cancel request</Button>}
                </div>
                {!a.canDecide && a.cannotDecideReason && <p className="text-xs text-muted-foreground">{a.cannotDecideReason}</p>}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
