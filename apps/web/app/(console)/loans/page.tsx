'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LOAN_STATUSES, type BranchDto, type LoanDto, type LoanStatus } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { LoanStatusBadge, DpdValue, loanStatusLabel } from '@/components/loans/loan-ui';
import { Select } from '@/components/ui/form';
import { errorMessage, get } from '@/lib/api';
import { listLoans } from '@/lib/loans-api';
import { useDebounced } from '@/lib/hooks';

export default function LoansPage() {
  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<LoanStatus | ''>('');
  const [branchId, setBranchId] = React.useState('');
  const dq = useDebounced(search, 300);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get<BranchDto[]>('/branches'), retry: false });
  const list = useQuery({
    queryKey: ['loans', { page, dq, status, branchId }],
    queryFn: () => listLoans({ page, pageSize: 20, q: dq, status, branchId }),
    placeholderData: (p) => p,
  });

  const rows = React.useMemo(() => list.data?.items ?? [], [list.data]);
  // Client-side aggregation of the loaded page only — there is no dedicated loans-summary
  // endpoint yet, so these KPIs reflect the current page/filter, not the whole portfolio.
  const kpis = React.useMemo(() => {
    const active = rows.filter((l) => l.status === 'ACTIVE' || l.status === 'DISBURSED');
    const Unpaid = rows.filter((l) => l.status === 'Unpaid');
    const writtenOff = rows.filter((l) => l.status === 'WRITTEN_OFF');
    const outstandingTotal = rows.reduce((s, l) => s + l.outstandingTotalKobo, 0);
    const UnpaidAmount = Unpaid.reduce((s, l) => s + l.outstandingTotalKobo, 0);
    const writtenOffAmount = writtenOff.reduce((s, l) => s + (l.writtenOffAmountKobo ?? 0), 0);
    return { activeCount: active.length, outstandingTotal, UnpaidCount: Unpaid.length, UnpaidAmount, writtenOffCount: writtenOff.length, writtenOffAmount };
  }, [rows]);

  const columns: DataColumn<LoanDto>[] = [
    { id: 'reference', header: 'Reference', sortable: true, accessor: (l) => l.reference, cell: (l) => <span className="font-mono text-xs font-medium">{l.reference}</span> },
    {
      id: 'customer', header: 'Customer', sortable: true, accessor: (l) => l.customerName,
      cell: (l) => (
        <a href={`/customers/${l.customerId}`} className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
          {l.customerName}
        </a>
      ),
    },
    { id: 'product', header: 'Product', sortable: true, accessor: (l) => l.productName, cell: (l) => l.productName },
    { id: 'principal', header: 'Principal', sortable: true, align: 'right', accessor: (l) => l.principalKobo, cell: (l) => <MoneyText kobo={l.principalKobo} /> },
    { id: 'outstanding', header: 'Outstanding', sortable: true, align: 'right', accessor: (l) => l.outstandingTotalKobo, cell: (l) => <MoneyText kobo={l.outstandingTotalKobo} /> },
    { id: 'dpd', header: 'DPD', sortable: true, align: 'right', accessor: (l) => l.dpd, cell: (l) => <DpdValue dpd={l.dpd} /> },
    { id: 'status', header: 'Status', sortable: true, accessor: (l) => l.status, cell: (l) => <LoanStatusBadge status={l.status} /> },
    { id: 'disbursed', header: 'Disbursed', sortable: true, accessor: (l) => l.disbursedAt, cell: (l) => <DateTime value={l.disbursedAt} style="date" /> },
    { id: 'maturity', header: 'Maturity', sortable: true, accessor: (l) => l.maturityDate, cell: (l) => <DateTime value={l.maturityDate} style="date" /> },
  ];

  return (
    <>
      <PageHeader title="Loans" description="" />

      <section aria-label="Key metrics" className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {list.isLoading ? (
          Array.from({ length: 4 }, (_, i) => <KpiCard key={i} loading label="" value="" />)
        ) : (
          <>
            <KpiCard label="Active loans" value={kpis.activeCount.toLocaleString('en-NG')} />
            <KpiCard label="Outstanding" value={<MoneyText kobo={kpis.outstandingTotal} compact />} />
            <KpiCard label="Overdue" value={`${kpis.UnpaidCount} · ${(kpis.UnpaidAmount / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })}`} />
            <KpiCard label="Written off" value={<MoneyText kobo={kpis.writtenOffAmount} compact />} />
          </>
        )}
      </section>

      <DataTable
        mode="server"
        columns={columns}
        data={rows}
        rowKey={(l) => l.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => list.refetch()}
        total={list.data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        onRowClick={(l) => router.push(`/loans/${l.id}`)}
        exportName="loans"
        savedViewsKey="loans"
        searchPlaceholder="Search reference or customer…"
        emptyTitle="No loans match"
        emptyDescription="Try different filters."
        toolbar={
          <>
            <Select aria-label="Filter by status" className="w-44" value={status} onChange={(e) => { setStatus(e.target.value as LoanStatus | ''); setPage(1); }}>
              <option value="">Any status</option>
              {LOAN_STATUSES.map((s) => <option key={s} value={s}>{loanStatusLabel(s)}</option>)}
            </Select>
            {branches.data && (
              <Select aria-label="Filter by branch" className="w-40" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
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
