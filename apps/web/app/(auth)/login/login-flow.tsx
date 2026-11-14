'use client';
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Calculator,
  Coins,
  CreditCard,
  FileText,
  Handshake,
  Landmark,
  LineChart,
  LockKeyhole,
  Percent,
  PiggyBank,
  Receipt,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { loginSchema, type DemoTotp, type LoginResponse, type TotpEnrollResponse, type TotpVerifyResponse } from '@damez/shared';
import type { z } from 'zod';
import { Logo, LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/form';
import { OtpInput } from '@/components/otp-input';
import { ThemeToggle } from '@/components/theme-toggle';
import { errorMessage, get, post } from '@/lib/api';

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const DEMO_PASSWORD = 'Damez@Demo2026';
const DEMO_ACCOUNTS = [
  ['admin@damez.ng', 'Super Admin'], ['ceo@damez.ng', 'CEO'], ['risk.manager@damez.ng', 'Credit Risk Manager'],
  ['analyst@damez.ng', 'Credit Analyst'], ['officer@damez.ng', 'Loan Officer'], ['collections.manager@damez.ng', 'Collections Manager'],
  ['agent@damez.ng', 'Collections Agent'], ['treasury@damez.ng', 'Finance / Treasury'], ['compliance@damez.ng', 'Compliance'],
  ['support@damez.ng', 'Customer Support'],
] as const;

type LoginForm = z.input<typeof loginSchema>;
type Step =
  | { kind: 'credentials' }
  | { kind: 'totp'; token: string; email: string }
  | { kind: 'enroll'; token: string; email: string; enroll: TotpEnrollResponse };

function safeNext(n: string | null): string {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard';
}

const BACKGROUND_ICONS: Array<{
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  className: string;
  rotate: number;
}> = [
  { Icon: Landmark, className: 'left-[6%] top-[12%] size-11', rotate: -10 },
  { Icon: Wallet, className: 'left-[16%] top-[70%] size-10', rotate: 8 },
  { Icon: Coins, className: 'left-[4%] top-[48%] size-9', rotate: 14 },
  { Icon: Banknote, className: 'left-[27%] top-[8%] size-9', rotate: -6 },
  { Icon: PiggyBank, className: 'left-[10%] top-[88%] size-10', rotate: -4 },
  { Icon: Handshake, className: 'right-[8%] top-[16%] size-11', rotate: 10 },
  { Icon: LineChart, className: 'right-[5%] top-[52%] size-10', rotate: -8 },
  { Icon: CreditCard, className: 'right-[18%] top-[82%] size-9', rotate: 12 },
  { Icon: Receipt, className: 'right-[14%] top-[6%] size-9', rotate: -14 },
  { Icon: Calculator, className: 'right-[24%] top-[40%] size-9', rotate: 6 },
  { Icon: Percent, className: 'left-[22%] top-[36%] size-8', rotate: -16 },
  { Icon: FileText, className: 'right-[6%] top-[90%] size-9', rotate: 9 },
];

export function LoginFlow() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [step, setStep] = React.useState<Step>({ kind: 'credentials' });

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-6">
      {/* Ambient background: soft radial glow + faint grid, single accent colour */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(circle at 15% 10%, hsl(var(--primary) / 0.16), transparent 38%), ' +
            'radial-gradient(circle at 85% 90%, hsl(var(--primary) / 0.12), transparent 42%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.15]"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 40%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black 40%, transparent 85%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
        {BACKGROUND_ICONS.map(({ Icon, className, rotate }, i) => (
          <Icon
            key={i}
            className={`absolute text-primary/[0.09] dark:text-primary/[0.14] ${className}`}
            style={{ transform: `rotate(${rotate}deg)` }}
          />
        ))}
      </div>

      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-pop lg:grid-cols-[1.05fr_1fr]">
        {/* Brand panel */}
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
          <div
            className="absolute inset-0 opacity-40"
            aria-hidden
            style={{
              backgroundImage:
                'radial-gradient(circle at 15% 15%, hsl(160 80% 60% / .45), transparent 45%), radial-gradient(circle at 90% 85%, hsl(190 80% 50% / .35), transparent 40%)',
            }}
          />
          <svg className="pointer-events-none absolute -bottom-10 -right-10 size-64 opacity-[0.08]" viewBox="0 0 32 32" aria-hidden>
            <path d="M10 8.5h6.2a7.5 7.5 0 0 1 0 15H10z" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
          </svg>

          <div className="relative flex items-center gap-2.5 text-xl font-semibold tracking-tight">
            <span className="grid size-9 place-items-center rounded-lg bg-white/15">
              <LogoMark className="size-6" />
            </span>
            Damez Loan
          </div>

          <div className="relative max-w-sm space-y-7">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">
              Lend responsibly.
              <br />
              Recover with confidence.
            </h2>
            <ul className="space-y-4 text-sm text-primary-foreground/85">
              <li className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10"><ShieldCheck className="size-4" aria-hidden /></span>
                Apply
              </li>
              <li className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10"><LockKeyhole className="size-4" aria-hidden /></span>
                Check Credit Bureau for loan eligibility
              </li>
              <li className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10"><BadgeCheck className="size-4" aria-hidden /></span>
                Disburse and Recover
              </li>
            </ul>
          </div>

          <p className="relative text-xs text-primary-foreground/60">Authorised staff only.</p>
        </aside>

        {/* Form panel */}
        <main className="flex flex-col p-6 sm:p-10">
          <Logo className="mb-6 lg:hidden" />
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
            {step.kind === 'credentials' && <CredentialsStep onDone={setStep} />}
            {step.kind === 'totp' && <TotpStep step={step} next={next} onBack={() => setStep({ kind: 'credentials' })} />}
            {step.kind === 'enroll' && <TotpStep step={step} next={next} onBack={() => setStep({ kind: 'credentials' })} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function CredentialsStep({ onDone }: { onDone: (s: Step) => void }) {
  const f = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: async (v: LoginForm) => {
      const r = await post<LoginResponse>('/auth/login', v);
      if (r.status === 'TOTP_ENROLL_REQUIRED') {
        const enroll = await post<TotpEnrollResponse>('/auth/totp/enroll', { challengeToken: r.challengeToken });
        return { kind: 'enroll', token: r.challengeToken, email: v.email, enroll } as Step;
      }
      return { kind: 'totp', token: r.challengeToken, email: v.email } as Step;
    },
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  const err = f.formState.errors;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to the Damez Loan console.</p>
      </div>
      <form className="space-y-4" onSubmit={f.handleSubmit((v) => { setError(null); m.mutate(v); })} noValidate>
        {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <FormField label="Work email" htmlFor="email" error={err.email?.message && 'Enter a valid email address'}>
          <Input id="email" type="email" autoComplete="username" autoFocus placeholder="you@damez.ng" aria-invalid={!!err.email} {...f.register('email')} />
        </FormField>
        <FormField label="Password" htmlFor="password" error={err.password?.message && 'Password is required'}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!err.password} {...f.register('password')} />
        </FormField>
        <Button type="submit" className="h-12 w-full" size="lg" loading={m.isPending}>Continue</Button>
      </form>
      {DEMO && (
        <div className="rounded-lg border border-dashed p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Sparkles className="size-3.5" aria-hidden /> Demo accounts</p>
          <div className="flex flex-wrap gap-1.5">
            {DEMO_ACCOUNTS.map(([email, role]) => (
              <button
                key={email}
                type="button"
                title={email}
                className="rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-accent"
                onClick={() => { f.setValue('email', email); f.setValue('password', DEMO_PASSWORD); setError(null); }}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TotpStep({ step, next, onBack }: { step: Exclude<Step, { kind: 'credentials' }>; next: string; onBack: () => void }) {
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const done = React.useRef(false);
  const verify = useMutation({
    mutationFn: (c: string) => post<TotpVerifyResponse>('/auth/totp/verify', { challengeToken: step.token, code: c }),
    onSuccess: () => { window.location.assign(next); },
    onError: (e) => { setError(errorMessage(e)); setCode(''); done.current = false; },
  });
  const demo = useMutation({
    mutationFn: () => get<DemoTotp>('/auth/demo-totp', { email: step.email }),
    onSuccess: (r) => { setCode(r.code); submit(r.code); },
    onError: (e) => setError(errorMessage(e)),
  });
  function submit(c: string) {
    if (done.current) return;
    done.current = true;
    setError(null);
    verify.mutate(c);
  }
  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back</button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{step.kind === 'enroll' ? 'Set up two-factor' : 'Two-factor code'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {step.kind === 'enroll'
            ? 'Scan the QR code with an authenticator app, then enter the 6-digit code.'
            : `Enter the 6-digit code from your authenticator app for ${step.email}.`}
        </p>
      </div>
      {step.kind === 'enroll' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={step.enroll.qrDataUrl} alt="Authenticator QR code" className="size-44 rounded bg-white p-2" />
          <p className="text-xs text-muted-foreground">Or enter this key manually</p>
          <code className="break-all rounded bg-muted px-2 py-1 text-center font-mono text-xs tracking-wider">{step.enroll.secret}</code>
        </div>
      )}
      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <OtpInput value={code} onChange={setCode} onComplete={submit} disabled={verify.isPending} autoFocus />
      <Button className="h-12 w-full" size="lg" loading={verify.isPending} disabled={code.length !== 6} onClick={() => submit(code)}>Verify and sign in</Button>
      {DEMO && (
        <Button variant="outline" className="h-12 w-full" loading={demo.isPending} onClick={() => demo.mutate()}>Fill demo code</Button>
      )}
    </div>
  );
}
