'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, MoreHorizontal, Plus, ShieldOff } from 'lucide-react';
import type { BranchDto, Page, RoleDto, UserDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { DataTable, type DataColumn } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { DateTime } from '@/components/date-time';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/form';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCan } from '@/lib/auth';
import { errorMessage, get, post } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { CreateUserDialog, EditUserDialog, ResetPasswordDialog, RoleChangeDialog } from './user-dialogs';

type Action = 'lock' | 'unlock' | 'deactivate' | 'activate' | 'reset-totp';

export default function UsersPage() {
  const qc = useQueryClient();
  const canCreate = useCan('user:create');
  const canUpdate = useCan('user:update');
  const canDeactivate = useCan('user:deactivate');
  const canUnlock = useCan('user:unlock');
  const canRoleChange = useCan('user:role_change');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [roleId, setRoleId] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [status, setStatus] = React.useState('');
  const dq = useDebounced(search, 300);

  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<RoleDto[]>('/roles') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get<BranchDto[]>('/branches') });
  const users = useQuery({
    queryKey: ['users', { page, dq, roleId, branchId, status }],
    queryFn: () => get<Page<UserDto>>('/users', { page, pageSize: 20, q: dq, roleId, branchId, status }),
    placeholderData: (p) => p,
  });

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<UserDto | null>(null);
  const [resetting, setResetting] = React.useState<UserDto | null>(null);
  const [roleChange, setRoleChange] = React.useState<UserDto | null>(null);
  const [confirm, setConfirm] = React.useState<{ user: UserDto; action: Action } | null>(null);
  const [pendingNotice, setPendingNotice] = React.useState(false);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => post(`/users/${id}/${action}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const run = async (user: UserDto, action: Action) => {
    await act.mutateAsync({ id: user.id, action });
    toast.success(`${user.fullName}: ${action.replace('-', ' ')} done`);
    setConfirm(null);
    void invalidate();
  };

  const columns: DataColumn<UserDto>[] = [
    {
      id: 'name', header: 'User', sortable: true, accessor: (u) => u.fullName,
      cell: (u) => (<div className="min-w-0"><p className="truncate font-medium">{u.fullName}</p><p className="truncate text-xs text-muted-foreground">{u.email}</p></div>),
    },
    { id: 'role', header: 'Role', sortable: true, accessor: (u) => u.role.name, cell: (u) => <Badge variant="secondary">{u.role.name}</Badge> },
    { id: 'branch', header: 'Branch', sortable: true, accessor: (u) => (u.allBranches ? 'All branches' : (u.branch?.name ?? '')), cell: (u) => (u.allBranches ? 'All branches' : (u.branch?.name ?? '—')) },
    { id: 'phone', header: 'Phone', accessor: (u) => u.phone ?? '', cell: (u) => (<span className="inline-flex items-center gap-1 font-mono text-xs"><Lock className="size-3 text-muted-foreground" aria-hidden />{u.phone ?? '—'}</span>) },
    { id: 'status', header: 'Status', sortable: true, accessor: (u) => u.status, cell: (u) => <StatusBadge status={u.status} /> },
    { id: 'totp', header: '2FA', accessor: (u) => (u.totpEnabled ? 'Enabled' : 'Not set'), defaultHidden: true },
    { id: 'lastLogin', header: 'Last login', sortable: true, accessor: (u) => u.lastLoginAt, cell: (u) => <DateTime value={u.lastLoginAt} style="short" /> },
    { id: 'created', header: 'Created', accessor: (u) => u.createdAt, cell: (u) => <DateTime value={u.createdAt} style="date" />, defaultHidden: true },
    {
      id: 'actions', header: '', noExport: true, className: 'w-10',
      cell: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${u.fullName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUpdate && <DropdownMenuItem onSelect={() => setEditing(u)}>Edit details</DropdownMenuItem>}
            {canRoleChange && <DropdownMenuItem onSelect={() => setRoleChange(u)}>Change role…</DropdownMenuItem>}
            <DropdownMenuSeparator />
            {canUnlock && u.status === 'LOCKED' && <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: 'unlock' })}>Unlock</DropdownMenuItem>}
            {canDeactivate && u.status === 'ACTIVE' && <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: 'lock' })}>Lock</DropdownMenuItem>}
            {canDeactivate && u.status !== 'DISABLED' && <DropdownMenuItem destructive onSelect={() => setConfirm({ user: u, action: 'deactivate' })}>Deactivate</DropdownMenuItem>}
            {canDeactivate && u.status === 'DISABLED' && <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: 'activate' })}>Activate</DropdownMenuItem>}
            {canUnlock && <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: 'reset-totp' })}>Reset 2FA</DropdownMenuItem>}
            {canUpdate && <DropdownMenuItem onSelect={() => setResetting(u)}>Reset password…</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const confirmCopy: Record<Action, string> = {
    lock: 'They will be unable to sign in until unlocked.',
    unlock: 'They will be able to sign in again.',
    deactivate: 'Their account will be disabled and sessions revoked.',
    activate: 'Their account will be re-enabled.',
    'reset-totp': 'They will be asked to enrol a new authenticator at next sign in.',
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts, roles and access status."
        actions={canCreate && <Button onClick={() => setCreating(true)}><Plus /> New user</Button>}
      />
      {pendingNotice && (
        <div role="status" className="mb-4 flex items-center justify-between rounded-md border border-info/30 bg-info/10 px-4 py-3 text-sm">
          <span>Role change submitted for approval. It takes effect once a checker approves it.</span>
          <Link href="/approvals" className="font-medium text-primary underline-offset-4 hover:underline">View approvals</Link>
        </div>
      )}
      <DataTable
        mode="server"
        columns={columns}
        data={users.data?.items ?? []}
        rowKey={(u) => u.id}
        loading={users.isLoading}
        error={users.isError ? errorMessage(users.error) : null}
        onRetry={() => users.refetch()}
        total={users.data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        selectable={canDeactivate}
        savedViewsKey="users"
        exportName="users"
        searchPlaceholder="Search name or email…"
        emptyTitle="No users match"
        emptyDescription="Try changing the filters or search."
        toolbar={
          <>
            <Select aria-label="Filter by role" className="w-40" value={roleId} onChange={(e) => { setRoleId(e.target.value); setPage(1); }}>
              <option value="">All roles</option>
              {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Select aria-label="Filter by branch" className="w-40" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
              <option value="">All branches</option>
              {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select aria-label="Filter by status" className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="LOCKED">Locked</option>
              <option value="DISABLED">Disabled</option>
            </Select>
          </>
        }
        bulkActions={(rows, clear) => (
          <>
            <Button size="sm" variant="outline" onClick={async () => { for (const u of rows) await act.mutateAsync({ id: u.id, action: 'lock' }).catch(() => undefined); toast.success(`Locked ${rows.length} user(s)`); clear(); void invalidate(); }}><Lock /> Lock</Button>
            <Button size="sm" variant="outline" onClick={async () => { for (const u of rows) await act.mutateAsync({ id: u.id, action: 'deactivate' }).catch(() => undefined); toast.success(`Deactivated ${rows.length} user(s)`); clear(); void invalidate(); }}><ShieldOff /> Deactivate</Button>
          </>
        )}
      />
      <CreateUserDialog open={creating} onOpenChange={setCreating} roles={roles.data ?? []} branches={branches.data ?? []} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} branches={branches.data ?? []} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      <RoleChangeDialog user={roleChange} onClose={() => setRoleChange(null)} roles={roles.data ?? []} onSubmitted={() => setPendingNotice(true)} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `${confirm.action.replace('-', ' ')}: ${confirm.user.fullName}?` : ''}
        description={confirm ? confirmCopy[confirm.action] : undefined}
        destructive={confirm?.action === 'deactivate' || confirm?.action === 'lock'}
        loading={act.isPending}
        confirmLabel="Confirm"
        onConfirm={async () => { if (confirm) await run(confirm.user, confirm.action); }}
      />
      
    </>
  );
}
