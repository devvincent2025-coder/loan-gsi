'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatNaira } from '@damez/shared';
import type { CollectionCaseDto, CollectionBucket, CollectionStatus, CollectionsQueueSummaryDto, Page } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { DataTable, type DataColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { get, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

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

function BucketBadge({ bucket }: { bucket: CollectionBucket }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BUCKET_STYLE[bucket])}>{BUCKET_LABEL[bucket]}</span>;
}

function StatusBadge({ status }: { status: CollectionStatus }) {
  const v = status === 'SETTLED' || status === 'CLOSED' ? 'success' : status === 'LEGAL' || status === 'WRITTEN_OFF' ? 'destructive' : status === 'IN_PROGRESS' || status === 'PROMISE_TO_PAY' ? 'warning' : 'secondary';
  return <Badge variant={v}>{status.replace(/_/g, ' ')}</Badge>;
}

const COLUMNS: DataColumn<CollectionCaseDto>[] = [
  { id: 'customer', header: 'Customer', cell: (r) => <span className="font-medium">{r.customerName}</span>, accessor: (r) => r.customerName, sortable: true },
  { id: 'ref', header: 'Loan Ref', cell: (r) => <span className="font-mono text-xs">{r.loanReference}</span>, accessor: (r) => r.loanReference },
  { id: 'product', header: 'Product', accessor: (r) => r.productName },
  { id: 'dpd', header: 'DPD', cell: (r) => <span className="tabular font-semibold">{r.dpd}</span>, accessor: (r) => r.dpd, sortable: true, align: 'right' },
  { id: 'bucket', header: 'Bucket', cell: (r) => <BucketBadge bucket={r.bucket} />, accessor: (r) => r.bucket },
  { id: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, accessor: (r) => r.status },
  { id: 'outstanding', header: 'Outstanding', cell: (r) => <span className="tabular">{formatNaira(r.totalOutstandingKobo)}</span>, accessor: (r) => r.totalOutstandingKobo, sortable: true, align: 'right' },
  { id: 'agent', header: 'Agent', cell: (r) => r.assignedToName ?? <span className="text-muted-foreground">—</span>, accessor: (r) => r.assignedToName ?? '' },
  { id: 'lastActivity', header: 'Last Activity', cell: (r) => r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' }) : '—', accessor: (r) => r.lastActivityAt ?? '' },
  {
    id: 'actions', header: '', noExport: true,
    cell: (r) => (
      <Button asChild size="sm" variant="outline">
        <Link href={`/collections/${r.id}`}>View</Link>
      </Button>
    ),
  },
];

const BUCKETS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All buckets' },
  { value: 'DPD_1_7', label: '1–7 DPD' },
  { value: 'DPD_8_30', label: '8–30 DPD' },
  { value: 'DPD_31_60', label: '31–60 DPD' },
  { value: 'DPD_61_90', label: '61–90 DPD' },
  { value: 'DPD_90_PLUS', label: '90+ DPD (NPL)' },
];

const STATUSES: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'PROMISE_TO_PAY', label: 'Promise to Pay' },
  { value: 'LEGAL', label: 'Legal' },
  { value: 'AGENCY', label: 'Agency' },
  { value: 'WRITTEN_OFF', label: 'Written Off' },
  { value: 'SETTLED', label: 'Settled' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function CollectionsPage() {
  const [bucket, setBucket] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);

  const summary = useQuery({ queryKey: ['collections-summary'], queryFn: () => get<CollectionsQueueSummaryDto>('/collections/summary'), refetchInterval: 60_000 });
  const cases = useQuery({
    queryKey: ['collections', bucket, status, page],
    queryFn: () => get<Page<CollectionCaseDto>>('/collections', { page, pageSize: 20, ...(bucket && { bucket }), ...(status && { status }) }),
    placeholderData: (p) => p,
    refetchInterval: 60_000,
  });

  const s = summary.data;

  return (
    <>
      <PageHeader title="Loan Recovery" description="Unpaid loans and recovery management." />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard loading={summary.isLoading} label="Total Cases" value={s ? s.total.toLocaleString('en-NG') : '—'} />
        <KpiCard loading={summary.isLoading} label="Total Outstanding" value={s ? formatNaira(s.totalOutstandingKobo, { compact: true }) : '—'} />
        <KpiCard loading={summary.isLoading} label="Avg DPD" value={s ? s.avgDpd.toFixed(1) : '—'} />
        <KpiCard loading={summary.isLoading} label="PTP Break Rate" value={s ? `${(s.ptpBreakRate * 100).toFixed(1)}%` : '—'} invertDelta />
        <KpiCard loading={summary.isLoading} label="30d Cure Rate" value={s ? `${(s.cureRate30d * 100).toFixed(1)}%` : '—'} />
      </section>

      <p className='m-5'>
        Abbreviations and Meaning. <br />
        1. PTP - Promise to Pay <br /> 2. DPD - Days Past Due
      </p>

      {s && s.agentLeaderboard.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Agent Leaderboard</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">#</th>
                  <th className="px-4 py-2.5 text-left font-medium">Agent</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cases</th>
                  <th className="px-4 py-2.5 text-right font-medium">PTPs Kept</th>
                  <th className="px-4 py-2.5 text-right font-medium">Recovered</th>
                </tr>
              </thead>
              <tbody>
                {s.agentLeaderboard.slice(0, 5).map((row, i) => (
                  <tr key={row.agentId} className="border-t">
                    <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium">{row.agentName}</td>
                    <td className="px-4 py-2.5 text-right tabular">{row.casesHandled}</td>
                    <td className="px-4 py-2.5 text-right tabular">{row.ptpKept}</td>
                    <td className="px-4 py-2.5 text-right tabular">{formatNaira(row.amountRecoveredKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-4">
        <DataTable
          mode="server"
          columns={COLUMNS}
          data={cases.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={cases.isLoading}
          error={cases.isError ? errorMessage(cases.error) : null}
          onRetry={() => cases.refetch()}
          total={cases.data?.total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          exportName="collections"
          savedViewsKey="collections"
          emptyTitle="No collection cases"
          emptyDescription="No cases match the current filters."
          toolbar={
            <div className="flex flex-wrap gap-2">
              <Select value={bucket} onChange={(e) => { setBucket(e.target.value); setPage(1); }} className="h-9 w-40">
                {BUCKETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </Select>
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-44">
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </div>
          }
        />
      </div>
    </>
  );
}
