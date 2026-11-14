'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, LogOut, MonitorSmartphone, ChevronDown } from 'lucide-react';
import { changePasswordSchema, type SessionDto } from '@damez/shared';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/form';
import { DateTime } from '@/components/date-time';
import { useMe } from '@/lib/auth';
import { del, errorMessage, get, post } from '@/lib/api';
import { initials } from '@/lib/utils';

export async function logout() {
  try {
    await post('/auth/logout');
  } catch {
    /* session may already be gone */
  }
  window.location.assign('/login');
}

function SessionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => get<SessionDto[]>('/auth/sessions'), enabled: open });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/auth/sessions/${id}`),
    onSuccess: () => { toast.success('Session revoked'); void qc.invalidateQueries({ queryKey: ['sessions'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Active sessions</DialogTitle>
          <DialogDescription>Devices currently signed in to your account. Revoke any you do not recognise.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {q.isLoading && <li className="p-4 text-sm text-muted-foreground">Loading…</li>}
          {q.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
              <MonitorSmartphone className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.device} {s.current && <Badge className="ml-1">This device</Badge>}</p>
                <p className="text-xs text-muted-foreground">{s.ip ?? 'unknown IP'} · last active <DateTime value={s.lastActiveAt} relative /> · signed in <DateTime value={s.createdAt} style="short" /></p>
              </div>
              {!s.current && <Button size="sm" variant="outline" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>Revoke</Button>}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

const pwSchema = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type PwForm = z.infer<typeof pwSchema>;

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useForm<PwForm>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const m = useMutation({
    mutationFn: (v: PwForm) => post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => { toast.success('Password changed'); f.reset(); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const err = f.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Change password</DialogTitle><DialogDescription>At least 12 characters with upper, lower case and a digit.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={f.handleSubmit((v) => m.mutate(v))}>
          <FormField label="Current password" htmlFor="cp-cur" error={err.currentPassword?.message}><Input id="cp-cur" type="password" autoComplete="current-password" {...f.register('currentPassword')} /></FormField>
          <FormField label="New password" htmlFor="cp-new" error={err.newPassword?.message}><Input id="cp-new" type="password" autoComplete="new-password" {...f.register('newPassword')} /></FormField>
          <FormField label="Confirm new password" htmlFor="cp-conf" error={err.confirm?.message}><Input id="cp-conf" type="password" autoComplete="new-password" {...f.register('confirm')} /></FormField>
          <DialogFooter><Button type="submit" loading={m.isPending}>Update password</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserMenu() {
  const me = useMe();
  const [sessions, setSessions] = React.useState(false);
  const [pw, setPw] = React.useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="User menu">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{initials(me.fullName)}</span>
            <span className="hidden max-w-32 truncate text-sm md:block">{me.fullName}</span>
            <ChevronDown className="hidden size-3 md:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-2 py-2">
            <p className="truncate text-sm font-semibold">{me.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{me.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge>{me.role.name}</Badge>
              <Badge variant="outline">{me.allBranches ? 'All branches' : (me.branch?.name ?? 'No branch')}</Badge>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setSessions(true)}><MonitorSmartphone /> Active sessions</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPw(true)}><KeyRound /> Change password</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => void logout()}><LogOut /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SessionsDialog open={sessions} onOpenChange={setSessions} />
      <ChangePasswordDialog open={pw} onOpenChange={setPw} />
    </>
  );
}
