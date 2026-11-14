'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roleCreateSchema } from '@damez/shared';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { errorMessage, post } from '@/lib/api';

type F = z.input<typeof roleCreateSchema>;

export function NewRoleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const f = useForm<F>({ resolver: zodResolver(roleCreateSchema), defaultValues: { key: '', name: '', description: '', branchScoped: false } });
  const m = useMutation({
    mutationFn: (v: F) => post('/roles', v),
    onSuccess: () => { toast.success('Role created. Assign permissions in the matrix.'); void qc.invalidateQueries({ queryKey: ['roles'] }); f.reset(); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = f.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New role</DialogTitle><DialogDescription>Starts with no permissions.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={f.handleSubmit((v) => m.mutate(v))}>
          <FormField label="Name" htmlFor="nr-name" required error={e.name?.message}><Input id="nr-name" {...f.register('name')} /></FormField>
          <FormField label="Key" htmlFor="nr-key" required error={e.key?.message && 'Lowercase letters, digits and underscores, 3-41 chars, starting with a letter'} hint="e.g. branch_supervisor"><Input id="nr-key" {...f.register('key')} /></FormField>
          <FormField label="Description" htmlFor="nr-desc" error={e.description?.message}><Textarea id="nr-desc" {...f.register('description')} /></FormField>
          <div className="flex items-center gap-2"><Switch id="nr-bs" checked={!!f.watch('branchScoped')} onCheckedChange={(v) => f.setValue('branchScoped', v)} /><label htmlFor="nr-bs" className="text-sm">Branch-scoped (users see only their branch)</label></div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>Create role</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
