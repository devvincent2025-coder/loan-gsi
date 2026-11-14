import type { DebitAttemptStatus, InstallmentStatus, LoanStatus, MandateStatus } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { titleCase } from '@/lib/utils';

const LOAN_STATUS_VARIANT: Record<LoanStatus, NonNullable<BadgeProps['variant']>> = {
  DISBURSED: 'info',
  ACTIVE: 'success',
  Unpaid: 'warning',
  RESTRUCTURED: 'info',
  CLOSED: 'secondary',
  WRITTEN_OFF: 'destructive',
};
export const loanStatusLabel = (s: LoanStatus) => titleCase(s);
export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  return (
    <Badge variant={LOAN_STATUS_VARIANT[status]} data-testid="loan-status">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {loanStatusLabel(status)}
    </Badge>
  );
}

const INSTALLMENT_STATUS_VARIANT: Record<InstallmentStatus, NonNullable<BadgeProps['variant']>> = {
  PENDING: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
  OVERDUE: 'destructive',
};
export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }) {
  return <Badge variant={INSTALLMENT_STATUS_VARIANT[status]}>{titleCase(status)}</Badge>;
}

const DEBIT_ATTEMPT_STATUS_VARIANT: Record<DebitAttemptStatus, NonNullable<BadgeProps['variant']>> = {
  SCHEDULED: 'secondary',
  INITIATED: 'info',
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
  CANCELLED: 'secondary',
};
export function DebitAttemptStatusBadge({ status }: { status: DebitAttemptStatus }) {
  return <Badge variant={DEBIT_ATTEMPT_STATUS_VARIANT[status]}>{titleCase(status)}</Badge>;
}

const MANDATE_STATUS_VARIANT: Record<MandateStatus, NonNullable<BadgeProps['variant']>> = {
  PENDING: 'secondary',
  ACTIVE: 'success',
  FAILED: 'destructive',
  REVOKED: 'destructive',
  EXPIRED: 'secondary',
};
export function MandateStatusBadge({ status }: { status: MandateStatus }) {
  return <Badge variant={MANDATE_STATUS_VARIANT[status]}>{titleCase(status)}</Badge>;
}

/** DPD highlighted amber past due, red once severely Unpaid. */
export function DpdValue({ dpd }: { dpd: number }) {
  if (dpd <= 0) return <span className="tabular text-muted-foreground">0</span>;
  return <span className={`tabular font-medium ${dpd >= 90 ? 'text-destructive' : 'text-warning'}`}>{dpd}</span>;
}
