'use client';
import * as React from 'react';
import Link from 'next/link';
import { PartyPopper } from 'lucide-react';
import type { OnboardingStepKey } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { MoneyText } from '@/components/money';
import { useOnboarding } from './hooks';
import {
  AddressStep, BankStep, BureauConsentStep, BvnStep, DocumentsStep, EmailStep, FaceStep, NinStep, ProfileStep, type StepProps,
} from './onboarding-steps';
import { OnboardingStepper, visibleSteps } from './stepper';
import { TierPanel } from './tier-panel';
import { portalErrorMessage } from '@/lib/portal-api';

const VIEWS: Partial<Record<OnboardingStepKey, React.ComponentType<StepProps>>> = {
  EMAIL: EmailStep, PROFILE: ProfileStep, BVN: BvnStep, NIN: NinStep, FACE: FaceStep,
  BANK_ACCOUNT: BankStep, DOCUMENTS: DocumentsStep, ADDRESS: AddressStep, BUREAU_CONSENT: BureauConsentStep,
};

export function OnboardingWizard() {
  const q = useOnboarding();
  const [active, setActive] = React.useState<OnboardingStepKey | null>(null);
  const [finished, setFinished] = React.useState(false);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <ErrorState message={portalErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const state = q.data;
  const steps = visibleSteps(state);
  const keys = steps.map((s) => s.key);
  // resumable: the server's currentStep is the default; fall back to the first unfinished one
  const resume = (state.currentStep && keys.includes(state.currentStep) ? state.currentStep : steps.find((s) => s.status !== 'DONE')?.key ?? keys[keys.length - 1]);
  const current = active && keys.includes(active) ? active : resume;
  const idx = keys.indexOf(current);
  const step = steps[idx];
  const View = VIEWS[current];

  const go = (i: number) => {
    setFinished(false);
    setActive(keys[Math.max(0, Math.min(keys.length - 1, i))]);
    window.scrollTo?.({ top: 0 });
  };
  const next = () => (idx >= keys.length - 1 ? setFinished(true) : go(idx + 1));
  const back = idx > 0 ? () => go(idx - 1) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finish setting up</h1>
        <p className="text-sm text-muted-foreground">A few quick steps so we can verify you and offer you the best loan.</p>
      </div>
      <div className="md:grid md:grid-cols-[16rem_1fr] md:gap-8">
        <aside className="space-y-4 md:sticky md:top-20 md:self-start">
          <OnboardingStepper state={state} active={finished ? null : current} onSelect={(k) => go(keys.indexOf(k))} />
          <TierPanel tiers={state.tiers} className="hidden md:block" />
        </aside>
        <div className="mt-5 min-w-0 md:mt-0">
          {finished || (state.completed && !View) ? (
            <Card><CardContent className="space-y-4 p-6 text-center">
              <PartyPopper className="mx-auto size-10 text-primary" aria-hidden />
              <h2 className="text-xl font-semibold">{state.completed ? 'You are all set!' : 'Almost there'}</h2>
              <p className="text-sm text-muted-foreground">
                {state.completed ? <>You can now borrow up to <MoneyText kobo={state.maxLoanKobo} trimZeroKobo className="font-semibold text-foreground" />.</> : 'Some required steps are still open. Pick them from the progress list to finish.'}
              </p>
              {state.completed ? <Button size="lg" className="w-full" asChild><Link href="/portal/loans/apply">Apply for a loan</Link></Button> : <Button size="lg" className="w-full" onClick={() => { setFinished(false); setActive(null); }}>Continue where I left off</Button>}
              <Button variant="ghost" className="w-full" asChild><Link href="/portal">Back to home</Link></Button>
            </CardContent></Card>
          ) : View && step ? (
            <View key={current} step={step} onDone={next} onBack={back} onSkip={next} />
          ) : null}
          <TierPanel tiers={state.tiers} className="mt-6 md:hidden" />
        </div>
      </div>
    </div>
  );
}
