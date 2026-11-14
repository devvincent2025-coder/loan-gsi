'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Plus, Users } from 'lucide-react';
import { SUPER_ADMIN_ROLE_KEY, type PermissionCatalogDto, type RoleDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/lib/auth';
import { errorMessage, get, put } from '@/lib/api';
import { PermissionMatrix } from './matrix';
import { ApprovalLimitsPanel } from './limits';
import { NewRoleDialog } from './new-role-dialog';
import { DiffDialog, computeDiff, type Draft } from './diff-dialog';

export default function RolesPage() {
  const qc = useQueryClient();
  const canEdit = useCan('permission:matrix_edit');
  const canCreate = useCan('role:update');
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<RoleDto[]>('/roles') });
  const catalog = useQuery({ queryKey: ['permissions'], queryFn: () => get<PermissionCatalogDto>('/permissions') });
  const [draft, setDraft] = React.useState<Draft>({});
  const [diffOpen, setDiffOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [newRole, setNewRole] = React.useState(false);

  const base: Draft = React.useMemo(() => Object.fromEntries((roles.data ?? []).map((r) => [r.id, r.permissions])), [roles.data]);
  const current: Draft = React.useMemo(() => ({ ...base, ...draft }), [base, draft]);
  const diff = React.useMemo(() => computeDiff(roles.data ?? [], base, current), [roles.data, base, current]);

  const toggle = (roleId: string, perms: string[], on: boolean) => {
    setDraft((d) => {
      const cur = new Set(d[roleId] ?? base[roleId] ?? []);
      perms.forEach((p) => (on ? cur.add(p) : cur.delete(p)));
      return { ...d, [roleId]: [...cur] };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const ch of diff) await put(`/roles/${ch.role.id}/permissions`, { permissions: current[ch.role.id] });
      toast.success(`Saved permissions for ${diff.length} role(s)`);
      setDraft({});
      setDiffOpen(false);
      await qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description={canEdit ? 'Toggle permissions per role, then review and save.' : 'Read-only: you need permission:matrix_edit to change roles.'}
        actions={canCreate && <Button variant="outline" onClick={() => setNewRole(true)}><Plus /> New role</Button>}
      />
      {roles.isError && <Card><ErrorState message={errorMessage(roles.error)} onRetry={() => roles.refetch()} /></Card>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {roles.isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        {roles.data?.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold leading-tight">{r.name}</p>
              {r.key === SUPER_ADMIN_ROLE_KEY && <Lock className="size-4 text-muted-foreground" aria-label="Locked" />}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant="secondary"><Users className="size-3" /> {r.userCount}</Badge>
              <Badge variant="outline" className="tabular">{(current[r.id] ?? r.permissions).length} perms</Badge>
              {r.branchScoped && <Badge variant="info">Branch-scoped</Badge>}
            </div>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="matrix">
        <TabsList><TabsTrigger value="matrix">Permission matrix</TabsTrigger><TabsTrigger value="limits">Approval limits</TabsTrigger></TabsList>
        <TabsContent value="matrix">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div><CardTitle>Permission matrix</CardTitle><CardDescription>{diff.length ? `${diff.reduce((n, c) => n + c.added.length + c.removed.length, 0)} unsaved change(s)` : 'No unsaved changes'}</CardDescription></div>
              {canEdit && (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={diff.length === 0} onClick={() => setDraft({})}>Discard</Button>
                  <Button size="sm" disabled={diff.length === 0} onClick={() => setDiffOpen(true)}>Save changes</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0 pt-2">
              {(roles.isLoading || catalog.isLoading) && <Skeleton className="m-5 h-64" />}
              {roles.data && catalog.data && (
                <PermissionMatrix roles={roles.data} catalog={catalog.data} current={current} base={base} canEdit={canEdit} onToggle={toggle} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="limits">
          {roles.data && <ApprovalLimitsPanel roles={roles.data} canEdit={canEdit} />}
        </TabsContent>
      </Tabs>
      <DiffDialog open={diffOpen} onOpenChange={setDiffOpen} diff={diff} saving={saving} onConfirm={save} />
      <NewRoleDialog open={newRole} onOpenChange={setNewRole} />
    </>
  );
}
