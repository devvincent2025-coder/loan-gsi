'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { APPLICATION_STATUSES, type ApplicationStatus, type BranchDto, type EligibilityOutcome, type UnderwritingQueueItemDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { ApplicationStatusBadge, OutcomeBadge, statusLabel } from '@/components/applications/application-ui';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/form';
import { errorMessage, get } from '@/lib/api';
import { getUnderwritingQueue } from '@/lib/underwriting-api';

/** SLA badge: red once overdue, amber inside 12h, neutral otherwise. */
function SlaBadge({ hours }: { hours: number | null }) {
  if (hours === null) return <span className="text-muted-foreground">—</span>;
  const variant = hours <= 0 ? 'destructive' : hours <= 12 ? 'warning' : 'secondary';
  const label = hours <= 0 ? `${Math.abs(Math.round(hours))}h overdue` : `${Math.round(hours)}h left`;
  return <Badge variant={variant}>{label}</Badge>;
}

const QUEUE_STATUSES: ApplicationStatus[] = APPLICATION_STATUSES.filter((s) =>
  ['SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT'].includes(s),
);

export default function UnderwritingPage() {
  const router = useRouter();
  const [status, setStatus] = React.useState<ApplicationStatus | ''>('UNDER_REVIEW');
  const [branchId, setBranchId] = React.useState('');
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get<BranchDto[]>('/branches'), retry: false });
  const list = useQuery({
    queryKey: ['underwriting-queue', { status, branchId }],
    queryFn: () => getUnderwritingQueue({ status, branchId }),
  });

  const columns: DataColumn<UnderwritingQueueItemDto>[] = [
    { id: 'ref', header: 'Reference', sortable: true, accessor: (a) => a.reference, cell: (a) => <span className="font-mono text-xs font-medium">{a.reference}</span> },
    { id: 'customer', header: 'Customer', sortable: true, accessor: (a) => a.customerName, cell: (a) => <span className="font-medium">{a.customerName}</span> },
    { id: 'product', header: 'Product', sortable: true, accessor: (a) => a.productName, cell: (a) => a.productName },
    { id: 'amount', header: 'Amount', sortable: true, align: 'right', accessor: (a) => a.requestedAmountKobo, cell: (a) => <MoneyText kobo={a.requestedAmountKobo} /> },
    { id: 'tenor', header: 'Tenor', sortable: true, align: 'right', accessor: (a) => a.tenorMonths, cell: (a) => <span className="tabular">{a.tenorMonths} mo</span> },
    { id: 'status', header: 'Status', sortable: true, accessor: (a) => a.status, cell: (a) => <ApplicationStatusBadge status={a.status} /> },
    { id: 'outcome', header: 'Eligibility', sortable: true, accessor: (a) => a.eligibilityOutcome ?? '', cell: (a) => <OutcomeBadge outcome={a.eligibilityOutcome as EligibilityOutcome | null} score={a.score} /> },
    { id: 'submitted', header: 'Submitted', sortable: true, accessor: (a) => a.submittedAt ?? '', cell: (a) => <DateTime value={a.submittedAt} style="short" /> },
    { id: 'sla', header: 'SLA', sortable: true, accessor: (a) => a.slaHoursRemaining ?? '', cell: (a) => <SlaBadge hours={a.slaHoursRemaining} /> },
  ];

  return (
    <>
      <PageHeader title="Underwriting" description="Applications awaiting a credit decision." />
      <DataTable
        columns={columns}
        data={list.data ?? []}
        rowKey={(a) => a.applicationId}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => list.refetch()}
        onRowClick={(a) => router.push(`/applications/${a.applicationId}`)}
        exportName="underwriting-queue"
        searchPlaceholder="Search reference or customer…"
        emptyTitle="Queue is empty"
        emptyDescription="No applications match these filters."
        toolbar={
          <>
            <Select aria-label="Filter by status" className="w-48" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus | '')}>
              <option value="">Any status</option>
              {QUEUE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </Select>
            {branches.data && (
              <Select aria-label="Filter by branch" className="w-40" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">All branches</option>
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </>
        }
      />
    </>
  );
}
