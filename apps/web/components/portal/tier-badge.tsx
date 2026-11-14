import { ShieldCheck } from 'lucide-react';
import type { KycTier } from '@damez/shared';
import { Badge } from '@/components/ui/badge';

export function TierBadge({ tier, className }: { tier: KycTier; className?: string }) {
  if (tier === 0) return <Badge variant="secondary" className={className}>Not verified</Badge>;
  return (
    <Badge variant={tier === 3 ? 'success' : tier === 2 ? 'info' : 'default'} className={className}>
      <ShieldCheck className="size-3" aria-hidden /> Tier {tier}
    </Badge>
  );
}
