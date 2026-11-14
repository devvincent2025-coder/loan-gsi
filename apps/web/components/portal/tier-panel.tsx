import { CheckCircle2, Circle } from 'lucide-react';
import type { OnboardingState } from '@damez/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MoneyText } from '@/components/money';
import { cn } from '@/lib/utils';

/** "Tier 1 → ₦100,000 … Tier 3 → ₦10,000,000": what each verification level unlocks. */
export function TierPanel({ tiers, className }: { tiers: OnboardingState['tiers']; className?: string }) {
  return (
    <Card className={className} data-testid="tier-panel">
      <CardHeader><CardTitle>Unlock bigger loans</CardTitle><CardDescription>Each verification level raises how much you can borrow.</CardDescription></CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {tiers.map((t) => (
            <li key={t.tier} className={cn('flex items-start gap-3', !t.achieved && 'text-muted-foreground')} data-achieved={t.achieved}>
              {t.achieved ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Achieved" /> : <Circle className="mt-0.5 size-5 shrink-0" aria-hidden />}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Tier {t.tier} → <MoneyText kobo={t.maxLoanKobo} trimZeroKobo /></p>
                <p className="text-xs">{t.requirements.join(' · ')}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
