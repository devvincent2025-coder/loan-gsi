'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import { NIGERIAN_STATES, branchSchema, type BranchDto } from '@damez/shared';
import type { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/lib/auth';
import { errorMessage, get, patch, post } from '@/lib/api';

type F = z.input<typeof branchSchema>;

export default function BranchesPage() {
  const qc = useQueryClient();
  const canManage = useCan('branch:manage');
  const q = useQuery({ queryKey: ['branches'], queryFn: () => get<BranchDto[]>('/branches') });
  const [editing, setEditing] = React.useState<BranchDto | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (b: BranchDto) => patch(`/branches/${b.id}`, { isActive: !b.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: DataColumn<BranchDto>[] = [
    { id: 'code', header: 'Code', sortable: true, accessor: (b) => b.code, cell: (b) => <span className="font-mono text-xs">{b.code}</span> },
    { id: 'name', header: 'Name', sortable: true, accessor: (b) => b.name, cell: (b) => (<span className="font-medium">{b.name} {b.isHeadOffice && <Badge className="ml-1">Head office</Badge>}</span>) },
    { id: 'state', header: 'State', sortable: true, accessor: (b) => b.state },
    { id: 'city', header: 'City', sortable: true, accessor: (b) => b.city },
    { id: 'users', header: 'Users', sortable: true, align: 'right', accessor: (b) => b.userCount, cell: (b) => <span className="tabular">{b.userCount}</span> },
    {
      id: 'active', header: 'Active', sortable: true, accessor: (b) => (b.isActive ? 'Active' : 'Inactive'),
      cell: (b) => <Switch aria-label={`${b.name} active`} checked={b.isActive} disabled={!canManage || toggle.isPending} onCheckedChange={() => toggle.mutate(b)} />,
    },
    { id: 'actions', header: '', noExport: true, cell: (b) => canManage && <Button variant="ghost" size="icon" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}><Pencil /></Button> },
  ];

  return (
    <>
      <PageHeader title="Branches" description="Offices that scope staff and customer data." actions={canManage && <Button onClick={() => setEditing('new')}><Plus /> New branch</Button>} />
      <DataTable columns={columns} data={q.data ?? []} rowKey={(b) => b.id} loading={q.isLoading} error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()} exportName="branches" savedViewsKey="branches" emptyTitle="No branches yet" searchPlaceholder="Search branches…" />
      <BranchDialog branch={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function BranchDialog({ branch, onClose }: { branch: BranchDto | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = branch === 'new';
  const f = useForm<F>({ resolver: zodResolver(branchSchema), defaultValues: { code: '', name: '', state: '', city: '', address: '', isHeadOffice: false, isActive: true } });
  React.useEffect(() => {
    if (branch === 'new') f.reset({ code: '', name: '', state: 'Lagos', city: '', address: '', isHeadOffice: false, isActive: true });
    else if (branch) f.reset({ code: branch.code, name: branch.name, state: branch.state, city: branch.city, address: branch.address ?? '', isHeadOffice: branch.isHeadOffice, isActive: branch.isActive });
  }, [branch, f]);
  const m = useMutation({
    mutationFn: (v: F) => (isNew ? post('/branches', v) : patch(`/branches/${(branch as BranchDto).id}`, v)),
    onSuccess: () => { toast.success(isNew ? 'Branch created' : 'Branch updated'); void qc.invalidateQueries({ queryKey: ['branches'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = f.formState.errors;
  return (
    <Dialog open={!!branch} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{isNew ? 'New branch' : 'Edit branch'}</DialogTitle><DialogDescription>Branch codes are upper-case letters, digits and dashes.</DialogDescription></DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={f.handleSubmit((v) => m.mutate({ ...v, address: v.address || undefined }))}>
          <FormField label="Code" htmlFor="b-code" required error={e.code?.message}><Input id="b-code" {...f.register('code')} /></FormField>
          <FormField label="Name" htmlFor="b-name" required error={e.name?.message}><Input id="b-name" {...f.register('name')} /></FormField>
          <FormField label="State" htmlFor="b-state" required error={e.state?.message}>
            <Select id="b-state" {...f.register('state')}><option value="">Select state…</option>{NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>
          </FormField>
          <FormField label="City" htmlFor="b-city" required error={e.city?.message}><Input id="b-city" {...f.register('city')} /></FormField>
          <FormField className="sm:col-span-2" label="Address" htmlFor="b-addr" error={e.address?.message}><Input id="b-addr" {...f.register('address')} /></FormField>
          <div className="flex items-center gap-2"><Switch id="b-ho" checked={!!f.watch('isHeadOffice')} onCheckedChange={(v) => f.setValue('isHeadOffice', v)} /><label htmlFor="b-ho" className="text-sm">Head office</label></div>
          <div className="flex items-center gap-2"><Switch id="b-act" checked={f.watch('isActive') !== false} onCheckedChange={(v) => f.setValue('isActive', v)} /><label htmlFor="b-act" className="text-sm">Active</label></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.isPending}>{isNew ? 'Create branch' : 'Save changes'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
