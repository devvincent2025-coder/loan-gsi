import { Bot, User, UserRound } from 'lucide-react';
import type { ApplicationEventDto, ApplicationStatus, EligibilityOutcome } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { titleCase } from '@/lib/utils';

export const STATUS_GROUPS: { label: string; statuses: ApplicationStatus[] }[] = [
  { label: 'Origination', statuses: ['DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK'] },
  { label: 'Decision', statuses: ['UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED'] },
  { label: 'Booked', statuses: ['DISBURSED', 'ACTIVE'] },
  { label: 'Recovery', statuses: ['Unpaid', 'RESTRUCTURED'] },
  { label: 'Closed / exited', statuses: ['CLOSED', 'WRITTEN_OFF', 'REJECTED', 'CANCELLED'] },
];

const STATUS_VARIANT: Record<ApplicationStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'secondary', SUBMITTED: 'info', KYC_PENDING: 'info', BUREAU_CHECK: 'info', UNDER_REVIEW: 'warning',
  APPROVED: 'success', OFFER_SENT: 'success', OFFER_ACCEPTED: 'success', DISBURSED: 'success', ACTIVE: 'success',
  Unpaid: 'warning', RESTRUCTURED: 'info', CLOSED: 'secondary', WRITTEN_OFF: 'destructive', REJECTED: 'destructive', CANCELLED: 'secondary',
};
export const statusLabel = (s: ApplicationStatus) => titleCase(s);

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge variant={STATUS_VARIANT[status]} data-testid="application-status"><span className="size-1.5 rounded-full bg-current" aria-hidden />{statusLabel(status)}</Badge>;
}

const OUTCOME_VARIANT: Record<EligibilityOutcome, NonNullable<BadgeProps['variant']>> = { ELIGIBLE: 'success', CONDITIONAL: 'warning', INELIGIBLE: 'destructive' };
export function OutcomeBadge({ outcome, score }: { outcome: EligibilityOutcome | null | undefined; score?: number | null }) {
  if (!outcome) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={OUTCOME_VARIANT[outcome]} data-testid="outcome-badge">{titleCase(outcome)}</Badge>
      {score !== null && score !== undefined && <span className="tabular text-xs text-muted-foreground">Score: {score}/850</span>}
    </span>
  );
}

export function ActorIcon({ type }: { type: ApplicationEventDto['actor']['type'] }) {
  const Icon = type === 'CUSTOMER' ? UserRound : type === 'STAFF' ? User : Bot;
  return <Icon className="size-3.5" aria-label={titleCase(type)} />;
}
