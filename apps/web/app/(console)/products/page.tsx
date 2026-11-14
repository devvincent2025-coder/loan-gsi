'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LoanProductFullDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { MoneyText } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCan, useMe } from '@/lib/auth';
import { errorMessage, del, get } from '@/lib/api';
import { titleCase } from '@/lib/utils';
import { ProductForm } from './product-form';

export default function ProductsPage() {
  const me = useMe();
  const canCreate = useCan('product:create');
  const canDelete = me.role.key === 'super_admin';
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<LoanProductFullDto | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<LoanProductFullDto | null>(null);
  const q = useQuery({ queryKey: ['products', 'full'], queryFn: () => get<LoanProductFullDto[]>('/products') });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/products/${id}`),
    onSuccess: () => { toast.success('Product deleted'); void qc.invalidateQueries({ queryKey: ['products'] }); setDeleting(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: DataColumn<LoanProductFullDto>[] = [
    { id: 'name', header: 'Product', sortable: true, accessor: (p) => p.name, cell: (p) => <p className="font-medium">{p.name}</p> },
    { id: 'amount', header: 'Amount range', accessor: (p) => `${p.minAmountKobo}-${p.maxAmountKobo}`, cell: (p) => <span className="tabular"><MoneyText kobo={p.minAmountKobo} compact /> – <MoneyText kobo={p.maxAmountKobo} compact /></span> },
    { id: 'rate', header: 'Rate / month', sortable: true, align: 'right', accessor: (p) => p.monthlyRateBps / 100, cell: (p) => <span className="tabular">{(p.monthlyRateBps / 100).toFixed(2)}%</span> },
    { id: 'method', header: 'Method', accessor: (p) => p.interestMethod, cell: (p) => titleCase(p.interestMethod) },
    { id: 'tenor', header: 'Tenor', accessor: (p) => `${p.minTenorMonths}-${p.maxTenorMonths}`, cell: (p) => <span className="tabular">{p.minTenorMonths}–{p.maxTenorMonths} mo</span> },
    { id: 'kyc', header: 'Min KYC', accessor: (p) => p.minKycTier, cell: (p) => <Badge variant="secondary">Tier {p.minKycTier}</Badge> },
    { id: 'scorecard', header: 'Scorecard', accessor: (p) => p.scorecardKey, cell: (p) => <span className="font-mono text-xs">{p.scorecardKey}</span>, defaultHidden: true },
    { id: 'active', header: 'Status', sortable: true, accessor: (p) => (p.isActive ? 'Active' : 'Inactive'), cell: (p) => <StatusBadge status={p.isActive ? 'ACTIVE' : 'DISABLED'} label={p.isActive ? 'Active' : 'Inactive'} /> },
    ...(canDelete ? [{
      id: 'actions', header: '', accessor: () => '', cell: (p: LoanProductFullDto) => (
        <Button variant="ghost" size="icon" className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="Delete product"
          onClick={(e) => { e.stopPropagation(); setDeleting(p); }}>
          <Trash2 className="size-4" />
        </Button>
      ),
    } as DataColumn<LoanProductFullDto>] : []),
  ];
  return (
    <>
      <PageHeader title="Loan products" description="Pricing, limits and eligibility rules. Pricing changes needs approval." actions={canCreate && <Button onClick={() => setEditing('new')}><Plus /> New product</Button>} />
      <DataTable columns={columns} data={q.data ?? []} rowKey={(p) => p.id} loading={q.isLoading} error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()} onRowClick={(p) => setEditing(p)} exportName="loan-products" emptyTitle="No products" searchPlaceholder="Search products…" />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleting?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently removes the product. Products with any loan or application history cannot be deleted — deactivate them instead.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              Delete product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="max-w-3xl">
          <SheetHeader><SheetTitle>{editing === 'new' ? 'New product' : (editing?.name ?? 'Product')}</SheetTitle><SheetDescription>{editing === 'new' ? 'Created inactive: activate it once you are happy with the pricing.' : 'Edit product settings. Pricing changes are submitted for approval.'}</SheetDescription></SheetHeader>
          {editing && <ProductForm key={editing === 'new' ? 'new' : editing.id} product={editing === 'new' ? null : editing} onDone={(p) => { if (editing !== 'new') setEditing(p); else setEditing(null); }} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
