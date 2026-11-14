'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Code2, Copy, Save, Send } from 'lucide-react';
import type { ApprovalDto, FactFieldMeta, ScorecardDefinition, ScorecardDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { ScorecardEditor } from '@/components/scorecards/scorecard-editor';
import { ScorecardStatusBadge } from '@/components/scorecards/scorecard-ui';
import { EligibilitySimulator } from '@/components/scorecards/simulator';
import { validateDefinition } from '@/components/scorecards/validate';
import { Callout } from '@/components/staff/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/empty-state';
import { FormField, Textarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/lib/auth';
import { errorMessage, get, post, put } from '@/lib/api';

export function ScorecardDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const canUpdate = useCan('scorecard:update');
  const q = useQuery({ queryKey: ['scorecard', id], queryFn: () => get<ScorecardDto>(`/scorecards/${id}`) });
  const fieldsQ = useQuery({ queryKey: ['scorecard-fields'], queryFn: () => get<FactFieldMeta[]>('/scorecards/fields'), retry: false, staleTime: 600_000 });
  const [draft, setDraft] = React.useState<ScorecardDefinition | null>(null);
  const [raw, setRaw] = React.useState(false);
  const [rawText, setRawText] = React.useState('');
  const [rawError, setRawError] = React.useState<string | null>(null);
  const [activating, setActivating] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [approval, setApproval] = React.useState<ApprovalDto | null>(null);

  React.useEffect(() => { if (q.data) { setDraft(structuredClone(q.data.definition)); setRawText(JSON.stringify(q.data.definition, null, 2)); setRawError(null); } }, [q.data]);

  const sc = q.data;
  const editable = !!sc && sc.status === 'DRAFT' && canUpdate && !sc.pendingApprovalId;
  const check = draft ? validateDefinition(draft) : null;
  const issues = check && !check.ok ? check.issues : [];
  const dirty = !!sc && !!draft && JSON.stringify(sc.definition) !== JSON.stringify(draft);

  const save = useMutation({
    mutationFn: () => put<ScorecardDto>(`/scorecards/${id}`, { name: sc!.name, definition: draft }),
    onSuccess: (s) => { toast.success('Draft saved'); qc.setQueryData(['scorecard', id], s); void qc.invalidateQueries({ queryKey: ['scorecards'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const newVersion = useMutation({
    mutationFn: () => post<ScorecardDto>('/scorecards', { fromId: id, name: sc!.name, definition: draft }),
    onSuccess: (s) => { toast.success(`Draft v${s.version} created`); void qc.invalidateQueries({ queryKey: ['scorecards'] }); router.push(`/scorecards/${s.id}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const activate = useMutation({
    mutationFn: () => post<ApprovalDto>(`/scorecards/${id}/request-activation`, { reason: reason.trim() }),
    onSuccess: (a) => { setApproval(a); setActivating(false); setReason(''); toast.success('Activation submitted for approval'); void qc.invalidateQueries({ queryKey: ['scorecard', id] }); void qc.invalidateQueries({ queryKey: ['scorecards'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggleRaw = () => {
    if (!raw) { setRawText(JSON.stringify(draft, null, 2)); setRawError(null); setRaw(true); return; }
    try { setDraft(JSON.parse(rawText) as ScorecardDefinition); setRawError(null); setRaw(false); } catch (e) { setRawError(`Invalid JSON: ${(e as Error).message}`); }
  };

  if (q.isLoading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (q.isError || !sc || !draft) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const pendingId = approval?.id ?? sc.pendingApprovalId;

  return (
    <>
      <Link href="/scorecards" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Scorecards</Link>
      <PageHeader
        title={`${sc.name} v${sc.version}`}
        description={`Key ${sc.key}${sc.notes ? ` · ${sc.notes}` : ''}`}
        actions={
          <>
            <ScorecardStatusBadge status={sc.status} />
            {pendingId && <Badge variant="info">Pending approval</Badge>}
            {canUpdate && <Button variant="outline" size="sm" loading={newVersion.isPending} disabled={issues.length > 0} onClick={() => newVersion.mutate()}><Copy /> New version from this</Button>}
            {editable && <Button size="sm" variant="outline" loading={save.isPending} disabled={!dirty || issues.length > 0} onClick={() => save.mutate()}><Save /> Save draft</Button>}
            {editable && <Button size="sm" disabled={dirty || issues.length > 0} onClick={() => setActivating(true)}><Send /> Request activation</Button>}
          </>
        }
      />
      {pendingId && (
        <Callout tone="info" title="Activation is awaiting approval" className="mb-4" data-testid="activation-callout">
          A checker must approve before this version becomes active. <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/approvals?id=${pendingId}&open=${pendingId}`}>Open the approval request</Link>
        </Callout>
      )}
      {sc.status !== 'DRAFT' && <Callout tone="info" className="mb-4">{sc.status === 'ACTIVE' ? 'The active scorecard is read-only.' : 'Retired versions are read-only.'} Use &ldquo;New version from this&rdquo; to edit a copy.</Callout>}
      {editable && dirty && <Callout tone="warning" className="mb-4">You have unsaved changes{dirty && !issues.length ? '. Save the draft before requesting activation.' : '.'}</Callout>}

      <Tabs defaultValue="editor">
        <TabsList><TabsTrigger value="editor">Definition</TabsTrigger><TabsTrigger value="simulator">What-if simulator</TabsTrigger></TabsList>
        <TabsContent value="editor">
          <div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={toggleRaw}><Code2 /> {raw ? 'Back to form' : 'Raw JSON'}</Button></div>
          {raw ? (
            <div className="space-y-2">
              <Textarea aria-label="Scorecard definition JSON" className="min-h-[32rem] font-mono text-xs" value={rawText} readOnly={!editable} onChange={(e) => { setRawText(e.target.value); try { setDraft(JSON.parse(e.target.value) as ScorecardDefinition); setRawError(null); } catch (er) { setRawError(`Invalid JSON: ${(er as Error).message}`); } }} />
              {rawError && <p role="alert" className="text-sm font-medium text-destructive">{rawError}</p>}
              {!rawError && issues.length > 0 && <Callout tone="danger" title="Schema errors"><ul className="list-disc pl-4 text-sm">{issues.map((i, k) => <li key={k}><span className="font-mono text-xs">{i.path}</span>: {i.message}</li>)}</ul></Callout>}
            </div>
          ) : (
            <ScorecardEditor definition={draft} onChange={setDraft} readOnly={!editable} issues={issues} fields={fieldsQ.data} />
          )}
        </TabsContent>
        <TabsContent value="simulator"><EligibilitySimulator draftDefinition={issues.length === 0 ? draft : null} draftKey={sc.key} initialScorecardId={sc.id} /></TabsContent>
      </Tabs>

      <Dialog open={activating} onOpenChange={setActivating}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>Request activation</DialogTitle><DialogDescription>{`${sc.name} v${sc.version} replaces the current active version once a checker approves.`}</DialogDescription></DialogHeader>
          <FormField label="Reason" htmlFor="act-reason" required hint="Why should this version go live? Reviewers see this."><Textarea id="act-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
          <DialogFooter><Button variant="outline" onClick={() => setActivating(false)} disabled={activate.isPending}>Cancel</Button><Button loading={activate.isPending} disabled={reason.trim().length < 5} onClick={() => activate.mutate()}>Submit for approval</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
