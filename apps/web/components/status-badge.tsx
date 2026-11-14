import { Badge, type BadgeProps } from '@/components/ui/badge';
import { titleCase } from '@/lib/utils';

type V = NonNullable<BadgeProps['variant']>;
const MAP: Record<string, V> = {
  // users
  ACTIVE: 'success', LOCKED: 'warning', DISABLED: 'secondary',
  // approvals
  PENDING: 'warning', ESCALATED: 'info', EXECUTED: 'success', REJECTED: 'destructive', CANCELLED: 'secondary', FAILED: 'destructive', APPROVED: 'success',
  // audit
  SUCCESS: 'success', FAILURE: 'destructive', DENIED: 'warning',
  // kyc / delivery / integrations
  VERIFIED: 'success', QUEUED: 'secondary', SENT: 'info', DELIVERED: 'success',
  healthy: 'success', unconfigured: 'secondary', degraded: 'warning', mock: 'secondary', live: 'success',
};

const DISPLAY: Record<string, string> = {
  mock: 'Demo',
  unconfigured: 'Not configured',
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge variant={MAP[status] ?? 'outline'} className={className}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label ?? DISPLAY[status] ?? titleCase(status)}
    </Badge>
  );
}
