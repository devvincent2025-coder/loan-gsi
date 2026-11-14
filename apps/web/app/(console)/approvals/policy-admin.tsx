'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import type { ApprovalTypeDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MoneyInput } from '@/components/money';
import { errorMessage, put } from '@/lib/api';
import { cn } from '@/lib/utils';

function PolicyRow({ t }: { t: ApprovalTypeDto }) {
  const qc = useQueryClient();
  const [threshold, setThreshold] = React.useState<number | null>(t.thresholdKobo);
  const [enabled, setEnabled] = React.useState(t.enabled);
  React.useEffect(() => { setThreshold(t.thresholdKobo); setEnabled(t.enabled); }, [t]);
  const dirty = threshold !== t.thresholdKobo || enabled !== t.enabled;
  const m = useMutation({
    mutationFn: () => put(`/approvals/policies/${t.type}`, { thresholdKobo: threshold ?? 0, enabled }),
    onSuccess: () => { toast.success(`${t.label} policy saved`); void qc.invalidateQueries({ queryKey: ['approval-types'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid items-center gap-3 border-b py-3 last:border-0 md:grid-cols-[1fr_auto_14rem_auto]">
      <div><p className="text-sm font-medium">{t.label}</p><p className="text-xs text-muted-foreground">{t.description}</p></div>
      <label className="flex items-center gap-2 text-xs"><Switch aria-label={`${t.label} requires approval`} checked={enabled} onCheckedChange={setEnabled} /> Enforced</label>
      {t.hasAmount ? <MoneyInput aria-label={`${t.label} threshold in naira`} value={threshold} onChange={setThreshold} /> : <span className="text-xs text-muted-foreground">Always required</span>}
      <Button size="sm" disabled={!dirty} loading={m.isPending} onClick={() => m.mutate()}>Save</Button>
    </div>
  );
}

export function PolicyAdmin({ types }: { types: ApprovalTypeDto[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="mt-6">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none hover:bg-muted/40 transition-colors rounded-t-md">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Approval policies</CardTitle>
                <CardDescription>Requests at or above the threshold must go through maker-checker.</CardDescription>
              </div>
              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>{types.map((t) => <PolicyRow key={t.type} t={t} />)}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
