'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BranchDto, CustomerDto, Page } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { KycStatusBadge } from '@/components/customers/customer-ui';
import { CreateCustomerDialog } from '@/components/customers/create-customer-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { useCan, useMe } from '@/lib/auth';
import { errorMessage, del, get } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';

const Masked = ({ v }: { v: string | null }) => (v ? <span className="inline-flex items-center gap-1 font-mono text-xs"><Lock className="size-3 text-muted-foreground" aria-hidden />{v}</span> : <span className="text-muted-foreground">—</span>);

export default function CustomersPage() {
  const router = useRouter();
  const me = useMe();
  const qc = useQueryClient();
  const canDelete = me.role.key === 'super_admin';
  const canCreate = useCan('customer:create');
  const [creating, setCreating] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [kyc, setKyc] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [erasing, setErasing] = React.useState<CustomerDto | null>(null);
  const dq = useDebounced(search, 300);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get<BranchDto[]>('/branches'), retry: false });
  const list = useQuery({
    queryKey: ['customers', { page, dq, kyc, branchId }],
    queryFn: () => get<Page<CustomerDto>>('/customers', { page, pageSize: 20, q: dq, kycStatus: kyc, branchId }),
    placeholderData: (p) => p,
  });
  const eraseMutation = useMutation({
    mutationFn: (id: string) => del(`/customers/${id}`),
    onSuccess: () => { toast.success('Customer record erased'); void qc.invalidateQueries({ queryKey: ['customers'] }); setErasing(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: DataColumn<CustomerDto>[] = [
    { id: 'name', header: 'Customer', sortable: true, accessor: (c) => c.fullName, cell: (c) => <span className="font-medium">{c.fullName}</span> },
    { id: 'phone', header: 'Phone', accessor: (c) => c.phone, cell: (c) => <Masked v={c.phone} /> },
    { id: 'email', header: 'Email', accessor: (c) => c.email ?? '', cell: (c) => <Masked v={c.email} />, defaultHidden: true },
    { id: 'bvn', header: 'BVN', accessor: (c) => c.bvn, cell: (c) => <Masked v={c.bvn} /> },
    { id: 'kyc', header: 'KYC', sortable: true, accessor: (c) => c.kycStatus, cell: (c) => <KycStatusBadge status={c.kycStatus} /> },
    { id: 'state', header: 'State', sortable: true, accessor: (c) => c.state ?? '', cell: (c) => c.state ?? '—' },
    { id: 'branch', header: 'Branch', sortable: true, accessor: (c) => c.branch?.name ?? '', cell: (c) => c.branch?.name ?? '—' },
    { id: 'created', header: 'Joined', sortable: true, accessor: (c) => c.createdAt, cell: (c) => <DateTime value={c.createdAt} style="date" /> },
    ...(canDelete ? [{
      id: 'actions', header: '', accessor: () => '', cell: (c: CustomerDto) => (
        <Button variant="ghost" size="icon" className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="Erase customer"
          onClick={(e) => { e.stopPropagation(); setErasing(c); }}>
          <Trash2 className="size-4" />
        </Button>
      ),
    } as DataColumn<CustomerDto>] : []),
  ];
  return (
    <>
      <PageHeader
        title="Customers"
        description="Borrowers, KYC status and credit records."
        actions={canCreate && <Button onClick={() => setCreating(true)}><Plus /> Add customer</Button>}
      />
      <DataTable
        mode="server"
        columns={columns}
        data={list.data?.items ?? []}
        rowKey={(c) => c.id}
        loading={list.isLoading}
        error={list.isError ? errorMessage(list.error) : null}
        onRetry={() => list.refetch()}
        total={list.data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        onRowClick={(c) => router.push(`/customers/${c.id}`)}
        exportName="customers"
        savedViewsKey="customers"
        searchPlaceholder="Search name, phone or BVN…"
        emptyTitle="No customers found"
        emptyDescription="Customers appear here once they register on the portal or are created at a branch."
        toolbar={
          <>
            <Select aria-label="Filter by KYC status" className="w-36" value={kyc} onChange={(e) => { setKyc(e.target.value); setPage(1); }}>
              <option value="">Any KYC</option><option value="VERIFIED">Verified</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option>
            </Select>
            {branches.data && (
              <Select aria-label="Filter by branch" className="w-40" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
                <option value="">All branches</option>{branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </>
        }
      />

      <CreateCustomerDialog open={creating} onOpenChange={setCreating} />

      <Dialog open={erasing !== null} onOpenChange={(o) => !o && setErasing(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Erase &ldquo;{erasing?.fullName}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently erases the customer record. Customers with active loans cannot be erased.
              The action is audited and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErasing(null)}>Cancel</Button>
            <Button
              variant="destructive"
              loading={eraseMutation.isPending}
              onClick={() => erasing && eraseMutation.mutate(erasing.id)}
            >
              Erase customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
