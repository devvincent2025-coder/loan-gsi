'use client';
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, RefreshCw, Search, FileText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import {
  listBriefings,
  generateBriefing,
  type ExecutiveBriefing,
  type BriefingType,
} from '@/lib/executive-api';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const TYPE_COLORS: Record<BriefingType, string> = {
  DAILY: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
  WEEKLY: 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400',
  MONTHLY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400',
};

function BriefingDetail({ briefing, onClose }: { briefing: ExecutiveBriefing; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="flex flex-wrap items-start gap-3">
            <Badge variant="outline" className={cn(TYPE_COLORS[briefing.type])}>
              {briefing.type}
            </Badge>
            <DialogTitle className="text-lg leading-snug">{briefing.headline}</DialogTitle>
          </div>
        </DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">
          Generated{' '}
          {new Date(briefing.generatedAt).toLocaleString('en-NG', {
            dateStyle: 'long',
            timeStyle: 'short',
            timeZone: 'Africa/Lagos',
          })}
        </p>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{briefing.content}</div>
      </DialogContent>
    </Dialog>
  );
}

export default function BriefingsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<BriefingType | 'ALL'>('ALL');
  const [selected, setSelected] = React.useState<ExecutiveBriefing | null>(null);

  const q = useQuery({ queryKey: ['exec-briefings'], queryFn: listBriefings });

  const generateMutation = useMutation({
    mutationFn: (type: BriefingType) => generateBriefing(type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exec-briefings'] });
    },
  });

  const filtered = (q.data ?? []).filter((b) => {
    const matchType = filter === 'ALL' || b.type === filter;
    const matchSearch =
      !search ||
      b.headline.toLowerCase().includes(search.toLowerCase()) ||
      b.content.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <>
      <PageHeader
        title="Executive Briefings"
        description="Daily, weekly and monthly AI-generated briefings for portfolio leadership."
        actions={
          <div className="flex items-center gap-2">
            {(['DAILY', 'WEEKLY', 'MONTHLY'] as BriefingType[]).map((t) => (
              <Button
                key={t}
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => generateMutation.mutate(t)}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <RefreshCw className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </Button>
            ))}
          </div>
        }
      />

      {/* Search + filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search briefings…"
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div role="group" aria-label="Filter by type" className="flex gap-1">
          {(['ALL', 'DAILY', 'WEEKLY', 'MONTHLY'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={filter === t ? 'default' : 'ghost'}
              onClick={() => setFilter(t)}
              className="h-8 text-xs"
            >
              {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
      </div>

      {q.isError && (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      )}

      {q.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
        </div>
      )}

      {!q.isLoading && !q.isError && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={FileText}
            title="No briefings found"
            description={search ? 'Try adjusting your search.' : 'Generate your first briefing using the buttons above.'}
          />
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((b) => {
          const isGenerating = b.status === 'GENERATING';
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => !isGenerating && setSelected(b)}
              className="text-left"
            >
              <Card className="flex h-full flex-col gap-3 p-4 hover:bg-muted/40 transition-colors">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={cn('text-xs', TYPE_COLORS[b.type])}>
                    {b.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(b.generatedAt).toLocaleDateString('en-NG', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'Africa/Lagos',
                    })}
                  </span>
                </div>
                <p className="text-sm font-semibold leading-snug line-clamp-2">
                  {isGenerating ? 'Generating…' : b.headline}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-3 flex-1">
                  {isGenerating ? 'This may take a moment.' : b.content}
                </p>
                <div className="flex items-center justify-between">
                  <Badge variant={b.status === 'FAILED' ? 'destructive' : b.status === 'GENERATING' ? 'outline' : 'success'} className="text-[10px]">
                    {b.status}
                  </Badge>
                  {!isGenerating && b.status === 'READY' && (
                    <span className="text-xs text-primary font-medium">Read →</span>
                  )}
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      {selected && <BriefingDetail briefing={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
