import type { LoanStatus } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';

export interface LoanStatusMeta { label: string; variant: NonNullable<BadgeProps['variant']>; hint: string }

/** Friendly label + colour for every booked-loan `LoanStatus` (distinct from `ApplicationStatus`/`StatusChip`). */
export const LOAN_STATUS_META: Record<LoanStatus, LoanStatusMeta> = {
  DISBURSED: { label: 'Disbursed', variant: 'info', hint: 'Funds have been sent to your account.' },
  ACTIVE: { label: 'Active', variant: 'default', hint: 'Your loan is active. Repay on time to build your credit.' },
  Unpaid: { label: 'Overdue', variant: 'destructive', hint: 'A repayment is overdue.' },
  RESTRUCTURED: { label: 'Restructured', variant: 'warning', hint: 'Your repayment plan was changed.' },
  CLOSED: { label: 'Closed', variant: 'secondary', hint: 'This loan is fully repaid.' },
  WRITTEN_OFF: { label: 'Written off', variant: 'destructive', hint: 'Please contact us about this loan.' },
};

export function LoanStatusChip({ status, className }: { status: LoanStatus; className?: string }) {
  const m = LOAN_STATUS_META[status];
  return <Badge variant={m.variant} className={className} data-status={status}>{m.label}</Badge>;
}
