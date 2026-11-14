'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ScanSearch } from 'lucide-react';
import type { FraudSignalDto } from '@damez/shared';
import { DateTime } from '@/components/date-time';
import { SectionCard } from '@/components/staff/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/form';
import { useCan } from '@/lib/auth';
import { errorMessage, post } from '@/lib/api';
import { titleCase } from '@/lib/utils';
import { SeverityChip } from './customer-ui';

function ResolveDialog({ signal, onClose, onDone }: { signal: FraudSignalDto | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { setNote(''); setErr(null); }, [signal?.id]);
  const m = useMutation({
    mutationFn: () => post(`/fraud-signals/${signal!.id}/resolve`, { note: note.trim() }),
    onSuccess: () => { toast.success('Fraud signal resolved'); onDone(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!signal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>Resolve fraud signal</DialogTitle><DialogDescription>{signal ? `${titleCase(signal.type)}: ${signal.detail}` : ''}</DialogDescription></DialogHeader>
        <FormField label="Resolution note" htmlFor="fraud-note" required error={err ?? undefined} hint="">
          <Textarea id="fraud-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you check and why is this a false positive / handled?" />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button loading={m.isPending} onClick={() => { if (note.trim().length < 5) return setErr('Please write at least 5 characters.'); setErr(null); m.mutate(); }}>Resolve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FraudSignalsPanel({ customerId, signals, onChanged, title = 'Fraud signals' }: { customerId?: string; signals: FraudSignalDto[]; onChanged: () => void; title?: string }) {
  const canScan = useCan('fraud:read');
  const canResolve = useCan('fraud:resolve');
  const [resolving, setResolving] = React.useState<FraudSignalDto | null>(null);
  const scan = useMutation({
    mutationFn: () => post<FraudSignalDto[]>(`/customers/${customerId}/fraud-scan`),
    onSuccess: (r) => { toast.success(`Fraud scan complete: ${r.length} signal(s) on record`); onChanged(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const open = signals.filter((s) => !s.resolvedAt).length;
  return (
    <SectionCard
      title={title}
      description={`${open} open · ${signals.length - open} resolved`}
      actions={customerId && canScan && <Button size="sm" variant="outline" loading={scan.isPending} onClick={() => scan.mutate()}><ScanSearch /> Run fraud scan</Button>}
    >
      {signals.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No fraud signals.</p>
      ) : (
        <ul className="space-y-2" data-testid="fraud-signals">
          {signals.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-2 rounded-md border p-3">
              <SeverityChip severity={s.severity} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{titleCase(s.type)}</p>
                <p className="text-sm text-muted-foreground">{s.detail}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Raised <DateTime value={s.createdAt} style="short" />{s.resolvedAt && <> · resolved <DateTime value={s.resolvedAt} style="short" />{s.resolutionNote ? `: ${s.resolutionNote}` : ''}</>}</p>
              </div>
              {s.resolvedAt ? <Badge variant="success">Resolved</Badge> : canResolve && <Button size="sm" variant="outline" onClick={() => setResolving(s)}>Resolve</Button>}
            </li>
          ))}
        </ul>
      )}
      <ResolveDialog signal={resolving} onClose={() => setResolving(null)} onDone={onChanged} />
    </SectionCard>
  );
}
