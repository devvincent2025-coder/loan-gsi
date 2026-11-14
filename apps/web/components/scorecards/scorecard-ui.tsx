import type { ScorecardStatus } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { titleCase } from '@/lib/utils';

const V: Record<ScorecardStatus, NonNullable<BadgeProps['variant']>> = { DRAFT: 'warning', ACTIVE: 'success', RETIRED: 'secondary' };
export function ScorecardStatusBadge({ status }: { status: ScorecardStatus }) {
  return <Badge variant={V[status]} data-testid="scorecard-status">{titleCase(status)}</Badge>;
}
