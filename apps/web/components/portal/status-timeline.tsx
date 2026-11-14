import { Check, X } from 'lucide-react';
import type { ApplicationStatus } from '@damez/shared';
import { cn } from '@/lib/utils';
import { APPLICATION_STATUS_META } from './status-chip';

const PIPELINE: ApplicationStatus[] = ['SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'DISBURSED', 'ACTIVE'];

/** position of any status on the happy path (-1 before it starts, PIPELINE.length after it) */
export function pipelineIndex(status: ApplicationStatus): number {
  if (status === 'DRAFT') return -1;
  const i = PIPELINE.indexOf(status);
  if (i >= 0) return i;
  if (status === 'Unpaid' || status === 'RESTRUCTURED' || status === 'CLOSED' || status === 'WRITTEN_OFF') return PIPELINE.length;
  return -2; // REJECTED / CANCELLED: terminal off-path
}

export function StatusTimeline({ status, statusLabel, statusMessage }: { status: ApplicationStatus; statusLabel?: string; statusMessage?: string }) {
  const cur = pipelineIndex(status);
  const off = status === 'REJECTED' || status === 'CANCELLED';
  const steps = PIPELINE.filter((s) => !['OFFER_ACCEPTED'].includes(s) || status === 'OFFER_ACCEPTED');
  return (
    <ol className="space-y-0" aria-label="Application progress" data-testid="status-timeline">
      {steps.map((s, i) => {
        const idx = PIPELINE.indexOf(s);
        const done = !off && idx < cur;
        const current = !off && idx === cur;
        return (
          <li key={s} className="relative flex gap-3 pb-4 last:pb-0" aria-current={current ? 'step' : undefined} data-state={done ? 'done' : current ? 'current' : 'todo'}>
            {i < steps.length - 1 && <span className={cn('absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5', done ? 'bg-success' : 'bg-border')} aria-hidden />}
            <span className={cn('z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px]', done ? 'border-success bg-success text-success-foreground' : current ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-muted-foreground')}>
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <div className="min-w-0 -mt-0.5">
              <p className={cn('text-sm', current ? 'font-semibold' : done ? 'font-medium' : 'text-muted-foreground')}>{current && statusLabel ? statusLabel : APPLICATION_STATUS_META[s].label}</p>
              {current && <p className="text-xs text-muted-foreground">{statusMessage ?? APPLICATION_STATUS_META[s].hint}</p>}
            </div>
          </li>
        );
      })}
      {off && (
        <li className="flex gap-3 pt-4">
          <span className="flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground"><X className="size-3.5" aria-hidden /></span>
          <div><p className="text-sm font-semibold">{statusLabel ?? APPLICATION_STATUS_META[status].label}</p><p className="text-xs text-muted-foreground">{statusMessage ?? APPLICATION_STATUS_META[status].hint}</p></div>
        </li>
      )}
    </ol>
  );
}
