'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Link from 'next/link';
import { resetPasswordSchema, roleChangeSchema, userCreateSchema, userUpdateSchema, type ApprovalDto, type BranchDto, type RoleDto, type UserDto } from '@damez/shared';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { errorMessage, patch, post } from '@/lib/api';

const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);

type CreateForm = z.input<typeof userCreateSchema>;
export function CreateUserDialog({ open, onOpenChange, roles, branches }: { open: boolean; onOpenChange: (o: boolean) => void; roles: RoleDto[]; branches: BranchDto[] }) {
  const qc = useQueryClient();
  const f = useForm<CreateForm>({ resolver: zodResolver(userCreateSchema), defaultValues: { email: '', fullName: '', roleId: '', password: '', allBranches: false } });
  const allBranches = f.watch('allBranches');
  const m = useMutation({
    mutationFn: (v: CreateForm) => post('/users', v),
    onSuccess: () => { toast.success('User created'); void qc.invalidateQueries({ queryKey: ['users'] }); f.reset(); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = f.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New staff user</DialogTitle><DialogDescription>The user enrols 2FA at first sign in.</DialogDescription></DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={f.handleSubmit((v) => m.mutate({ ...v, branchId: v.allBranches ? null : (v.branchId || null) }))}>
          <FormField label="Full name" htmlFor="nu-name" required error={e.fullName?.message}><Input id="nu-name" {...f.register('fullName')} /></FormField>
          <FormField label="Email" htmlFor="nu-email" required error={e.email?.message}><Input id="nu-email" type="email" {...f.register('email')} /></FormField>
          <FormField label="Phone" htmlFor="nu-phone" error={e.phone?.message} hint="e.g. 08012345678"><Input id="nu-phone" inputMode="tel" {...f.register('phone', { setValueAs: emptyToUndef })} /></FormField>
          <FormField label="Role" htmlFor="nu-role" required error={e.roleId?.message}>
            <Select id="nu-role" {...f.register('roleId')}><option value="">Select role…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          </FormField>
          <FormField label="Branch" htmlFor="nu-branch" error={e.branchId?.message}>
            <Select id="nu-branch" disabled={!!allBranches} {...f.register('branchId', { setValueAs: emptyToUndef })}><option value="">No branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </FormField>
          <div className="flex items-end gap-2 pb-2">
            <Switch id="nu-all" checked={!!allBranches} onCheckedChange={(v) => f.setValue('allBranches', v)} />
            <label htmlFor="nu-all" className="text-sm">Access all branches</label>
          </div>
          <FormField className="sm:col-span-2" label="Temporary password" htmlFor="nu-pw" required error={e.password?.message} hint="12+ characters, upper and lower case, and a digit.">
            <Input id="nu-pw" type="password" autoComplete="new-password" {...f.register('password')} />
          </FormField>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>Create user</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type EditForm = z.input<typeof userUpdateSchema>;
export function EditUserDialog({ user, onClose, branches }: { user: UserDto | null; onClose: () => void; branches: BranchDto[] }) {
  const qc = useQueryClient();
  const f = useForm<EditForm>({ resolver: zodResolver(userUpdateSchema) });
  React.useEffect(() => {
    if (user) f.reset({ fullName: user.fullName, branchId: user.branch?.id ?? null, allBranches: user.allBranches, phone: undefined });
  }, [user, f]);
  const m = useMutation({
    mutationFn: (v: EditForm) => patch(`/users/${user!.id}`, v),
    onSuccess: () => { toast.success('User updated'); void qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = f.formState.errors;
  const all = f.watch('allBranches');
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit {user?.fullName}</DialogTitle><DialogDescription>Role changes go through approval; use “Change role”.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={f.handleSubmit((v) => m.mutate({ ...v, branchId: v.allBranches ? null : (v.branchId || null) }))}>
          <FormField label="Full name" htmlFor="eu-name" error={e.fullName?.message}><Input id="eu-name" {...f.register('fullName')} /></FormField>
          <FormField label="New phone number" htmlFor="eu-phone" error={e.phone?.message} hint={`Current: ${user?.phone ?? 'none'}. Leave blank to keep.`}>
            <Input id="eu-phone" inputMode="tel" {...f.register('phone', { setValueAs: emptyToUndef })} />
          </FormField>
          <FormField label="Branch" htmlFor="eu-branch">
            <Select id="eu-branch" disabled={!!all} {...f.register('branchId', { setValueAs: emptyToUndef })}><option value="">No branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          </FormField>
          <div className="flex items-center gap-2"><Switch id="eu-all" checked={!!all} onCheckedChange={(v) => f.setValue('allBranches', v)} /><label htmlFor="eu-all" className="text-sm">Access all branches</label></div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={m.isPending}>Save changes</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PwForm = z.input<typeof resetPasswordSchema>;
export function ResetPasswordDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const f = useForm<PwForm>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '' } });
  const m = useMutation({
    mutationFn: (v: PwForm) => post(`/users/${user!.id}/reset-password`, v),
    onSuccess: () => { toast.success('Password reset'); f.reset(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Reset password</DialogTitle><DialogDescription>Set a temporary password for {user?.fullName}. Their sessions are revoked.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={f.handleSubmit((v) => m.mutate(v))}>
          <FormField label="New password" htmlFor="rp-pw" error={f.formState.errors.password?.message}><Input id="rp-pw" type="password" autoComplete="new-password" {...f.register('password')} /></FormField>
          <DialogFooter><Button type="submit" loading={m.isPending}>Reset password</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type RoleForm = z.input<typeof roleChangeSchema>;
export function RoleChangeDialog({ user, onClose, roles, onSubmitted }: { user: UserDto | null; onClose: () => void; roles: RoleDto[]; onSubmitted: () => void }) {
  const f = useForm<RoleForm>({ resolver: zodResolver(roleChangeSchema), defaultValues: { roleId: '', reason: '' } });
  const [submitted, setSubmitted] = React.useState(false);
  const m = useMutation({
    mutationFn: (v: RoleForm) => post<ApprovalDto>(`/users/${user!.id}/role-change`, v),
    onSuccess: () => { toast.success('Role change submitted for approval'); setSubmitted(true); onSubmitted(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = () => { setSubmitted(false); f.reset(); onClose(); };
  const e = f.formState.errors;
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Change role for {user?.fullName}</DialogTitle><DialogDescription>Currently <b>{user?.role.name}</b>. Role changes need a second person to approve (maker-checker).</DialogDescription></DialogHeader>
        {submitted ? (
          <div className="space-y-4">
            <p role="status" className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm">Submitted for approval. The role will change once a checker approves it.</p>
            <DialogFooter><Button asChild><Link href="/approvals" onClick={close}>Go to approvals</Link></Button><Button variant="outline" onClick={close}>Close</Button></DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={f.handleSubmit((v) => m.mutate(v))}>
            <FormField label="New role" htmlFor="rc-role" error={e.roleId?.message}>
              <Select id="rc-role" {...f.register('roleId')}><option value="">Select role…</option>{roles.filter((r) => r.id !== user?.role.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
            </FormField>
            <FormField label="Reason" htmlFor="rc-reason" error={e.reason?.message}><Textarea id="rc-reason" {...f.register('reason')} /></FormField>
            <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" loading={m.isPending}>Submit for approval</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
