'use client';
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { AuditFilters, AuditLogDto, AuditVerifyResult, Page, UserDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { DateTime } from '@/components/date-time';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCan } from '@/lib/auth';
import { buildQuery, errorMessage, get } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { JsonDiff } from './json-diff';

const lagosStart = (d: string) => (d ? new Date(`${d}T00:00:00+01:00`).toISOString() : undefined);
const lagosEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999+01:00`).toISOString() : undefined);

export default function AuditPage() {
  const canExport = useCan('audit:export');
  const canUsers = useCan('user:read');
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [actorId, setActorId] = React.useState('');
  const [action, setAction] = React.useState('');
  const [resourceType, setResourceType] = React.useState('');
  const [outcome, setOutcome] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const dq = useDebounced(search, 300);

  const filters = useQuery({ queryKey: ['audit-filters'], queryFn: () => get<AuditFilters>('/audit/filters') });
  const users = useQuery({ queryKey: ['users', 'all-actors'], enabled: canUsers, queryFn: () => get<Page<UserDto>>('/users', { pageSize: 200 }) });

  const params = { q: dq, actorId, action, resourceType, outcome, from: lagosStart(from), to: lagosEnd(to) };
  const logs = useQuery({
    queryKey: ['audit', page, params],
    queryFn: () => get<Page<AuditLogDto>>('/audit', { page, pageSize: 25, ...params }),
    placeholderData: (p) => p,
  });
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const verify = useMutation({ mutationFn: () => get<AuditVerifyResult>('/audit/verify') });

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const columns: DataColumn<AuditLogDto>[] = [
    { id: 'seq', header: '#', sortable: true, accessor: (l) => l.seq, cell: (l) => <span className="tabular font-mono text-xs text-muted-foreground">{l.seq}</span> },
    { id: 'time', header: 'Time (WAT)', sortable: true, accessor: (l) => l.createdAt, cell: (l) => <DateTime value={l.createdAt} /> },
    { id: 'actor', header: 'Actor', sortable: true, accessor: (l) => l.actor?.name ?? 'system', cell: (l) => (<div><p className="font-medium">{l.actor?.name ?? 'System'}</p><p className="text-xs text-muted-foreground">{l.actorRole ?? ''}</p></div>) },
    { id: 'action', header: 'Action', sortable: true, accessor: (l) => l.action, cell: (l) => <span className="font-mono text-xs">{l.action}</span> },
    { id: 'resource', header: 'Resource', accessor: (l) => `${l.resourceType}${l.resourceId ? ` ${l.resourceId}` : ''}`, cell: (l) => (<div><p>{l.resourceType}</p><p className="max-w-32 truncate font-mono text-[11px] text-muted-foreground">{l.resourceId}</p></div>) },
    { id: 'outcome', header: 'Outcome', sortable: true, accessor: (l) => l.outcome, cell: (l) => <StatusBadge status={l.outcome} /> },
    { id: 'ip', header: 'IP', accessor: (l) => l.ip ?? '', defaultHidden: true },
    { id: 'hash', header: 'Hash', accessor: (l) => l.hash, defaultHidden: true },
  ];

  const exportHref = `/api/v1/audit/export${buildQuery(params)}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Tamper-evident record of every sensitive action. Hash-chained and append-only."
        actions={
          <>
            <Button variant="outline" onClick={() => { setVerifyOpen(true); verify.mutate(); }}><ShieldCheck /> Verify integrity</Button>
            {canExport && <Button asChild variant="outline"><a href={exportHref} download="audit-log.csv"><Download /> Export CSV</a></Button>}
          </>
        }
      />
      <DataTable
        mode="server"
        columns={columns}
        data={logs.data?.items ?? []}
        rowKey={(l) => l.id}
        loading={logs.isLoading}
        error={logs.isError ? errorMessage(logs.error) : null}
        onRetry={() => logs.refetch()}
        total={logs.data?.total}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        search={search}
        onSearchChange={reset(setSearch)}
        exportName="audit-page"
        savedViewsKey="audit"
        searchPlaceholder="Free text…"
        emptyTitle="No audit events match"
        renderExpanded={(l) => <AuditDetail log={l} />}
        toolbar={
          <>
            {canUsers && (
              <Select aria-label="Actor" className="w-40" value={actorId} onChange={(e) => reset(setActorId)(e.target.value)}>
                <option value="">Any actor</option>{users.data?.items.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </Select>
            )}
            <Select aria-label="Action" className="w-44" value={action} onChange={(e) => reset(setAction)(e.target.value)}><option value="">Any action</option>{filters.data?.actions.map((a) => <option key={a}>{a}</option>)}</Select>
            <Select aria-label="Resource type" className="w-40" value={resourceType} onChange={(e) => reset(setResourceType)(e.target.value)}><option value="">Any resource</option>{filters.data?.resourceTypes.map((a) => <option key={a}>{a}</option>)}</Select>
            <Select aria-label="Outcome" className="w-32" value={outcome} onChange={(e) => reset(setOutcome)(e.target.value)}><option value="">Any outcome</option><option>SUCCESS</option><option>FAILURE</option><option>DENIED</option></Select>
            <Input aria-label="From date" type="date" className="w-36" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} />
            <Input aria-label="To date" type="date" className="w-36" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} />
          </>
        }
      />
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Audit chain integrity</DialogTitle><DialogDescription>Recomputes every hash in order.</DialogDescription></DialogHeader>
          {verify.isPending && <p className="text-sm text-muted-foreground">Verifying…</p>}
          {verify.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(verify.error)}</p>}
          {verify.data && (
            <div role="status" className={`flex items-start gap-3 rounded-md border p-4 ${verify.data.valid ? 'border-success/30 bg-success/10' : 'border-destructive/30 bg-destructive/10'}`}>
              {verify.data.valid ? <ShieldCheck className="size-5 text-success" aria-hidden /> : <ShieldAlert className="size-5 text-destructive" aria-hidden />}
              <div className="text-sm">
                <p className="font-semibold">{verify.data.valid ? 'Chain is intact' : 'Chain is broken'}</p>
                <p className="tabular text-muted-foreground">{verify.data.checked.toLocaleString('en-NG')} entries checked{verify.data.brokenAtSeq !== null && ` · broken at #${verify.data.brokenAtSeq}`}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AuditDetail({ log }: { log: AuditLogDto }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 text-xs sm:grid-cols-2">
        <dl className="space-y-1.5">
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">IP</dt><dd className="font-mono">{log.ip ?? '—'}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">User agent</dt><dd className="break-all">{log.userAgent ?? '—'}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">Branch</dt><dd className="font-mono">{log.branchId ?? '—'}</dd></div>
        </dl>
        <dl className="space-y-1.5">
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">Hash</dt><dd className="break-all font-mono">{log.hash}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted-foreground">Event ID</dt><dd className="break-all font-mono">{log.id}</dd></div>
        </dl>
      </div>
      <JsonDiff before={log.before} after={log.after} />
      {log.metadata != null && (
        <div><p className="mb-1 text-xs font-medium text-muted-foreground">Metadata</p><pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(log.metadata, null, 2)}</pre></div>
      )}
    </div>
  );
}
