'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type ApplicationSummaryDto, type BranchDto, type Page } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { ApplicationStatusBadge, OutcomeBadge, STATUS_GROUPS, statusLabel } from '@/components/applications/application-ui';
import { CreateApplicationDialog } from '@/components/applications/create-application-dialog';
import { useProductOptions } from '@/components/applications/use-products';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';

export default function ApplicationsPage() {
  const router = useRouter();
  const canCreate = useCan('application:create');
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [productId, setProductId] = React.useState('');
  const [outcome, setOutcome] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const dq = useDebounced(search, 300);
  const products = useProductOptions();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get<BranchDto[]>('/branches'), retry: false });
  const list = useQuery({
    queryKey: ['applications', { page, dq, status, productId, outcome, branchId }],
    queryFn: () => get<Page<ApplicationSummaryDto>>('/applications', { page, pageSize: 20, q: dq, status, productId, outcome, branchId }),
    placeholderData: (p) => p,
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const columns: DataColumn<ApplicationSummaryDto>[] = [
    { id: 'ref', header: 'Reference', sortable: true, accessor: (a) => a.reference, cell: (a) => <span className="font-mono text-xs font-medium">{a.reference}</span> },
    { id: 'customer', header: 'Customer', sortable: true, accessor: (a) => a.customer.name, cell: (a) => <span className="font-medium">{a.customer.name}</span> },
    { id: 'product', header: 'Product', sortable: true, accessor: (a) => a.product.name, cell: (a) => a.product.name },
    { id: 'amount', header: 'Amount', sortable: true, align: 'right', accessor: (a) => a.amountKobo, cell: (a) => <MoneyText kobo={a.amountKobo} /> },
    { id: 'tenor', header: 'Tenor', sortable: true, align: 'right', accessor: (a) => a.tenorMonths, cell: (a) => <span className="tabular">{a.tenorMonths} mo</span> },
    { id: 'status', header: 'Status', sortable: true, accessor: (a) => a.status, cell: (a) => <ApplicationStatusBadge status={a.status} /> },
    { id: 'outcome', header: 'Eligibility', sortable: true, accessor: (a) => a.eligibilityOutcome ?? '', cell: (a) => <OutcomeBadge outcome={a.eligibilityOutcome} score={a.score} /> },
    { id: 'branch', header: 'Branch', accessor: (a) => a.branch?.name ?? '', cell: (a) => a.branch?.name ?? '—' },
    { id: 'submitted', header: 'Submitted', sortable: true, accessor: (a) => a.submittedAt ?? a.createdAt, cell: (a) => <DateTime value={a.submittedAt ?? a.createdAt} style="short" /> },
  ];

  return (
    <>
      <PageHeader
        title="Applications"
        description="Loan applications across all channels, with eligibility outcome and score."
        actions={canCreate && <Button onClick={() => setCreating(true)}><Plus /> New application</Button>}
      />
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
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        onRowClick={(a) => router.push(`/applications/${a.id}`)}
        exportName="applications"
        savedViewsKey="applications"
        searchPlaceholder="Search reference or customer…"
        emptyTitle="No applications match"
        emptyDescription="Try different filters, or create an application on behalf of a customer."
        toolbar={
          <>
            <Select aria-label="Filter by status" className="w-44" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
              <option value="">Any status</option>
              {STATUS_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</optgroup>)}
            </Select>
            <Select aria-label="Filter by product" className="w-40" value={productId} onChange={(e) => reset(setProductId)(e.target.value)}>
              <option value="">All products</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select aria-label="Filter by eligibility outcome" className="w-40" value={outcome} onChange={(e) => reset(setOutcome)(e.target.value)}>
              <option value="">Any outcome</option><option value="ELIGIBLE">Eligible</option><option value="CONDITIONAL">Conditional</option><option value="INELIGIBLE">Ineligible</option>
            </Select>
            {branches.data && (
              <Select aria-label="Filter by branch" className="w-40" value={branchId} onChange={(e) => reset(setBranchId)(e.target.value)}>
                <option value="">All branches</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </>
        }
      />
      <CreateApplicationDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
