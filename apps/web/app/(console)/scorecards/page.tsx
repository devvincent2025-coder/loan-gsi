'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical, Plus } from 'lucide-react';
import { DEFAULT_SCORECARD_V1, type ScorecardDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { ScorecardStatusBadge } from '@/components/scorecards/scorecard-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/empty-state';
import { FormField, Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage, get, post } from '@/lib/api';

function NewScorecardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [key, setKey] = React.useState('');
  const m = useMutation({
    mutationFn: () => post<ScorecardDto>('/scorecards', { name: name.trim(), key: key.trim() || undefined, definition: DEFAULT_SCORECARD_V1 }),
    onSuccess: (s) => { toast.success('Draft scorecard created'); void qc.invalidateQueries({ queryKey: ['scorecards'] }); onOpenChange(false); router.push(`/scorecards/${s.id}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>New scorecard</DialogTitle><DialogDescription>Starts as a draft pre-filled with the default scorecard. Leave the key empty to derive it from the name.</DialogDescription></DialogHeader>
        <FormField label="Name" htmlFor="sc-new-name" required><Input id="sc-new-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Key" htmlFor="sc-new-key" hint="Versions with the same key form one scorecard family."><Input id="sc-new-key" className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} /></FormField>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={m.isPending} disabled={name.trim().length < 2} onClick={() => m.mutate()}>Create draft</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ScorecardsPage() {
  const router = useRouter();
  const canUpdate = useCan('scorecard:update');
  const canRun = useCan('eligibility:run');
  const [creating, setCreating] = React.useState(false);
  const q = useQuery({ queryKey: ['scorecards'], queryFn: () => get<ScorecardDto[]>('/scorecards') });
  const groups = React.useMemo(() => {
    const m = new Map<string, ScorecardDto[]>();
    for (const s of q.data ?? []) m.set(s.key, [...(m.get(s.key) ?? []), s]);
    return [...m.entries()].map(([k, v]) => [k, v.sort((a, b) => b.version - a.version)] as const);
  }, [q.data]);
  const columns: DataColumn<ScorecardDto>[] = [
    { id: 'version', header: 'Version', sortable: true, accessor: (s) => s.version, cell: (s) => <span className="tabular font-medium">v{s.version}</span> },
    { id: 'name', header: 'Name', accessor: (s) => s.name, cell: (s) => s.name },
    { id: 'status', header: 'Status', accessor: (s) => s.status, cell: (s) => (<span className="inline-flex items-center gap-1.5"><ScorecardStatusBadge status={s.status} />{s.pendingApprovalId && <Badge variant="info">Pending approval</Badge>}</span>) },
    { id: 'by', header: 'Created by', accessor: (s) => s.createdBy?.name ?? '', cell: (s) => s.createdBy?.name ?? <span className="text-muted-foreground">System</span> },
    { id: 'created', header: 'Created', sortable: true, accessor: (s) => s.createdAt, cell: (s) => <DateTime value={s.createdAt} style="short" /> },
    { id: 'activated', header: 'Activated', accessor: (s) => s.activatedAt, cell: (s) => <DateTime value={s.activatedAt} style="short" /> },
  ];
  return (
    <>
      <PageHeader
        title="Scorecards"
        description="Versioned scoring models and policy rules. Activation needs maker-checker approval."
        actions={<>
          {canRun && <Button asChild variant="outline"><Link href="/scorecards/simulator"><FlaskConical /> What-if simulator</Link></Button>}
          {canUpdate && <Button onClick={() => setCreating(true)}><Plus /> New scorecard</Button>}
        </>}
      />
      {q.isLoading && <Skeleton className="h-48 w-full" />}
      {q.isError && <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>}
      <div className="space-y-5">
        {groups.map(([key, versions]) => {
          const active = versions.find((v) => v.status === 'ACTIVE');
          return (
            <Card key={key}>
              <CardHeader><CardTitle className="flex items-center gap-2"><span className="font-mono">{key}</span>{active ? <Badge variant="success">Active v{active.version}</Badge> : <Badge variant="warning">No active version</Badge>}</CardTitle><CardDescription>{versions.length} version(s)</CardDescription></CardHeader>
              <CardContent>
                <DataTable columns={columns} data={versions} rowKey={(s) => s.id} onRowClick={(s) => router.push(`/scorecards/${s.id}`)} exportName={`scorecards-${key}`} searchPlaceholder="Filter versions…" pageSize={10} />
              </CardContent>
            </Card>
          );
        })}
        {q.data?.length === 0 && <Card><div className="p-8 text-center text-sm text-muted-foreground">No scorecards yet.</div></Card>}
      </div>
      <NewScorecardDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
