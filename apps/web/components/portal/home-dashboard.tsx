'use client';
import Link from 'next/link';
import { ArrowRight, CalendarClock, Info, Sparkles, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MoneyText } from '@/components/money';
import { usePortalMe } from '@/lib/portal-auth';
import { ApplicationCard } from './application-card';
import { useApplications, useOnboarding } from './hooks';
import { IN_PROGRESS_STATUSES } from './status-chip';
import { progressSummary } from './stepper';
import { TierBadge } from './tier-badge';

export function HomeDashboard() {
  const me = usePortalMe();
  const onboarding = useOnboarding();
  const apps = useApplications();
  const summary = onboarding.data ? progressSummary(onboarding.data) : null;
  const live = (apps.data ?? []).filter((a) => IN_PROGRESS_STATUSES.includes(a.status) || a.status === 'ACTIVE' || a.status === 'Unpaid');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {me.firstName}</h1>
        </div>
        <TierBadge tier={me.kycTier} />
      </div>

      <Card className="bg-primary text-primary-foreground" data-testid="max-loan-card">
        <CardContent className="p-5">
          <p className="text-xs text-primary-foreground/80">You can borrow up to</p>
          <p className="text-3xl font-semibold tabular">{me.kycTier === 0 ? '₦0' : <MoneyText kobo={me.maxLoanKobo} trimZeroKobo />}</p>
          <p className="mt-1 text-xs text-primary-foreground/80">{me.kycTier === 0 ? 'Verify your BVN to unlock your first limit.' : me.kycTier < 3 ? 'Complete more verification to raise your limit.' : 'You have the highest limit.'}</p>
        </CardContent>
      </Card>

      {onboarding.isLoading ? <Skeleton className="h-28 w-full" /> : summary && !onboarding.data?.completed && (
        <Card data-testid="onboarding-progress">
          <CardHeader className="flex-row items-center gap-3 space-y-0"><Sparkles className="size-5 text-primary" aria-hidden /><div><CardTitle>{summary.done} of {summary.total} steps done</CardTitle><CardDescription>Finish setting up to apply for a loan.</CardDescription></div></CardHeader>
          <CardContent className="space-y-3">
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.pct} aria-label="Setup progress" className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${summary.pct}%` }} /></div>
            <Button size="lg" className="w-full" asChild><Link href="/portal/onboarding">Continue <ArrowRight /></Link></Button>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="my-loans" className="space-y-2">
        <div className="flex items-center justify-between"><h2 id="my-loans" className="text-sm font-semibold">Your applications</h2><Link href="/portal/loans" className="text-xs font-medium text-primary">See all</Link></div>
        {apps.isLoading ? <Skeleton className="h-28 w-full" /> : live.length === 0 ? (
          <Card className="p-5 text-center text-sm text-muted-foreground">No active applications yet.</Card>
        ) : live.slice(0, 3).map((a) => <ApplicationCard key={a.id} app={a} />)}
      </section>

      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0"><Wallet className="size-5 text-primary" aria-hidden /><div><CardTitle>Need funds?</CardTitle><CardDescription>Apply for a loan in minutes</CardDescription></div></CardHeader>
        <CardContent className="space-y-2">
          {me.onboardingComplete ? (
            <Button size="lg" className="w-full" asChild><Link href="/portal/loans/apply">Apply for a loan <ArrowRight /></Link></Button>
          ) : (
            <>
              <Button size="lg" className="w-full" disabled aria-describedby="apply-why">Apply for a loan <ArrowRight /></Button>
              <p id="apply-why" className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />Finish the setup steps above first. It only takes a few minutes.</p>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0"><CalendarClock className="size-5 text-primary" aria-hidden /><div><CardTitle>Next repayment</CardTitle><CardDescription>Repayments arrive in a later release.</CardDescription></div></CardHeader>
      </Card>
    </div>
  );
}
