'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import type { EclConfigDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { getEclConfig, updateEclConfig } from '@/lib/finance-api';

const FIELDS: { key: keyof EclConfigDto; label: string; hint?: string }[] = [
  { key: 'stage1PdBps', label: 'Stage 1 PD (bps)' },
  { key: 'stage2PdBps', label: 'Stage 2 PD (bps)' },
  { key: 'stage3PdBps', label: 'Stage 3 PD (bps)' },
  { key: 'lgdBps', label: 'LGD (bps)' },
  { key: 'stage2DpdThreshold', label: 'Stage 2 DPD threshold', hint: 'Days past due' },
  { key: 'stage3DpdThreshold', label: 'Stage 3 DPD threshold', hint: 'Days past due' },
];

export function EclConfigDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const q = useQuery({ queryKey: ['ifrs9', 'config'], queryFn: getEclConfig, enabled: open });
  const [form, setForm] = React.useState<EclConfigDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  const m = useMutation({
    mutationFn: updateEclConfig,
    onSuccess: () => {
      toast.success('ECL assumptions updated');
      void qc.invalidateQueries({ queryKey: ['ifrs9'] });
      setOpen(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    if (!form) return;
    setError(null);
    m.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Settings2 /> Edit ECL assumptions</Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit ECL assumptions</DialogTitle>
          <DialogDescription>Drives IFRS 9 staging and provisioning. Changes apply to future report runs.</DialogDescription>
        </DialogHeader>

        {q.isLoading && <Skeleton className="h-48" />}
        {q.isError && <p role="alert" className="text-sm font-medium text-destructive">{errorMessage(q.error)}</p>}
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <FormField key={f.key} label={f.label} htmlFor={`ecl-${f.key}`} hint={f.hint}>
                <Input
                  id={`ecl-${f.key}`}
                  type="number"
                  min={0}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
                />
              </FormField>
            ))}
          </div>
        )}
        {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={m.isPending}>Cancel</Button>
          <Button loading={m.isPending} disabled={!form} onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
