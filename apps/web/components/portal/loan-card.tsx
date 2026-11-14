import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { formatLagos, type LoanDto } from '@damez/shared';
import { Card } from '@/components/ui/card';
import { MoneyText } from '@/components/money';
import { LoanStatusChip } from './loan-status-chip';

/** Compact booked-loan card: visual language mirrors `ApplicationCard`. */
export function LoanCard({ loan }: { loan: LoanDto }) {
  return (
    <Card className="overflow-hidden" data-testid="loan-card">
      <Link href={`/portal/repay/${loan.id}`} className="flex items-center gap-3 p-4 hover:bg-accent/40">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{loan.productName}</p>
            <LoanStatusChip status={loan.status} />
          </div>
          <p className="text-lg font-semibold tabular"><MoneyText kobo={loan.outstandingTotalKobo} trimZeroKobo /> <span className="text-xs font-normal text-muted-foreground">outstanding</span></p>
          <p className="text-xs text-muted-foreground">{loan.reference} · disbursed {formatLagos(loan.disbursedAt, 'date')}</p>
          {loan.dpd > 0 && <p className="text-xs font-medium text-destructive">{loan.dpd} day{loan.dpd > 1 ? 's' : ''} past due</p>}
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </Card>
  );
}
