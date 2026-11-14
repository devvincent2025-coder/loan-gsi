'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Radar } from 'lucide-react';
import type { Page, RiskFlagDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage, get, post } from '@/lib/api';
import { titleCase } from '@/lib/utils';

export function MonitoringTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const q = useQuery({ queryKey: ['bureau-alerts', page], queryFn: () => get<Page<RiskFlagDto>>('/bureau/monitoring/alerts', { page, pageSize: 20 }), placeholderData: (p) => p });
  const run = useMutation({
    mutationFn: () => post<{ checked: number; alerts: number }>('/bureau/monitoring/run', {}),
    onSuccess: (r) => { toast.success(`Monitoring complete: ${r.checked} customer(s) checked, ${r.alerts} new alert(s)`); void qc.invalidateQueries({ queryKey: ['bureau-alerts'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: DataColumn<RiskFlagDto>[] = [
    { id: 'when', header: 'Raised', sortable: true, accessor: (f) => f.createdAt, cell: (f) => <DateTime value={f.createdAt} style="short" /> },
    { id: 'customer', header: 'Customer', accessor: (f) => f.customerName, cell: (f) => <Link href={`/customers/${f.customerId}`} className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{f.customerName}</Link> },
    { id: 'type', header: 'Type', accessor: (f) => f.type, cell: (f) => titleCase(f.type) },
    { id: 'severity', header: 'Severity', sortable: true, accessor: (f) => f.severity, cell: (f) => <Badge variant={f.severity === 'HIGH' ? 'destructive' : f.severity === 'MEDIUM' ? 'warning' : 'secondary'}>{titleCase(f.severity)}</Badge> },
    { id: 'detail', header: 'Detail', accessor: (f) => f.detail, cell: (f) => <span className="block max-w-md truncate" title={f.detail}>{f.detail}</span> },
    { id: 'source', header: 'Source', accessor: (f) => f.source, cell: (f) => titleCase(f.source), defaultHidden: true },
    { id: 'active', header: 'State', accessor: (f) => (f.active ? 'Active' : 'Cleared'), cell: (f) => <Badge variant={f.active ? 'warning' : 'secondary'}>{f.active ? 'Active' : 'Cleared'}</Badge> },
  ];
  return (
    <DataTable
      mode="server" columns={columns} data={q.data?.items ?? []} rowKey={(f) => f.id} loading={q.isLoading} error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()}
      total={q.data?.total} page={page} pageSize={20} onPageChange={setPage} exportName="bureau-monitoring-alerts" searchPlaceholder="Filter this page…" emptyTitle="No monitoring alerts" emptyDescription="Alerts appear when monitoring finds new delinquencies, score drops or watchlist hits."
      toolbar={canManage && <Button size="sm" loading={run.isPending} onClick={() => run.mutate()}><Radar /> Run monitoring</Button>}
    />
  );
}
