'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DeliveryLogDto, Page } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { StatusBadge } from '@/components/status-badge';
import { Select } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { errorMessage, get } from '@/lib/api';

export function LogsTab() {
  const [page, setPage] = React.useState(1);
  const [channel, setChannel] = React.useState('');
  const [status, setStatus] = React.useState('');
  const q = useQuery({ queryKey: ['delivery-logs', page, channel, status], queryFn: () => get<Page<DeliveryLogDto>>('/notifications/logs', { page, pageSize: 20, channel, status }), placeholderData: (p) => p });
  const columns: DataColumn<DeliveryLogDto>[] = [
    { id: 'time', header: 'Created', sortable: true, accessor: (l) => l.createdAt, cell: (l) => <DateTime value={l.createdAt} style="short" /> },
    { id: 'channel', header: 'Channel', sortable: true, accessor: (l) => l.channel, cell: (l) => <Badge variant="secondary">{l.channel}</Badge> },
    { id: 'provider', header: 'Provider', accessor: (l) => l.provider },
    { id: 'recipient', header: 'Recipient', accessor: (l) => l.recipient, cell: (l) => <span className="font-mono text-xs">{l.recipient}</span> },
    { id: 'template', header: 'Template', accessor: (l) => l.templateKey ?? '' },
    { id: 'status', header: 'Status', sortable: true, accessor: (l) => l.status, cell: (l) => (<div><StatusBadge status={l.status} />{l.error && <p className="mt-1 max-w-48 truncate text-xs text-destructive" title={l.error}>{l.error}</p>}</div>) },
    { id: 'sent', header: 'Sent', accessor: (l) => l.sentAt, cell: (l) => <DateTime value={l.sentAt} style="short" />, defaultHidden: true },
  ];
  return (
    <DataTable
      mode="server" columns={columns} data={q.data?.items ?? []} rowKey={(l) => l.id} loading={q.isLoading}
      error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()} total={q.data?.total} page={page} pageSize={20} onPageChange={setPage}
      exportName="delivery-logs" emptyTitle="No deliveries yet" searchPlaceholder="Filter this page…"
      toolbar={<>
        <Select aria-label="Channel" className="w-36" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">All channels</option><option>SMS</option><option>EMAIL</option><option>WHATSAPP</option><option>IN_APP</option></Select>
        <Select aria-label="Status" className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option><option>QUEUED</option><option>SENT</option><option>DELIVERED</option><option>FAILED</option></Select>
      </>}
    />
  );
}
