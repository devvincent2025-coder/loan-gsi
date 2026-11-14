'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { LoanProductDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { MoneyText } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';

export function ProductsTab() {
  const canUpdate = useCan('product:update');
  const canSubmit = useCan('approval:submit');
  const canRequest = canUpdate && canSubmit;
  const q = useQuery({ queryKey: ['products'], queryFn: () => get<LoanProductDto[]>('/settings/products') });
  const columns: DataColumn<LoanProductDto>[] = [
    { id: 'name', header: 'Product', sortable: true, accessor: (p) => p.name, cell: (p) => <div><p className="font-medium">{p.name}</p><p className="font-mono text-xs text-muted-foreground">{p.code}</p></div> },
    { id: 'amount', header: 'Amount range', accessor: (p) => `${p.minAmountKobo}-${p.maxAmountKobo}`, cell: (p) => <span className="tabular"><MoneyText kobo={p.minAmountKobo} compact /> – <MoneyText kobo={p.maxAmountKobo} compact /></span> },
    { id: 'rate', header: 'Monthly rate', sortable: true, align: 'right', accessor: (p) => p.monthlyRateBps / 100, cell: (p) => <span className="tabular">{(p.monthlyRateBps / 100).toFixed(2)}%</span> },
    { id: 'tenor', header: 'Tenor', accessor: (p) => `${p.minTenorMonths}-${p.maxTenorMonths} mo`, cell: (p) => <span className="tabular">{p.minTenorMonths}–{p.maxTenorMonths} mo</span> },
    { id: 'active', header: 'Status', accessor: (p) => (p.isActive ? 'Active' : 'Inactive'), cell: (p) => <StatusBadge status={p.isActive ? 'ACTIVE' : 'DISABLED'} label={p.isActive ? 'Active' : 'Inactive'} /> },
    { id: 'actions', header: '', noExport: true, cell: (p) => canRequest && <Button asChild size="sm" variant="outline"><Link href={`/approvals?new=PRODUCT_RATE_CHANGE&productId=${p.id}`}>Request rate change</Link></Button> },
  ];
  const canManage = useCan('product:read');
  return (
    <>
      {canManage && <div className="mb-3 flex justify-end"><Button asChild size="sm" variant="outline"><Link href="/products">Manage products</Link></Button></div>}
      <DataTable columns={columns} data={q.data ?? []} rowKey={(p) => p.id} loading={q.isLoading} error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()} exportName="products" emptyTitle="No products" searchPlaceholder="Search products…" />
    </>
  );
}
