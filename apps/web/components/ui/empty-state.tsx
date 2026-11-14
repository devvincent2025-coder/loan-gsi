import * as React from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-destructive">Something went wrong</p>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}
