'use client';
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { AnomalyBadge } from '@/components/executive/anomaly-badge';
import { listAnomalies, acknowledgeAnomaly, type SeverityLevel } from '@/lib/executive-api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const SEVERITIES: SeverityLevel[] = ['CRITICAL', 'WARNING', 'INFO'];

export default function AnomaliesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [severity, setSeverity] = React.useState<SeverityLevel | 'ALL'>('ALL');
  const [showAcknowledged, setShowAcknowledged] = React.useState(false);

  const q = useQuery({ queryKey: ['exec-anomalies'], queryFn: listAnomalies, refetchInterval: 60_000 });

  const ackMutation = useMutation({
    mutationFn: (id: string) => acknowledgeAnomaly(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exec-anomalies'] });
    },
  });

  const items = (q.data ?? []).filter((a) => {
    const matchSeverity = severity === 'ALL' || a.severity === severity;
    const matchAck = showAcknowledged || !a.acknowledgedAt;
    const matchSearch =
      !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase());
    return matchSeverity && matchAck && matchSearch;
  });

  const activeCount = (q.data ?? []).filter((a) => !a.acknowledgedAt).length;

  return (
    <>
      <PageHeader
        title="Anomaly Monitor"
        description="Portfolio anomalies and alerts detected by the risk engine."
        actions={
          activeCount > 0 ? (
            <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
              {activeCount} unacknowledged
            </span>
          ) : (
            <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
              All clear
            </span>
          )
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search anomalies…"
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div role="group" aria-label="Filter by severity" className="flex gap-1">
          <Button
            size="sm"
            variant={severity === 'ALL' ? 'default' : 'ghost'}
            onClick={() => setSeverity('ALL')}
            className="h-8 text-xs"
          >
            All
          </Button>
          {SEVERITIES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={severity === s ? 'default' : 'ghost'}
              onClick={() => setSeverity(s)}
              className="h-8 text-xs"
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showAcknowledged}
            onChange={(e) => setShowAcknowledged(e.target.checked)}
            className="rounded border"
          />
          Show acknowledged
        </label>
      </div>

      {q.isError && (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      )}

      {q.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      )}

      {!q.isLoading && !q.isError && items.length === 0 && (
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="No anomalies"
            description={
              search || severity !== 'ALL'
                ? 'No anomalies match your filters.'
                : 'No anomalies detected. Portfolio looks healthy!'
            }
          />
        </Card>
      )}

      <div className="space-y-3">
        {items.map((a) => (
          <Card
            key={a.id}
            className={cn(
              'flex flex-col gap-2 p-4 transition-colors',
              a.acknowledgedAt && 'opacity-60',
              a.severity === 'CRITICAL' && !a.acknowledgedAt && 'border-destructive/30',
            )}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <AnomalyBadge severity={a.severity} />
                <span className="text-xs text-muted-foreground">{a.category}</span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(a.detectedAt).toLocaleString('en-NG', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Africa/Lagos',
                })}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-sm">{a.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
                {a.acknowledgedAt && (
                  <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="size-3" aria-hidden />
                    Acknowledged by {a.acknowledgedBy} on{' '}
                    {new Date(a.acknowledgedAt).toLocaleString('en-NG', {
                      dateStyle: 'medium',
                      timeZone: 'Africa/Lagos',
                    })}
                  </p>
                )}
              </div>
              {!a.acknowledgedAt && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 h-8 text-xs"
                  onClick={() => ackMutation.mutate(a.id)}
                  disabled={ackMutation.isPending && ackMutation.variables === a.id}
                >
                  Acknowledge
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
