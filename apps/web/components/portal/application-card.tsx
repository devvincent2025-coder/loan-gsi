import Link from 'next/link';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { formatLagos, type PortalApplicationDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MoneyText } from '@/components/money';
import { StatusChip } from './status-chip';

/** Compact application card: status chip + next action. */
export function ApplicationCard({ app, showAction = true }: { app: PortalApplicationDto; showAction?: boolean }) {
  const action = app.nextAction && app.nextAction.type !== 'NONE' ? app.nextAction : null;
  return (
    <Card className="overflow-hidden" data-testid="application-card">
      <Link href={`/portal/loans/${app.id}`} className="flex items-center gap-3 p-4 hover:bg-accent/40">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{app.product.name}</p>
            <StatusChip status={app.status} />
          </div>
          <p className="text-lg font-semibold tabular"><MoneyText kobo={app.amountKobo} trimZeroKobo /> <span className="text-xs font-normal text-muted-foreground">over {app.tenorMonths} months</span></p>
          <p className="text-xs text-muted-foreground">{app.reference} · {formatLagos(app.submittedAt ?? app.createdAt, 'date')}</p>
          <p className="text-xs text-muted-foreground">{app.statusMessage}</p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
      {showAction && action && (
        <div className="border-t bg-muted/40 px-4 py-2.5">
          <Button size="sm" asChild><Link href={action.href}>{action.label} <ArrowRight /></Link></Button>
        </div>
      )}
    </Card>
  );
}
