'use client';
import * as React from 'react';
import { FileText, Calendar, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ExecutiveBriefing, BriefingType } from '@/lib/executive-api';

const TYPE_LABELS: Record<BriefingType, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };
const TYPE_COLORS: Record<BriefingType, string> = {
  DAILY: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400',
  WEEKLY: 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400',
  MONTHLY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400',
};

export function BriefingCard({
  briefing,
  selected,
  onClick,
}: {
  briefing: ExecutiveBriefing;
  selected?: boolean;
  onClick?: () => void;
}) {
  const isGenerating = briefing.status === 'GENERATING';
  const date = new Date(briefing.generatedAt).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left transition-colors rounded-lg',
        selected ? 'ring-2 ring-primary' : 'hover:bg-muted/40',
      )}
    >
      <Card className={cn('p-3 gap-2 flex flex-col', selected && 'border-primary/40')}>
        <div className="flex items-center justify-between gap-2">
          <Badge className={cn('text-xs', TYPE_COLORS[briefing.type])} variant="outline">
            {TYPE_LABELS[briefing.type]}
          </Badge>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="size-3" aria-hidden />
            {date}
          </span>
        </div>
        <div className="flex items-start gap-2">
          {isGenerating ? (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Generating" />
          ) : (
            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {isGenerating ? 'Generating briefing…' : briefing.headline}
          </p>
        </div>
        {briefing.status === 'FAILED' && (
          <p className="text-xs text-destructive">Generation failed</p>
        )}
      </Card>
    </button>
  );
}
