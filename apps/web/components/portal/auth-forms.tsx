'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ngPhoneSchema, type OtpChallengeResponse, type PortalVerifyOtpResponse } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField, Input } from '@/components/ui/form';
import { fieldErrors, pPost, portalErrorMessage } from '@/lib/portal-api';
import { PORTAL_ME_KEY } from '@/lib/portal-auth';
import { ConsentWording } from './consent-card';
import { OtpStep } from './otp-step';

export function normalizePhone(v: string): string {
  const s = v.replace(/[\s-]/g, '');
  return /^234\d{10}$/.test(s) ? `+${s}` : s;
}

/** Only same-site portal paths are honoured (no open redirects). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/portal') && !next.startsWith('//') && !next.startsWith('/portal/login') && !next.startsWith('/portal/register') ? next : '/portal';
}

function useAfterVerify() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = safeNext(useSearchParams().get('next'));
  return (r: PortalVerifyOtpResponse) => {
    qc.setQueryData(PORTAL_ME_KEY, r.customer);
    router.replace(next);
  };
}

export function LoginFlow() {
  const afterVerify = useAfterVerify();
  const [phone, setPhone] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [challenge, setChallenge] = React.useState<OtpChallengeResponse | null>(null);

  if (challenge) return <OtpStep challenge={challenge} onVerified={afterVerify} onBack={() => setChallenge(null)} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = ngPhoneSchema.safeParse(normalizePhone(phone));
    if (!p.success) return setError('Enter a valid Nigerian phone number, like 0803 123 4567.');
    setBusy(true);
    setError(null);
    try {
      setChallenge(await pPost<OtpChallengeResponse>('/auth/login', { phone: p.data }));
    } catch (err) {
      setError(portalErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter your phone number and we will text you a one-time code.</p>
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormField label="Phone number" htmlFor="phone" error={error ?? undefined}>
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" className="h-12 text-base" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!error || undefined} />
        </FormField>
        <Button type="submit" size="lg" className="h-12 w-full text-base" loading={busy}>Send code</Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">New here? <Link href="/portal/register" className="font-medium text-primary underline-offset-4 hover:underline">Create an account</Link></p>
    </div>
  );
}

export function RegisterFlow() {
  const afterVerify = useAfterVerify();
  const [form, setForm] = React.useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [accept, setAccept] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [challenge, setChallenge] = React.useState<OtpChallengeResponse | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (challenge) return <OtpStep challenge={challenge} onVerified={afterVerify} onBack={() => setChallenge(null)} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.firstName.trim()) errs.firstName = 'Enter your first name';
    if (!form.lastName.trim()) errs.lastName = 'Enter your last name';
    const phone = ngPhoneSchema.safeParse(normalizePhone(form.phone));
    if (!phone.success) errs.phone = 'Enter a valid Nigerian phone number, like 0803 123 4567';
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Enter a valid email or leave it blank';
    if (!accept) errs.accept = 'Please accept the privacy notice to continue';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length || !phone.success) return;
    setBusy(true);
    try {
      setChallenge(await pPost<OtpChallengeResponse>('/auth/register', {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: phone.data,
        ...(form.email.trim() ? { email: form.email.trim() } : {}), acceptPrivacy: true,
      }));
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe);
      setFormError(portalErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 pt-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">It takes about 5 minutes. Get a loan decision in minutes, not days.</p>
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First name" htmlFor="firstName" error={errors.firstName}><Input id="firstName" autoComplete="given-name" className="h-12 text-base" value={form.firstName} onChange={set('firstName')} /></FormField>
          <FormField label="Last name" htmlFor="lastName" error={errors.lastName}><Input id="lastName" autoComplete="family-name" className="h-12 text-base" value={form.lastName} onChange={set('lastName')} /></FormField>
        </div>
        <FormField label="Phone number" htmlFor="phone" error={errors.phone} hint="We will send a one-time code to this number.">
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" className="h-12 text-base" value={form.phone} onChange={set('phone')} />
        </FormField>
        <FormField label="Email (optional)" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" className="h-12 text-base" value={form.email} onChange={set('email')} />
        </FormField>
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex items-start gap-3">
            <Checkbox id="accept" className="mt-0.5 size-5" checked={accept} onCheckedChange={(v) => setAccept(v === true)} />
            <label htmlFor="accept" className="text-sm leading-snug">I have read and accept the privacy notice and agree to Damez processing my data.</label>
          </div>
          <ConsentWording purpose="DATA_PROCESSING" label="Read the privacy notice" />
          {errors.accept && <p role="alert" className="text-xs font-medium text-destructive">{errors.accept}</p>}
        </div>
        {formError && <p role="alert" className="text-sm font-medium text-destructive">{formError}</p>}
        <Button type="submit" size="lg" className="h-12 w-full text-base" loading={busy}>Continue</Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">Already registered? <Link href="/portal/login" className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link></p>
    </div>
  );
}
