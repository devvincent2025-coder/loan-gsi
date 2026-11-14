'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Eye, EyeOff, LifeBuoy, Mail } from 'lucide-react';
import {
  CONSENT_TEXTS, NIGERIAN_BANKS, NIGERIAN_STATES, type KycStepResult, type OnboardingStep, type PortalMe, type PortalProfileRequest,
} from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField, Input, Select } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { OtpInput } from '@/components/otp-input';
import { Skeleton } from '@/components/ui/skeleton';
import { fieldErrors, isCode, pPost, pPut, portalErrorMessage } from '@/lib/portal-api';
import { usePortalMe, usePortalMeActions } from '@/lib/portal-auth';
import { cn } from '@/lib/utils';
import { ConsentCard } from './consent-card';
import { DocumentUploadCard } from './document-upload-card';
import { FaceKyc } from './face-kyc';
import { useConsents, useDocuments, useInvalidateOnboarding } from './hooks';
import { DemoCodeChip } from './otp-step';

export interface StepProps {
  step: OnboardingStep;
  onDone: () => void;
  onBack?: () => void;
  onSkip?: () => void;
}

/** Common frame: title, helper copy, back link, optional skip. */
export function StepFrame({ step, onBack, onSkip, children }: { step: OnboardingStep; onBack?: () => void; onSkip?: () => void; children: React.ReactNode }) {
  return (
    <section aria-labelledby="step-title" className="space-y-4" data-testid={`step-${step.key}`}>
      <div>
        {onBack && <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={onBack}><ArrowLeft /> Back</Button>}
        <h2 id="step-title" className="text-xl font-semibold tracking-tight">{step.label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
        {step.status === 'FAILED' && step.detail && <p role="alert" className="mt-2 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">{step.detail}</p>}
        {step.status === 'REVIEW' && step.detail && <p className="mt-2 rounded-md bg-warning/15 p-2.5 text-sm">{step.detail}</p>}
      </div>
      {children}
      {onSkip && !step.required && step.status !== 'DONE' && <Button variant="ghost" className="w-full" onClick={onSkip}>Skip for now</Button>}
    </section>
  );
}

/** Already-completed steps show a tick + continue (resumable), with an optional "update" path. */
function DoneGate({ step, onDone, onBack, allowEdit, editLabel = 'Update', children }: StepProps & { allowEdit?: boolean; editLabel?: string; children: React.ReactNode }) {
  const [redo, setRedo] = React.useState(false);
  // Latch: only steps that were ALREADY done when opened show the tick screen. A step completed during this visit keeps
  // its own result screen (e.g. the account-name confirmation) even after the server refetch marks it DONE.
  const openedDone = React.useRef(step.status === 'DONE');
  if (!openedDone.current || redo) return <>{children}</>;
  return (
    <StepFrame step={step} onBack={onBack}>
      <Card><CardContent className="flex items-center gap-3 p-4">
        <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden />
        <p className="text-sm">{step.detail ?? 'This step is complete.'}</p>
      </CardContent></Card>
      <Button size="lg" className="w-full" onClick={onDone}>Continue</Button>
      {allowEdit && <Button variant="ghost" className="w-full" onClick={() => setRedo(true)}>{editLabel}</Button>}
    </StepFrame>
  );
}

/* ───────────── shared KYC bits ───────────── */

function useKycConsent() {
  const q = useConsents();
  return { loading: q.isLoading, granted: !!q.data?.consents.some((c) => c.purpose === 'KYC_VERIFICATION' && c.status === 'GRANTED') };
}

/** KYC consent is required before BVN/NIN/face: show the wording first (NDPA). */
function KycConsentGate({ children }: { children: React.ReactNode }) {
  const { loading, granted } = useKycConsent();
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (!granted) {
    return <ConsentCard purpose="KYC_VERIFICATION" agreeLabel="I agree and continue" explain="Before we check your identity, we need your permission to verify it with government and bank records." />;
  }
  return <>{children}</>;
}

export function KycResultCard({ result, onContinue, onRetry }: { result: KycStepResult; onContinue: () => void; onRetry: () => void }) {
  const map = {
    PASSED: { Icon: CheckCircle2, cls: 'text-success bg-success/10', title: 'Verified' },
    REVIEW: { Icon: Clock, cls: 'text-warning bg-warning/15', title: 'Under review' },
    FAILED: { Icon: AlertTriangle, cls: 'text-destructive bg-destructive/10', title: 'We could not verify this' },
    PENDING: { Icon: Clock, cls: 'text-info bg-info/12', title: 'Still checking' },
  }[result.status];
  return (
    <div className="space-y-4 text-center" data-testid="kyc-result" data-status={result.status}>
      <div className={cn('mx-auto flex size-14 items-center justify-center rounded-full', map.cls)}><map.Icon className="size-7" aria-hidden /></div>
      <div><h3 className="text-lg font-semibold">{map.title}</h3><p className="mt-1 text-sm text-muted-foreground">{result.message}</p></div>
      {result.status === 'REVIEW' && <p className="text-sm text-muted-foreground">We will review in a few minutes. You can carry on meanwhile.</p>}
      {result.status === 'FAILED' ? (
        result.retryAllowed ? <Button size="lg" className="w-full" onClick={onRetry}>Try again</Button> : <SupportNote />
      ) : (
        <Button size="lg" className="w-full" onClick={onContinue}>Continue</Button>
      )}
    </div>
  );
}

function SupportNote({ title = 'Please contact support' }: { title?: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border bg-muted p-3 text-left text-sm">
      <LifeBuoy className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div><p className="font-semibold">{title}</p><p className="text-muted-foreground">Our team will gladly help. Call 0700 DAMEZ or email support@damez.ng with your phone number.</p></div>
    </div>
  );
}

function SecretDigits({ id, value, onChange, length, label, invalid }: { id: string; value: string; onChange: (v: string) => void; length: number; label: string; invalid?: boolean }) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input
        id={id} type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="off" maxLength={length} value={value} aria-invalid={invalid || undefined}
        placeholder={'•'.repeat(length)} className="h-12 pr-11 text-lg tracking-widest tabular"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
      />
      <button type="button" aria-label={show ? `Hide ${label}` : `Show ${label}`} onClick={() => setShow((s) => !s)} className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Verifying spinner (no optimistic success for KYC). */
function Verifying({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center" role="status" aria-live="polite">
      <div className="size-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
      <p className="font-semibold">Verifying your {what}…</p>
      <p className="text-sm text-muted-foreground">Please keep this page open.</p>
    </div>
  );
}

/** Single-number KYC step (BVN / NIN). */
function IdNumberStep({ step, onDone, onBack, path, field, label, help, what }: StepProps & { path: string; field: 'bvn' | 'nin'; label: string; help: React.ReactNode; what: string }) {
  const invalidate = useInvalidateOnboarding();
  const [value, setValue] = React.useState('');
  const [result, setResult] = React.useState<KycStepResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dupe, setDupe] = React.useState(false);
  const [needConsent, setNeedConsent] = React.useState(false);
  const m = useMutation({
    mutationFn: () => pPost<KycStepResult>(path, { [field]: value }),
    onSuccess: (r) => { setResult(r); invalidate(); },
    onError: (e) => {
      if (isCode(e, 'DUPLICATE_BVN')) setDupe(true);
      else if (isCode(e, 'CONSENT_REQUIRED')) setNeedConsent(true);
      else setError(fieldErrors(e)[field] ?? portalErrorMessage(e));
    },
  });
  const valid = value.length === 11;
  return (
    <DoneGate step={step} onDone={onDone} onBack={onBack}>
      <StepFrame step={step} onBack={onBack}>
        {needConsent ? (
          <ConsentCard purpose="KYC_VERIFICATION" agreeLabel="I agree and continue" onGranted={() => { setNeedConsent(false); setError(null); }} />
        ) : (
          <KycConsentGate>
            {m.isPending ? <Verifying what={what} /> : result ? (
              <KycResultCard result={result} onContinue={onDone} onRetry={() => { setResult(null); setValue(''); }} />
            ) : dupe ? (
              <div className="space-y-3">
                <SupportNote title="This BVN is already linked to another account" />
                <Button variant="outline" className="w-full" onClick={() => { setDupe(false); setValue(''); }}>Check the number and try again</Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); if (valid) m.mutate(); }}>
                <FormField label={label} htmlFor={`${field}-input`} error={error ?? undefined} hint={undefined}>
                  <SecretDigits id={`${field}-input`} value={value} onChange={setValue} length={11} label={label} invalid={!!error} />
                </FormField>
                <p className="text-xs text-muted-foreground">{help}</p>
                <Button type="submit" size="lg" className="w-full" disabled={!valid}>Verify {what}</Button>
              </form>
            )}
          </KycConsentGate>
        )}
      </StepFrame>
    </DoneGate>
  );
}

export const BvnStep = (p: StepProps) => (
  <IdNumberStep {...p} path="/kyc/bvn" field="bvn" label="Bank Verification Number (BVN)" what="BVN"
    help={<>Dial <strong>*565*0#</strong> on your registered phone to get your BVN. We only check it; we never see your bank balance or move money.</>} />
);
export const NinStep = (p: StepProps) => (
  <IdNumberStep {...p} path="/kyc/nin" field="nin" label="National Identification Number (NIN)" what="NIN"
    help={<>Your 11-digit NIN is on your NIN slip or in the NIMC app. Dial <strong>*346#</strong> to retrieve it.</>} />
);

export function FaceStep({ step, onDone, onBack, onSkip }: StepProps) {
  const invalidate = useInvalidateOnboarding();
  return (
    <DoneGate step={step} onDone={onDone} onBack={onBack} allowEdit editLabel="Redo face check">
      <StepFrame step={step} onBack={onBack} onSkip={onSkip}>
        <KycConsentGate><FaceKyc onResult={invalidate} onContinue={onDone} /></KycConsentGate>
      </StepFrame>
    </DoneGate>
  );
}

export function BankStep({ step, onDone, onBack, onSkip }: StepProps) {
  const invalidate = useInvalidateOnboarding();
  const [bank, setBank] = React.useState('');
  const [acct, setAcct] = React.useState('');
  const [result, setResult] = React.useState<KycStepResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => pPost<KycStepResult>('/kyc/bank-account', { accountNumber: acct, bankCode: bank }),
    onSuccess: (r) => { setResult(r); invalidate(); },
    onError: (e) => setError(portalErrorMessage(e)),
  });
  const valid = bank !== '' && /^\d{10}$/.test(acct);
  return (
    <DoneGate step={step} onDone={onDone} onBack={onBack} allowEdit editLabel="Use a different account">
      <StepFrame step={step} onBack={onBack} onSkip={onSkip}>
        {m.isPending ? <Verifying what="account" /> : result ? (
          result.status === 'FAILED' ? (
            <KycResultCard result={result} onContinue={onDone} onRetry={() => { setResult(null); setAcct(''); }} />
          ) : (
            <div className="space-y-4" data-testid="bank-confirm">
              <Card><CardContent className="space-y-1 p-4 text-center">
                <p className="text-xs text-muted-foreground">Account name</p>
                <p className="text-lg font-semibold">{result.accountName ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{NIGERIAN_BANKS.find((b) => b.code === bank)?.name} · {acct.slice(0, 3)}••••{acct.slice(-3)}</p>
              </CardContent></Card>
              <p className="text-center text-sm text-muted-foreground">{result.status === 'REVIEW' ? 'The name differs slightly from your BVN, so we will review it. ' : ''}Is this your account?</p>
              <Button size="lg" className="w-full" onClick={onDone}>Yes, that is me</Button>
              <Button variant="outline" className="w-full" onClick={() => { setResult(null); setAcct(''); }}>No, use another account</Button>
            </div>
          )
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); if (valid) m.mutate(); }}>
            <FormField label="Bank" htmlFor="bank"><Select id="bank" className="h-12 text-base" value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Select your bank</option>
              {NIGERIAN_BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </Select></FormField>
            <FormField label="Account number (NUBAN)" htmlFor="acct" error={error ?? undefined} hint="The 10-digit number on your account. It must be in your own name.">
              <Input id="acct" inputMode="numeric" autoComplete="off" maxLength={10} className="h-12 text-lg tracking-widest tabular" value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            </FormField>
            <Button type="submit" size="lg" className="w-full" disabled={!valid}>Check account</Button>
          </form>
        )}
      </StepFrame>
    </DoneGate>
  );
}

export function AddressStep({ step, onDone, onBack, onSkip }: StepProps) {
  const invalidate = useInvalidateOnboarding();
  const [f, setF] = React.useState({ line1: '', city: '', state: '', landmark: '' });
  const [result, setResult] = React.useState<KycStepResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => pPost<KycStepResult>('/kyc/address', { line1: f.line1.trim(), city: f.city.trim(), state: f.state, ...(f.landmark.trim() ? { landmark: f.landmark.trim() } : {}) }),
    onSuccess: (r) => { setResult(r); invalidate(); },
    onError: (e) => setError(portalErrorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valid = f.line1.trim() && f.city.trim() && f.state;
  return (
    <DoneGate step={step} onDone={onDone} onBack={onBack}>
      <StepFrame step={step} onBack={onBack} onSkip={onSkip}>
        <p className="rounded-md bg-info/10 p-3 text-sm">Optional. Verifying your home address unlocks <strong>Tier 3</strong> and loans up to ₦10,000,000.</p>
        {m.isPending ? <Verifying what="address" /> : result ? (
          <KycResultCard result={result} onContinue={onDone} onRetry={() => setResult(null)} />
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); if (valid) m.mutate(); }}>
            <FormField label="Street address" htmlFor="ad-line1"><Input id="ad-line1" className="h-12 text-base" autoComplete="street-address" value={f.line1} onChange={set('line1')} /></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="City / town" htmlFor="ad-city"><Input id="ad-city" className="h-12 text-base" value={f.city} onChange={set('city')} /></FormField>
              <FormField label="State" htmlFor="ad-state"><Select id="ad-state" className="h-12 text-base" value={f.state} onChange={set('state')}><option value="">Select</option>{NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select></FormField>
            </div>
            <FormField label="Landmark (optional)" htmlFor="ad-landmark"><Input id="ad-landmark" className="h-12 text-base" value={f.landmark} onChange={set('landmark')} /></FormField>
            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={!valid}>Verify address</Button>
          </form>
        )}
      </StepFrame>
    </DoneGate>
  );
}

/* ───────────── EMAIL ───────────── */
export function EmailStep({ step, onDone, onBack, onSkip }: StepProps) {
  const me = usePortalMe();
  const { setMe } = usePortalMeActions();
  const invalidate = useInvalidateOnboarding();
  const [typed, setTyped] = React.useState('');
  const [sent, setSent] = React.useState<{ demoCode?: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const send = useMutation({
    // contract: POST /portal/email/send has no body; `email` is only sent when none is on file (assumption, see report)
    mutationFn: () => pPost<{ sent: true; demoCode?: string }>('/email/send', me.email ? {} : { email: typed.trim() }),
    onSuccess: (r) => { setSent(r); setError(null); },
    onError: (e) => setError(portalErrorMessage(e)),
  });
  const verify = useMutation({
    mutationFn: (c: string) => pPost<PortalMe>('/email/verify', { code: c }),
    onSuccess: (m) => { setMe(m); invalidate(); onDone(); },
    onError: (e) => { setCode(''); setError(portalErrorMessage(e)); },
  });
  const needEmail = !me.email;
  return (
    <DoneGate step={step} onDone={onDone} onBack={onBack}>
      <StepFrame step={step} onBack={onBack} onSkip={onSkip}>
        {!sent ? (
          <div className="space-y-4">
            {needEmail ? (
              <FormField label="Email address" htmlFor="em"><Input id="em" type="email" autoComplete="email" className="h-12 text-base" value={typed} onChange={(e) => setTyped(e.target.value)} /></FormField>
            ) : (
              <Card><CardContent className="flex items-center gap-3 p-4"><Mail className="size-5 text-primary" aria-hidden /><p className="text-sm">We will send a code to <span className="font-medium">{me.email}</span>.</p></CardContent></Card>
            )}
            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
            <Button size="lg" className="w-full" loading={send.isPending} disabled={needEmail && !/^\S+@\S+\.\S+$/.test(typed)} onClick={() => send.mutate()}>Send code</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">Enter the 6-digit code we emailed you.</p>
            <OtpInput value={code} onChange={setCode} onComplete={(c) => verify.mutate(c)} disabled={verify.isPending} autoFocus />
            {sent.demoCode && <DemoCodeChip code={sent.demoCode} onUse={(c) => { setCode(c); verify.mutate(c); }} />}
            {error && <p role="alert" className="text-center text-sm font-medium text-destructive">{error}</p>}
            <Button size="lg" className="w-full" loading={verify.isPending} disabled={code.length < 6} onClick={() => verify.mutate(code)}>Verify email</Button>
            <Button variant="link" className="w-full" loading={send.isPending} onClick={() => send.mutate()}>Resend code</Button>
          </div>
        )}
      </StepFrame>
    </DoneGate>
  );
}

/* ───────────── PROFILE ───────────── */
const EMPLOYMENT: { value: PortalProfileRequest['employment']['status']; label: string }[] = [
  { value: 'EMPLOYED', label: 'Employed (private sector)' },
  { value: 'CIVIL_SERVANT', label: 'Civil servant' },
  { value: 'SELF_EMPLOYED', label: 'Self-employed / business owner' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'RETIRED', label: 'Retired' },
  { value: 'UNEMPLOYED', label: 'Unemployed' },
];

export function ageFrom(dob: string, now = new Date()): number {
  const d = new Date(dob);
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a;
}

export function ProfileStep({ step, onDone, onBack, onSkip }: StepProps) {
  const { setMe } = usePortalMeActions();
  const invalidate = useInvalidateOnboarding();
  const [f, setF] = React.useState({ dob: '', gender: '', line1: '', city: '', state: '', landmark: '', status: '' as string, employer: '', salaryDay: '' });
  const [income, setIncome] = React.useState<number | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: (body: PortalProfileRequest) => pPut<PortalMe>('/profile', body),
    onSuccess: (me) => { setMe(me); invalidate(); onDone(); },
    onError: (e) => { const fe = fieldErrors(e); setErrors(Object.keys(fe).length ? fe : { form: portalErrorMessage(e) }); },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.dob) errs.dateOfBirth = 'Enter your date of birth';
    else if (ageFrom(f.dob) < 18) errs.dateOfBirth = 'You must be at least 18 years old';
    if (!f.line1.trim()) errs.line1 = 'Enter your street address';
    if (!f.city.trim()) errs.city = 'Enter your city';
    if (!f.state) errs.state = 'Choose your state';
    if (!f.status) errs.status = 'Choose your employment status';
    if (!income || income <= 0) errs.monthlyIncomeKobo = 'Enter your monthly income in naira';
    const day = f.salaryDay ? Number(f.salaryDay) : undefined;
    if (day !== undefined && !(Number.isInteger(day) && day >= 1 && day <= 31)) errs.salaryDay = 'Enter a day between 1 and 31';
    setErrors(errs);
    if (Object.keys(errs).length || !income) return;
    m.mutate({
      dateOfBirth: f.dob,
      ...(f.gender ? { gender: f.gender as 'MALE' | 'FEMALE' } : {}),
      address: { line1: f.line1.trim(), city: f.city.trim(), state: f.state, ...(f.landmark.trim() ? { landmark: f.landmark.trim() } : {}) },
      employment: { status: f.status as PortalProfileRequest['employment']['status'], ...(f.employer.trim() ? { employer: f.employer.trim() } : {}), monthlyIncomeKobo: income, ...(day ? { salaryDay: day } : {}) },
    });
  };
  const employed = f.status !== '' && !['UNEMPLOYED', 'STUDENT', 'RETIRED'].includes(f.status);
  return (
    <DoneGate step={step} onDone={onDone} onBack={onBack} allowEdit editLabel="Edit my details">
      <StepFrame step={step} onBack={onBack} onSkip={onSkip}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date of birth" htmlFor="dob" error={errors.dateOfBirth}><Input id="dob" type="date" className="h-12 text-base" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} value={f.dob} onChange={set('dob')} /></FormField>
            <FormField label="Gender (optional)" htmlFor="gender"><Select id="gender" className="h-12 text-base" value={f.gender} onChange={set('gender')}><option value="">Prefer not to say</option><option value="MALE">Male</option><option value="FEMALE">Female</option></Select></FormField>
          </div>
          <FormField label="Street address" htmlFor="line1" error={errors.line1 ?? errors['address.line1']}><Input id="line1" className="h-12 text-base" autoComplete="street-address" value={f.line1} onChange={set('line1')} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="City / town" htmlFor="city" error={errors.city}><Input id="city" className="h-12 text-base" value={f.city} onChange={set('city')} /></FormField>
            <FormField label="State" htmlFor="state" error={errors.state}><Select id="state" className="h-12 text-base" value={f.state} onChange={set('state')}><option value="">Select</option>{NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select></FormField>
          </div>
          <FormField label="Landmark (optional)" htmlFor="landmark"><Input id="landmark" className="h-12 text-base" value={f.landmark} onChange={set('landmark')} /></FormField>
          <FormField label="Employment status" htmlFor="status" error={errors.status}><Select id="status" className="h-12 text-base" value={f.status} onChange={set('status')}><option value="">Select</option>{EMPLOYMENT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          {employed && <FormField label="Employer / business name" htmlFor="employer"><Input id="employer" className="h-12 text-base" value={f.employer} onChange={set('employer')} /></FormField>}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Monthly income" htmlFor="income" error={errors.monthlyIncomeKobo ?? errors.monthlyIncome}><MoneyInput id="income" className="h-12 text-base" value={income} onChange={setIncome} aria-label="Monthly income" /></FormField>
            <FormField label="Salary day (optional)" htmlFor="salaryDay" error={errors.salaryDay}><Input id="salaryDay" inputMode="numeric" className="h-12 text-base" placeholder="e.g. 25" value={f.salaryDay} onChange={(e) => setF((x) => ({ ...x, salaryDay: e.target.value.replace(/\D/g, '').slice(0, 2) }))} /></FormField>
          </div>
          {errors.form && <p role="alert" className="text-sm font-medium text-destructive">{errors.form}</p>}
          <Button type="submit" size="lg" className="w-full" loading={m.isPending}>Save and continue</Button>
        </form>
      </StepFrame>
    </DoneGate>
  );
}

/* ───────────── DOCUMENTS ───────────── */
export function DocumentsStep({ step, onDone, onBack, onSkip }: StepProps) {
  const q = useDocuments();
  return (
    <DoneGate step={step} onDone={onDone} onBack={onBack} allowEdit editLabel="Manage my documents">
      <StepFrame step={step} onBack={onBack} onSkip={onSkip}>
        {q.isLoading ? <Skeleton className="h-40 w-full" /> : (
          <div className="space-y-3">
            {(['ID_CARD', 'PROOF_OF_ADDRESS', 'PAYSLIP', 'BANK_STATEMENT'] as const).map((k) => <DocumentUploadCard key={k} kind={k} docs={q.data ?? []} required={k === 'ID_CARD' ? undefined : false} />)}
            <Button size="lg" className="w-full" onClick={onDone}>Continue</Button>
          </div>
        )}
      </StepFrame>
    </DoneGate>
  );
}

/* ───────────── BUREAU CONSENT ───────────── */
export function BureauConsentStep({ step, onDone, onBack }: StepProps) {
  const q = useConsents();
  const granted = q.data?.consents.some((c) => c.purpose === 'BUREAU_PULL' && c.status === 'GRANTED');
  const t = CONSENT_TEXTS.find((x) => x.purpose === 'BUREAU_PULL');
  return (
    <StepFrame step={step} onBack={onBack}>
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : granted ? (
        <div className="space-y-4">
          <Card><CardContent className="flex items-center gap-3 p-4"><CheckCircle2 className="size-6 text-success" aria-hidden /><p className="text-sm">You have agreed to the credit bureau check ({t?.version}). You can withdraw this any time from your profile.</p></CardContent></Card>
          <Button size="lg" className="w-full" onClick={onDone}>Continue</Button>
        </div>
      ) : (
        <ConsentCard
          purpose="BUREAU_PULL" agreeLabel="I agree"
          explain="When you apply, we look at your credit history from licensed bureaus (CRC, FirstCentral and CreditRegistry) so we can give you a fair decision. This is a soft check."
          checkboxLabel="I agree that Damez may check my credit history with licensed credit bureaus."
          onGranted={onDone}
        />
      )}
    </StepFrame>
  );
}
