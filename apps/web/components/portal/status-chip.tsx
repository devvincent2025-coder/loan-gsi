import type { ApplicationStatus } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';

export interface StatusMeta { label: string; variant: NonNullable<BadgeProps['variant']>; hint: string }

/** Friendly label + colour for every ApplicationStatus (server also sends statusLabel/statusMessage; this keeps chips consistent and offline-safe). */
export const APPLICATION_STATUS_META: Record<ApplicationStatus, StatusMeta> = {
  DRAFT: { label: 'Draft', variant: 'secondary', hint: 'Not submitted yet.' },
  SUBMITTED: { label: 'Submitted', variant: 'info', hint: 'We received your application.' },
  KYC_PENDING: { label: 'Verifying identity', variant: 'info', hint: 'We are checking your identity details.' },
  BUREAU_CHECK: { label: 'Credit check', variant: 'info', hint: 'We are checking your credit history.' },
  UNDER_REVIEW: { label: 'Under review', variant: 'warning', hint: 'A loan officer is reviewing your application.' },
  APPROVED: { label: 'Approved', variant: 'success', hint: 'Good news, your loan is approved.' },
  OFFER_SENT: { label: 'Offer ready', variant: 'success', hint: 'Your loan offer is ready.' },
  OFFER_ACCEPTED: { label: 'Offer accepted', variant: 'success', hint: 'We are preparing your disbursement.' },
  DISBURSED: { label: 'Disbursed', variant: 'success', hint: 'The money is on its way to your account.' },
  ACTIVE: { label: 'Active loan', variant: 'default', hint: 'Your loan is active. Repay on time to build your credit.' },
  Unpaid: { label: 'Overdue', variant: 'destructive', hint: 'A repayment is overdue.' },
  RESTRUCTURED: { label: 'Restructured', variant: 'warning', hint: 'Your repayment plan was changed.' },
  CLOSED: { label: 'Closed', variant: 'secondary', hint: 'This loan is fully repaid.' },
  WRITTEN_OFF: { label: 'Written off', variant: 'destructive', hint: 'Please contact us about this loan.' },
  REJECTED: { label: 'Not approved', variant: 'destructive', hint: 'We could not approve this application.' },
  CANCELLED: { label: 'Cancelled', variant: 'secondary', hint: 'You cancelled this application.' },
};

/** Statuses that still count as "in progress" for the home dashboard. */
export const IN_PROGRESS_STATUSES: ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'DISBURSED'];

export function StatusChip({ status, className }: { status: ApplicationStatus; className?: string }) {
  const m = APPLICATION_STATUS_META[status];
  return <Badge variant={m.variant} className={className} data-status={status}>{m.label}</Badge>;
}
