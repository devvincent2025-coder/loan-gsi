'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { BureauPullDto, Page } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { BUREAU_LABEL } from '@/components/bureau/bureau-utils';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/form';
import { errorMessage, get } from '@/lib/api';
import { titleCase } from '@/lib/utils';

export function PullLogTab({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const [page, setPage] = React.useState(1);
  const [bureau, setBureau] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const q = useQuery({
    queryKey: ['bureau-pulls', { page, bureau, status, reason, from, to }],
    queryFn: () => get<Page<BureauPullDto>>('/bureau/pulls', { page, pageSize: 20, bureau, status, reason, from, to }),
    placeholderData: (p) => p,
  });
  const f = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const columns: DataColumn<BureauPullDto>[] = [
    { id: 'when', header: 'When', sortable: true, accessor: (p) => p.createdAt, cell: (p) => <DateTime value={p.createdAt} style="short" /> },
    { id: 'customer', header: 'Customer', accessor: (p) => p.customerName, cell: (p) => <Link href={`/customers/${p.customerId}?tab=bureau`} className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{p.customerName}</Link> },
    { id: 'bureau', header: 'Bureau', accessor: (p) => p.bureau, cell: (p) => BUREAU_LABEL[p.bureau] ?? p.bureau },
    { id: 'reason', header: 'Reason', accessor: (p) => p.reason, cell: (p) => titleCase(p.reason) },
    { id: 'status', header: 'Status', accessor: (p) => p.status, cell: (p) => <Badge variant={p.status === 'SUCCESS' ? 'success' : p.status === 'CACHED' || p.status === 'NO_HIT' ? 'secondary' : p.status === 'BLOCKED_NO_CONSENT' ? 'warning' : 'destructive'} title={p.error ?? undefined}>{titleCase(p.status)}</Badge> },
    { id: 'cost', header: 'Cost', sortable: true, align: 'right', accessor: (p) => p.costKobo, cell: (p) => <MoneyText kobo={p.costKobo} /> },
    { id: 'duration', header: 'Duration', align: 'right', accessor: (p) => p.durationMs, cell: (p) => (p.durationMs === null ? '—' : <span className="tabular">{p.durationMs} ms</span>), defaultHidden: true },
    { id: 'by', header: 'Requested by', accessor: (p) => p.requestedBy?.name ?? 'System', cell: (p) => p.requestedBy?.name ?? <span className="text-muted-foreground">System</span> },
  ];
  return (
    <DataTable
      mode="server" columns={columns} data={q.data?.items ?? []} rowKey={(p) => p.id} loading={q.isLoading}
      error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()} total={q.data?.total} page={page} pageSize={20}
      onPageChange={setPage} exportName="bureau-pull-log" searchPlaceholder="Filter this page…" emptyTitle="No pulls match" emptyDescription={`Nothing between ${from || defaultFrom} and ${to || defaultTo} with these filters.`}
      toolbar={
        <>
          <Select aria-label="Bureau" className="w-36" value={bureau} onChange={(e) => f(setBureau)(e.target.value)}><option value="">All bureaus</option><option value="CRC">CRC</option><option value="FIRSTCENTRAL">FirstCentral</option><option value="CREDITREGISTRY">CreditRegistry</option></Select>
          <Select aria-label="Status" className="w-40" value={status} onChange={(e) => f(setStatus)(e.target.value)}><option value="">Any status</option>{['SUCCESS', 'NO_HIT', 'FAILED', 'BLOCKED_NO_CONSENT', 'CACHED'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
          <Select aria-label="Reason" className="w-40" value={reason} onChange={(e) => f(setReason)(e.target.value)}><option value="">Any reason</option>{['APPLICATION', 'PRE_DISBURSEMENT', 'ON_DEMAND', 'MONITORING'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
          <Input aria-label="From date" type="date" className="w-36" value={from} onChange={(e) => f(setFrom)(e.target.value)} />
          <Input aria-label="To date" type="date" className="w-36" value={to} onChange={(e) => f(setTo)(e.target.value)} />
        </>
      }
    />
  );
}
