'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { APPROVAL_STATUSES, type ApprovalDto, type ApprovalTypeDto, type Page } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';
import { ApprovalDetail } from './approval-detail';
import { NewRequestDialog, type Prefill } from './new-request-dialog';
import { PolicyAdmin } from './policy-admin';

type Scope = 'pending_mine' | 'submitted_by_me' | 'all';

export function ApprovalsView() {
  const params = useSearchParams();
  const router = useRouter();
  const canSubmit = useCan('approval:submit');
  const canPolicy = useCan('approval:policy_manage');
  const [scope, setScope] = React.useState<Scope>('pending_mine');
  const [status, setStatus] = React.useState('');
  const [type, setType] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<string | null>(params.get('id') ?? params.get('open'));
  const [newOpen, setNewOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<Prefill | undefined>();

  React.useEffect(() => {
    const t = params.get('new');
    if (t && canSubmit) {
      setPrefill({ type: t, productId: params.get('productId') ?? undefined });
      setNewOpen(true);
      router.replace('/approvals');
    }
  }, [params, canSubmit, router]);

  const types = useQuery({ queryKey: ['approval-types'], queryFn: () => get<ApprovalTypeDto[]>('/approvals/types') });
  const list = useQuery({
    queryKey: ['approvals', { scope, status, type, page }],
    queryFn: () => get<Page<ApprovalDto>>('/approvals', { scope, status, type, page, pageSize: 20 }),
    placeholderData: (p) => p,
  });

  const columns: DataColumn<ApprovalDto>[] = [
    { id: 'summary', header: 'Request', sortable: true, accessor: (a) => a.summary, cell: (a) => (<div className="min-w-0 max-w-sm"><p className="truncate font-medium">{a.summary}</p><p className="text-xs text-muted-foreground">{a.typeLabel}</p></div>) },
    { id: 'amount', header: 'Amount', sortable: true, align: 'right', accessor: (a) => a.amountKobo, cell: (a) => (a.amountKobo === null ? <span className="text-muted-foreground">—</span> : <MoneyText kobo={a.amountKobo} />) },
    { id: 'maker', header: 'Maker', sortable: true, accessor: (a) => a.maker.name, cell: (a) => (<div><p>{a.maker.name}</p><p className="text-xs text-muted-foreground">{a.maker.role}</p></div>) },
    { id: 'status', header: 'Status', sortable: true, accessor: (a) => a.status, cell: (a) => <StatusBadge status={a.status} label={a.status === 'EXECUTED' ? 'Approved' : undefined} /> },
    { id: 'created', header: 'Submitted', sortable: true, accessor: (a) => a.createdAt, cell: (a) => <DateTime value={a.createdAt} style="short" /> },
    { id: 'decide', header: '', noExport: true, cell: (a) => (a.canDecide ? <span className="text-xs font-medium text-primary">Review</span> : null) },
  ];

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Nobody can approve their own request."
        actions={canSubmit && <Button onClick={() => { setPrefill(undefined); setNewOpen(true); }}><Plus /> New request</Button>}
      />
      <Tabs value={scope} onValueChange={(v) => { setScope(v as Scope); setPage(1); }} className="mb-4">
        <TabsList>
          <TabsTrigger value="pending_mine">Awaiting my decision</TabsTrigger>
          <TabsTrigger value="submitted_by_me">Submitted by me</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        mode="server"
        columns={columns}
        data={list.data?.items ?? []}
        rowKey={(a) => a.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => list.refetch()}
        total={list.data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        onRowClick={(a) => setOpenId(a.id)}
        exportName="approvals"
        savedViewsKey="approvals"
        emptyTitle={scope === 'pending_mine' ? 'Nothing waiting for you' : 'No requests'}
        emptyDescription="New requests appear here as soon as they are submitted."
        searchPlaceholder="Filter this page…"
        toolbar={
          <>
            <Select aria-label="Status" className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>{APPROVAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
            <Select aria-label="Type" className="w-48" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">Any type</option>{types.data?.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </Select>
          </>
        }
      />
      {canPolicy && types.data && <PolicyAdmin types={types.data} />}
      <ApprovalDetail id={openId} onClose={() => setOpenId(null)} />
      <NewRequestDialog open={newOpen} onOpenChange={setNewOpen} types={types.data ?? []} prefill={prefill} />
    </>
  );
}
