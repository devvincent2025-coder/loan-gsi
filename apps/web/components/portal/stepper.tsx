'use client';
import { AlertTriangle, Check, Clock, Lock } from 'lucide-react';
import type { OnboardingState, OnboardingStep } from '@damez/shared';
import { cn } from '@/lib/utils';

const DONE = new Set<OnboardingStep['status']>(['DONE']);

/** Steps shown in the wizard (ACCOUNT is done at registration and is not a screen). */
export const visibleSteps = (s: OnboardingState) => s.steps.filter((x) => x.key !== 'ACCOUNT');

function Dot({ step, index, current }: { step: OnboardingStep; index: number; current: boolean }) {
  const base = 'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold';
  if (step.status === 'DONE') return <span className={cn(base, 'border-success bg-success text-success-foreground')}><Check className="size-4" aria-hidden /></span>;
  if (step.status === 'FAILED') return <span className={cn(base, 'border-destructive bg-destructive/10 text-destructive')}><AlertTriangle className="size-4" aria-hidden /></span>;
  if (step.status === 'REVIEW') return <span className={cn(base, 'border-warning bg-warning/15 text-warning')}><Clock className="size-4" aria-hidden /></span>;
  if (step.status === 'LOCKED') return <span className={cn(base, 'border-input text-muted-foreground')}><Lock className="size-3.5" aria-hidden /></span>;
  return <span className={cn(base, current ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground')}>{index + 1}</span>;
}

export interface StepperProps {
  state: OnboardingState;
  /** step currently displayed in the wizard (may differ from state.currentStep when the user navigates) */
  active: OnboardingStep['key'] | null;
  onSelect?: (key: OnboardingStep['key']) => void;
}

/** Vertical stepper (desktop) + compact progress bar with step title (mobile). */
export function OnboardingStepper({ state, active, onSelect }: StepperProps) {
  const steps = visibleSteps(state);
  const required = steps.filter((s) => s.required);
  const doneRequired = required.filter((s) => DONE.has(s.status)).length;
  const idx = Math.max(0, steps.findIndex((s) => s.key === active));
  const activeStep = steps[idx];
  return (
    <div>
      {/* mobile */}
      <div className="md:hidden" data-testid="stepper-compact">
        <div className="flex items-baseline justify-between text-sm">
          <p className="font-semibold">{activeStep?.label}</p>
          <p className="text-xs text-muted-foreground">Step {idx + 1} of {steps.length}</p>
        </div>
        <div className="mt-2 flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((s) => s.status === 'DONE').length} aria-label="Onboarding progress">
          {steps.map((s) => (
            <span key={s.key} className={cn('h-1.5 flex-1 rounded-full', s.status === 'DONE' ? 'bg-success' : s.key === active ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>
      </div>
      {/* desktop */}
      <ol className="hidden space-y-1 md:block" aria-label="Onboarding steps" data-testid="stepper-vertical">
        {steps.map((s, i) => {
          const current = s.key === active;
          const clickable = !!onSelect && s.status !== 'LOCKED';
          return (
            <li key={s.key} data-step={s.key} data-status={s.status}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onSelect?.(s.key)}
                aria-current={current ? 'step' : undefined}
                className={cn('flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors', current ? 'bg-accent' : clickable && 'hover:bg-accent/60', !clickable && 'cursor-default')}
              >
                <Dot step={s} index={i} current={current} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{s.label}{!s.required && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Optional</span>}</span>
                  <span className="block text-xs text-muted-foreground">{s.detail ?? s.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 hidden text-xs text-muted-foreground md:block">{doneRequired} of {required.length} required steps done</p>
    </div>
  );
}

/** "3 of 7 steps done" summary for the home dashboard. */
export function progressSummary(state: OnboardingState) {
  const required = visibleSteps(state).filter((s) => s.required);
  const done = required.filter((s) => s.status === 'DONE').length;
  return { done, total: required.length, pct: required.length ? Math.round((done / required.length) * 100) : 100 };
}
