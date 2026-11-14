'use client';
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatNaira } from '@damez/shared';
import type {
  CollectionCaseDetailDto, CollectionActivityDto,
  CollectionBucket, CollectionStatus, CollectionChannel, CollectionOutcome, PtpStatus,
  ThirdPartyAgencyDto, LogActivityDto, CreatePtpDto,
} from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';
import { StaffToPicker } from '@/components/staff/staff-to-picker';
import { get, patch, post, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { StaffDirectoryEntryDto } from '@damez/shared';
import { toast } from 'sonner';
import { Phone, Mail, MessageSquare, MapPin, FileText, MessageCircle, Gavel, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

const BUCKET_STYLE: Record<CollectionBucket, string> = {
  DPD_1_7: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  DPD_8_30: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  DPD_31_60: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  DPD_61_90: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200',
  DPD_90_PLUS: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

const BUCKET_LABEL: Record<CollectionBucket, string> = {
  DPD_1_7: '1–7 DPD', DPD_8_30: '8–30 DPD', DPD_31_60: '31–60 DPD', DPD_61_90: '61–90 DPD', DPD_90_PLUS: '90+ DPD',
};

const STATUS_VARIANT: Record<CollectionStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  OPEN: 'secondary', IN_PROGRESS: 'warning', PROMISE_TO_PAY: 'info' as never, LEGAL: 'destructive',
  AGENCY: 'default', WRITTEN_OFF: 'destructive', SETTLED: 'success', CLOSED: 'secondary',
};

const PTP_VARIANT: Record<PtpStatus, 'default' | 'success' | 'destructive' | 'warning' | 'secondary'> = {
  PENDING: 'warning', KEPT: 'success', BROKEN: 'destructive', PARTIAL: 'default', SUPERSEDED: 'secondary',
};

const CHANNEL_ICONS: Record<CollectionChannel, React.ElementType> = {
  PHONE_CALL: Phone, SMS: MessageSquare, EMAIL: Mail, WHATSAPP: MessageCircle,
  FIELD_VISIT: MapPin, PORTAL_MESSAGE: FileText, LEGAL_NOTICE: Gavel,
};

const CHANNELS: CollectionChannel[] = ['PHONE_CALL', 'SMS', 'EMAIL', 'WHATSAPP', 'FIELD_VISIT', 'PORTAL_MESSAGE', 'LEGAL_NOTICE'];
const OUTCOMES: CollectionOutcome[] = ['NO_ANSWER', 'WRONG_NUMBER', 'LEFT_VOICEMAIL', 'SPOKE_TO_BORROWER', 'SPOKE_TO_THIRD_PARTY', 'PROMISE_TO_PAY', 'REFUSED_TO_PAY', 'DISPUTE_RAISED', 'COMPLAINT_LODGED', 'VISITED_ADDRESS', 'PAYMENT_MADE', 'PARTIAL_PAYMENT'];

function fmtLabel(s: string) { return s.replace(/_/g, ' '); }

function ActivityItem({ a }: { a: CollectionActivityDto }) {
  const Icon = CHANNEL_ICONS[a.channel] ?? Phone;
  const isGood = a.outcome === 'PAYMENT_MADE' || a.outcome === 'SPOKE_TO_BORROWER' || a.outcome === 'PROMISE_TO_PAY';
  const isBad = a.outcome === 'REFUSED_TO_PAY' || a.outcome === 'WRONG_NUMBER';
  return (
    <div className="flex gap-3 pb-4 last:pb-0">
      <div className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', isGood ? 'bg-success/12 text-success' : isBad ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{a.agentName}</span>
          <Badge variant={isGood ? 'success' : isBad ? 'destructive' : 'secondary'}>{fmtLabel(a.outcome)}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">{new Date(a.contactedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p className="text-xs text-muted-foreground">{fmtLabel(a.channel)}</p>
        {a.notes && <p className="mt-1 text-sm">{a.notes}</p>}
        {a.nextActionAt && <p className="mt-1 text-xs text-muted-foreground">Next: {new Date(a.nextActionAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })} — {a.nextActionNote}</p>}
      </div>
    </div>
  );
}

function LogActivityModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [channel, setChannel] = React.useState<CollectionChannel>('PHONE_CALL');
  const [outcome, setOutcome] = React.useState<CollectionOutcome>('NO_ANSWER');
  const [notes, setNotes] = React.useState('');
  const [nextAction, setNextAction] = React.useState('');

  const mut = useMutation({
    mutationFn: (body: LogActivityDto) => post(`/collections/cases/${caseId}/activities`, body),
    onSuccess: () => { toast.success('Activity logged'); qc.invalidateQueries({ queryKey: ['collection-case', caseId] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <FormField label="Channel" htmlFor="la-channel">
          <Select id="la-channel" value={channel} onChange={(e) => setChannel(e.target.value as CollectionChannel)}>
            {CHANNELS.map((c) => <option key={c} value={c}>{fmtLabel(c)}</option>)}
          </Select>
        </FormField>
        <FormField label="Outcome" htmlFor="la-outcome">
          <Select id="la-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as CollectionOutcome)}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{fmtLabel(o)}</option>)}
          </Select>
        </FormField>
        <FormField label="Notes" htmlFor="la-notes">
          <Textarea id="la-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened…" />
        </FormField>
        <FormField label="Next action date" htmlFor="la-next">
          <Input id="la-next" type="datetime-local" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </FormField>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button loading={mut.isPending} onClick={() => mut.mutate({ channel, outcome, notes: notes || undefined, nextActionAt: nextAction ? new Date(nextAction).toISOString() : undefined })}>Save</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CreatePtpModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState('');

  const mut = useMutation({
    mutationFn: (body: CreatePtpDto) => post(`/collections/cases/${caseId}/ptp`, body),
    onSuccess: () => { toast.success('Promise to Pay created'); qc.invalidateQueries({ queryKey: ['collection-case', caseId] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const kobo = Math.round(parseFloat(amount || '0') * 100);

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Create Promise to Pay</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <FormField label="Amount (₦)" htmlFor="ptp-amount">
          <Input id="ptp-amount" type="number" min="0" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" />
        </FormField>
        <FormField label="Promised date" htmlFor="ptp-date">
          <Input id="ptp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button loading={mut.isPending} disabled={!amount || !date || kobo <= 0} onClick={() => mut.mutate({ amountKobo: kobo, promisedDate: date })}>Save PTP</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AssignAgencyModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const agencies = useQuery({ queryKey: ['agencies'], queryFn: () => get<ThirdPartyAgencyDto[]>('/collections/agencies') });
  const [agencyId, setAgencyId] = React.useState('');
  const [reason, setReason] = React.useState('');

  const mut = useMutation({
    mutationFn: () => post(`/collections/cases/${caseId}/agency`, { agencyId, reason }),
    onSuccess: () => { toast.success('Agency assignment submitted for approval'); qc.invalidateQueries({ queryKey: ['collection-case', caseId] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Assign to Recovery Agency</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <FormField label="Agency" htmlFor="agency-sel">
          <Select id="agency-sel" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
            <option value="">Select agency…</option>
            {(agencies.data ?? []).filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name} ({(a.commissionBps / 100).toFixed(1)}%)</option>)}
          </Select>
        </FormField>
        <FormField label="Reason" htmlFor="agency-reason">
          <Textarea id="agency-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this case is being escalated to an agency…" />
        </FormField>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button loading={mut.isPending} disabled={!agencyId || reason.trim().length < 5} onClick={() => mut.mutate()}>Submit for approval</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AssignAgentModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [agent, setAgent] = React.useState<StaffDirectoryEntryDto[]>([]);

  const mut = useMutation({
    mutationFn: () => patch(`/collections/cases/${caseId}/assign`, { assignedToId: agent[0].id }),
    onSuccess: () => { toast.success('Case assigned'); qc.invalidateQueries({ queryKey: ['collection-case', caseId] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Assign Case to Staff</DialogTitle></DialogHeader>
      <FormField label="To" htmlFor="assign-agent">
        <StaffToPicker value={agent} onChange={setAgent} max={1} id="assign-agent" placeholder="Search staff by name or email…" autoFocus />
      </FormField>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button loading={mut.isPending} disabled={agent.length === 0} onClick={() => mut.mutate()}>Assign</Button>
      </DialogFooter>
    </DialogContent>
  );
}

type Modal = 'activity' | 'ptp' | 'agency' | 'agent' | null;

export default function CollectionCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [modal, setModal] = React.useState<Modal>(null);
  const canAssign = useCan('collections:assign');

  const q = useQuery({ queryKey: ['collection-case', caseId], queryFn: () => get<CollectionCaseDetailDto>(`/collections/cases/${caseId}`) });
  const c = q.data;

  if (q.isLoading) return (
    <><PageHeader title="Collection Case" /><div className="space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div></>
  );

  if (q.isError || !c) return (
    <><PageHeader title="Collection Case" /><Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card></>
  );

  return (
    <>
      <PageHeader
        title={c.customerName}
        description={`Loan ${c.loanReference} · ${c.productName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setModal('activity')}>Log Activity</Button>
            <Button variant="outline" onClick={() => setModal('ptp')}>Create PTP</Button>
            {canAssign && <Button variant="outline" onClick={() => setModal('agent')}>{c.assignedToId ? 'Reassign' : 'Assign'} Staff</Button>}
            {c.dpd > 90 && <Button variant="outline" onClick={() => setModal('agency')}>Assign Agency</Button>}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold', BUCKET_STYLE[c.bucket])}>{BUCKET_LABEL[c.bucket]}</span>
        <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>{fmtLabel(c.status)}</Badge>
        {/* <span className="text-sm text-muted-foreground">Priority: <span className="font-medium text-foreground">{c.priority}</span></span> */}
        {c.assignedToName && <span className="text-sm text-muted-foreground">Assigned to: <span className="font-medium text-foreground">{c.assignedToName}</span></span>}
        <span className="ml-auto text-xl font-bold">{formatNaira(c.totalOutstandingKobo)}</span>
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity Log ({c.activities.length})</TabsTrigger>
          <TabsTrigger value="ptps">Promises to Pay ({c.promisesToPay.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <Card className="p-4">
            {c.activities.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <Clock className="size-8 opacity-40" />
                <p>No activity logged yet.</p>
                <Button variant="outline" size="sm" onClick={() => setModal('activity')}>Log first activity</Button>
              </div>
            ) : (
              <div className="divide-y">
                {c.activities.map((a) => <div key={a.id} className="py-3 first:pt-0 last:pb-0"><ActivityItem a={a} /></div>)}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="ptps">
          <Card className="overflow-hidden">
            {c.promisesToPay.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <AlertCircle className="size-8 opacity-40" />
                <p>No promises to pay recorded.</p>
                <Button variant="outline" size="sm" onClick={() => setModal('ptp')}>Create PTP</Button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium">Promised Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">Kept / Broken</th>
                  </tr>
                </thead>
                <tbody>
                  {c.promisesToPay.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-4 py-2.5 tabular font-medium">{formatNaira(p.amountKobo)}</td>
                      <td className="px-4 py-2.5">{new Date(p.promisedDate).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })}</td>
                      <td className="px-4 py-2.5"><Badge variant={PTP_VARIANT[p.status]}>{p.status}</Badge></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {p.keptAt && <span className="flex items-center gap-1 text-success"><CheckCircle2 className="size-3" />{new Date(p.keptAt).toLocaleDateString('en-NG')}</span>}
                        {p.brokenAt && <span className="flex items-center gap-1 text-destructive"><AlertCircle className="size-3" />{new Date(p.brokenAt).toLocaleDateString('en-NG')}</span>}
                        {!p.keptAt && !p.brokenAt && '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={modal === 'activity'} onOpenChange={(o) => !o && setModal(null)}>
        {modal === 'activity' && <LogActivityModal caseId={caseId} onClose={() => setModal(null)} />}
      </Dialog>
      <Dialog open={modal === 'ptp'} onOpenChange={(o) => !o && setModal(null)}>
        {modal === 'ptp' && <CreatePtpModal caseId={caseId} onClose={() => setModal(null)} />}
      </Dialog>
      <Dialog open={modal === 'agency'} onOpenChange={(o) => !o && setModal(null)}>
        {modal === 'agency' && <AssignAgencyModal caseId={caseId} onClose={() => setModal(null)} />}
      </Dialog>
      <Dialog open={modal === 'agent'} onOpenChange={(o) => !o && setModal(null)}>
        {modal === 'agent' && <AssignAgentModal caseId={caseId} onClose={() => setModal(null)} />}
      </Dialog>
    </>
  );
}
