'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatNaira } from '@damez/shared';
import {
  Sparkles,
  AlertTriangle,
  CheckSquare,
  ExternalLink,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BriefingCard } from '@/components/executive/briefing-card';
import { AnomalyBadge } from '@/components/executive/anomaly-badge';
import { ExecChat } from '@/components/executive/exec-chat';
import {
  PARTrendChart,
  BranchPARChart,
  CollectionEfficiencyChart,
  DisbursementTargetChart,
} from '@/components/executive/metrics-charts';
import {
  listBriefings,
  generateBriefing,
  getPortfolioMetrics,
  getBranchMetrics,
  listAnomalies,
  getPendingApprovalsForExec,
  type ExecutiveBriefing,
  type BriefingType,
} from '@/lib/executive-api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Briefings panel                                                      */
/* ------------------------------------------------------------------ */
function BriefingsPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState<ExecutiveBriefing | null>(null);
  const [showDetail, setShowDetail] = React.useState(false);

  const q = useQuery({ queryKey: ['exec-briefings'], queryFn: listBriefings, refetchInterval: 30_000 });

  const generateMutation = useMutation({
    mutationFn: (type: BriefingType) => generateBriefing(type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exec-briefings'] });
    },
  });

  function handleSelect(b: ExecutiveBriefing) {
    setSelected(b);
    setShowDetail(true);
  }

  return (
    <aside className="flex w-full flex-col gap-3 lg:w-[280px] lg:shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Briefings</h2>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => generateMutation.mutate('DAILY')}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? (
            <RefreshCw className="size-3 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-3" aria-hidden />
          )}
          Generate
        </Button>
      </div>

      {q.isError && (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      )}

      {q.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!q.isLoading && !q.isError && (q.data ?? []).length === 0 && (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="No briefings"
            description="Generate your first executive briefing."
            className="py-8"
          />
        </Card>
      )}

      <div className="space-y-2">
        {(q.data ?? []).map((b) => (
          <BriefingCard
            key={b.id}
            briefing={b}
            selected={selected?.id === b.id}
            onClick={() => handleSelect(b)}
          />
        ))}
      </div>

      {selected && (
        <Dialog open={showDetail} onOpenChange={setShowDetail}>
          <DialogContent>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <Badge variant="outline" className="shrink-0">
                  {selected.type}
                </Badge>
                <DialogTitle className="text-base leading-snug">{selected.headline}</DialogTitle>
              </div>
            </DialogHeader>
            <p className="-mt-2 text-xs text-muted-foreground">
              {new Date(selected.generatedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}
            </p>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
              {selected.content}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Center panel                                                         */
/* ------------------------------------------------------------------ */
function CenterPanel() {
  const metricsQ = useQuery({
    queryKey: ['exec-portfolio-metrics', 30],
    queryFn: () => getPortfolioMetrics(30),
    refetchInterval: 120_000,
  });

  const branchesQ = useQuery({
    queryKey: ['exec-branch-metrics'],
    queryFn: getBranchMetrics,
    refetchInterval: 120_000,
  });

  const cur = metricsQ.data?.current;
  const loading = metricsQ.isLoading;

  const kpis = [
    {
      label: 'PAR 30',
      value: cur ? `${cur.par30.toFixed(1)}%` : '—',
      delta: cur?.par30Delta,
      invertDelta: true,
    },
    {
      label: 'PAR 90',
      value: cur ? `${cur.par90.toFixed(1)}%` : '—',
      delta: cur?.par90Delta,
      invertDelta: true,
    },
    {
      label: 'NPL Ratio',
      value: cur ? `${cur.nplRatio.toFixed(1)}%` : '—',
      delta: cur?.nplDelta,
      invertDelta: true,
    },
    {
      label: 'Disbursements (30d)',
      value: cur ? formatNaira(cur.disbursed30dKobo, { compact: true }) : '—',
      delta: cur?.disbursedDelta,
    },
    {
      label: 'Collection Efficiency',
      value: cur ? `${cur.collectionEfficiency.toFixed(1)}%` : '—',
      delta: cur?.efficiencyDelta,
    },
    {
      label: 'ECL Total',
      value: cur ? formatNaira(cur.eclTotalKobo, { compact: true }) : '—',
      delta: cur?.eclDelta,
      invertDelta: true,
    },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* KPI strip */}
      {metricsQ.isError && (
        <Card>
          <ErrorState message={errorMessage(metricsQ.error)} onRetry={() => metricsQ.refetch()} />
        </Card>
      )}
      <section aria-label="Portfolio KPIs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((k) => (
          <KpiCard
            key={k.label}
            loading={loading}
            label={k.label}
            value={k.value}
            delta={k.delta}
            invertDelta={k.invertDelta}
          />
        ))}
      </section>

      {/* Charts 2x2 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PARTrendChart metrics={metricsQ.data} loading={metricsQ.isLoading} />
        <BranchPARChart branches={branchesQ.data} loading={branchesQ.isLoading} />
        <CollectionEfficiencyChart metrics={metricsQ.data} loading={metricsQ.isLoading} />
        <DisbursementTargetChart metrics={metricsQ.data} loading={metricsQ.isLoading} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right panel – Approval Inbox + Chat                                 */
/* ------------------------------------------------------------------ */
function ApprovalInbox() {
  const q = useQuery({
    queryKey: ['exec-pending-approvals'],
    queryFn: getPendingApprovalsForExec,
    refetchInterval: 60_000,
  });

  const items = q.data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-medium">Pending Approvals</p>
        {items.length > 0 && (
          <Badge variant="destructive" className="text-xs">
            {items.length}
          </Badge>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {q.isLoading && (
          <>
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </>
        )}
        {q.isError && (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        )}
        {!q.isLoading && !q.isError && items.length === 0 && (
          <EmptyState
            icon={CheckSquare}
            title="No pending approvals"
            description="You're all caught up."
            className="py-8"
          />
        )}
        {items.map((item) => {
          const age = Math.round((Date.now() - new Date(item.createdAt).getTime()) / 3_600_000);
          return (
            <Link key={item.id} href={`/approvals/${item.id}`}>
              <Card className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors cursor-pointer">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] py-0',
                        item.status === 'ESCALATED' && 'border-destructive/40 text-destructive',
                      )}
                    >
                      {item.status}
                    </Badge>
                    <span className="truncate text-xs text-muted-foreground">{item.type}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium">
                    {item.description ?? item.type}
                  </p>
                  {item.amountKobo != null && (
                    <p className="text-xs text-muted-foreground">{formatNaira(item.amountKobo, { compact: true })}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[10px] text-muted-foreground">{age}h ago</span>
                  <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
                </div>
              </Card>
            </Link>
          );
        })}
        {items.length > 0 && (
          <Link href="/approvals" className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-primary hover:underline">
            View all <ChevronRight className="size-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

function AnomalyPanel() {
  const q = useQuery({ queryKey: ['exec-anomalies'], queryFn: listAnomalies, refetchInterval: 60_000 });
  const items = q.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-medium">Anomalies</p>
        {items.filter((a) => !a.acknowledgedAt).length > 0 && (
          <Badge variant="destructive" className="text-xs">
            {items.filter((a) => !a.acknowledgedAt).length}
          </Badge>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {q.isLoading && (
          <>{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</>
        )}
        {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
        {!q.isLoading && !q.isError && items.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title="No anomalies"
            description="No portfolio anomalies detected."
            className="py-8"
          />
        )}
        {items.map((a) => (
          <Card
            key={a.id}
            className={cn('p-3 space-y-1', a.acknowledgedAt && 'opacity-50')}
          >
            <div className="flex items-center justify-between gap-2">
              <AnomalyBadge severity={a.severity} />
              <span className="text-[10px] text-muted-foreground">
                {new Date(a.detectedAt).toLocaleString('en-NG', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
                })}
              </span>
            </div>
            <p className="text-sm font-medium leading-snug">{a.title}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{a.description}</p>
          </Card>
        ))}
        {items.length > 0 && (
          <Link href="/executive/anomalies" className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-primary hover:underline">
            View all <ChevronRight className="size-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

function RightPanel() {
  return (
    <aside className="flex w-full flex-col lg:w-[320px] lg:shrink-0">
      <Tabs defaultValue="inbox" className="flex h-full flex-col">
        <TabsList className="mx-3 mt-2 shrink-0">
          <TabsTrigger value="inbox" className="flex-1 text-xs">Inbox</TabsTrigger>
          <TabsTrigger value="anomalies" className="flex-1 text-xs">Anomalies</TabsTrigger>
          <TabsTrigger value="chat" className="flex-1 text-xs">Assistant</TabsTrigger>
        </TabsList>
        <Card className="mt-2 flex min-h-[600px] flex-1 flex-col overflow-hidden">
          <TabsContent value="inbox" className="flex flex-1 flex-col p-0 m-0">
            <ApprovalInbox />
          </TabsContent>
          <TabsContent value="anomalies" className="flex flex-1 flex-col p-0 m-0">
            <AnomalyPanel />
          </TabsContent>
          <TabsContent value="chat" className="flex flex-1 flex-col p-0 m-0 h-full">
            <ExecChat />
          </TabsContent>
        </Card>
      </Tabs>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                            */
/* ------------------------------------------------------------------ */
export default function ExecutivePage() {
  return (
    <>
      <PageHeader
        title="Supervisory Intelligence"
        description="Oversight, briefings, anomalies and executive assistant."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/executive/briefings">
              <Button variant="outline" size="sm" className="h-8 text-xs">
                All Briefings
              </Button>
            </Link>
            <Link href="/executive/anomalies">
              <Button variant="outline" size="sm" className="h-8 text-xs">
                Anomalies
              </Button>
            </Link>
          </div>
        }
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <BriefingsPanel />
        <CenterPanel />
        <RightPanel />
      </div>
    </>
  );
}
