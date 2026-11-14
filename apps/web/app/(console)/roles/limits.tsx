'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { APPROVAL_ACTION_TYPES, APPROVAL_TYPE_META, SUPER_ADMIN_ROLE_KEY, formatNaira, type ApprovalActionType, type RoleDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { MoneyInput } from '@/components/money';
import { errorMessage, put } from '@/lib/api';

/** limit state: undefined = cannot approve, null = unlimited, number = kobo cap */
type Limits = Partial<Record<ApprovalActionType, number | null>>;

function toLimits(role: RoleDto): Limits {
  return Object.fromEntries(role.approvalLimits.map((l) => [l.actionType, l.maxAmountKobo]));
}

export function ApprovalLimitsPanel({ roles, canEdit }: { roles: RoleDto[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [roleId, setRoleId] = React.useState(roles[0]?.id ?? '');
  const role = roles.find((r) => r.id === roleId) ?? roles[0];
  const [limits, setLimits] = React.useState<Limits>({});
  React.useEffect(() => { if (role) setLimits(toLimits(role)); }, [role]);
  const locked = role?.key === SUPER_ADMIN_ROLE_KEY;
  const editable = canEdit && !locked;

  const save = useMutation({
    mutationFn: () => put(`/roles/${role!.id}/approval-limits`, {
      limits: APPROVAL_ACTION_TYPES.filter((t) => limits[t] !== undefined).map((t) => ({ actionType: t, maxAmountKobo: limits[t] as number | null })),
    }),
    onSuccess: () => { toast.success('Approval limits saved'); void qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!role) return null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div><CardTitle>Approval limits</CardTitle><CardDescription>Maximum amount this role may approve, per action type. Larger requests escalate to a higher limit.</CardDescription></div>
        <Select aria-label="Role" className="w-56" value={role.id} onChange={(e) => setRoleId(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
      </CardHeader>
      <CardContent className="space-y-1">
        {APPROVAL_ACTION_TYPES.map((t) => {
          const meta = APPROVAL_TYPE_META[t];
          const v = limits[t];
          const enabled = v !== undefined;
          const unlimited = v === null;
          return (
            <div key={t} className="grid items-center gap-3 border-b py-3 last:border-0 md:grid-cols-[1fr_auto_auto_14rem]">
              <div><p className="text-sm font-medium">{meta.label}</p><p className="text-xs text-muted-foreground">{meta.description}</p></div>
              <label className="flex items-center gap-2 text-xs">
                <Switch aria-label={`${meta.label}: can approve`} checked={enabled} disabled={!editable} onCheckedChange={(on) => setLimits((l) => ({ ...l, [t]: on ? null : undefined }))} /> Can approve
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch aria-label={`${meta.label}: unlimited`} checked={unlimited} disabled={!editable || !enabled || !meta.hasAmount} onCheckedChange={(on) => setLimits((l) => ({ ...l, [t]: on ? null : 0 }))} /> Unlimited
              </label>
              <div>
                {meta.hasAmount && enabled && !unlimited ? (
                  <MoneyInput aria-label={`${meta.label} limit in naira`} value={v ?? 0} disabled={!editable} onChange={(k) => setLimits((l) => ({ ...l, [t]: k ?? 0 }))} />
                ) : (
                  <span className="text-xs text-muted-foreground">{!enabled ? 'Cannot approve' : unlimited ? 'No cap' : formatNaira(v)}</span>
                )}
              </div>
            </div>
          );
        })}
        {editable && <div className="flex justify-end pt-3"><Button loading={save.isPending} onClick={() => save.mutate()}>Save limits</Button></div>}
        {locked && <p className="pt-2 text-xs text-muted-foreground">Super Admin limits are locked.</p>}
      </CardContent>
    </Card>
  );
}
