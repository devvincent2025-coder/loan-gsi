'use client';
import { useQuery } from '@tanstack/react-query';
import type { IntegrationDto } from '@damez/shared';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { errorMessage, get } from '@/lib/api';

export function IntegrationsTab() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => get<IntegrationDto[]>('/settings/integrations') });
  if (q.isError) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {q.isLoading && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}
      {q.data?.map((i) => (
        <Card key={i.key} className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <div><p className="font-semibold">{i.name}</p><p className="text-xs text-muted-foreground">{i.category}</p></div>
            <Badge variant={i.mode === 'live' ? 'success' : 'secondary'}>{i.mode === 'live' ? 'Live' : 'Demo'}</Badge>
          </div>
          <StatusBadge status={i.status} />
          <p className="text-xs text-muted-foreground">{i.note}</p>
          <div className="flex flex-wrap gap-1">{i.envVars.map((v) => <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{v}</code>)}</div>
        </Card>
      ))}
    </div>
  );
}
