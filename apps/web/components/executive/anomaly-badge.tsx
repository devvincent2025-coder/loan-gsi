import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SeverityLevel } from '@/lib/executive-api';

export function AnomalyBadge({ severity, className }: { severity: SeverityLevel; className?: string }) {
  return (
    <Badge
      className={cn(
        'text-xs font-semibold uppercase tracking-wide',
        severity === 'CRITICAL' && 'bg-destructive/10 text-destructive border-destructive/20',
        severity === 'WARNING' && 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800/30',
        severity === 'INFO' && 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/30',
        className,
      )}
      variant="outline"
    >
      {severity}
    </Badge>
  );
}
