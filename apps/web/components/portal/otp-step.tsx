'use client';
import * as React from 'react';
import { FlaskConical } from 'lucide-react';
import type { OtpChallengeResponse, PortalVerifyOtpResponse } from '@damez/shared';
import { OtpInput } from '@/components/otp-input';
import { Button } from '@/components/ui/button';
import { PortalApiError, pPost, portalErrorMessage } from '@/lib/portal-api';

/** Clearly-labelled demo chip: only rendered when the API returns demoCode (DEMO_MODE, never production). */
export function DemoCodeChip({ code, onUse }: { code: string; onUse: (code: string) => void }) {
  return (
    <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs" data-testid="demo-code-chip">
      <FlaskConical className="size-3.5 text-warning" aria-hidden />
      <span>Demo mode: your code is <span className="font-semibold tabular">{code}</span></span>
      <button type="button" onClick={() => onUse(code)} className="rounded-full bg-warning/20 px-2 py-0.5 font-semibold hover:bg-warning/30">Use code</button>
    </div>
  );
}

export function useCountdown(seconds: number, key: unknown) {
  const [left, setLeft] = React.useState(seconds);
  React.useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [seconds, key]);
  return left;
}

export interface OtpStepProps {
  challenge: OtpChallengeResponse;
  onVerified: (r: PortalVerifyOtpResponse) => void;
  onBack?: () => void;
}

export function OtpStep({ challenge: initial, onVerified, onBack }: OtpStepProps) {
  const [challenge, setChallenge] = React.useState(initial);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const wait = useCountdown(challenge.resendAfterSeconds, challenge.challengeId);
  const expires = useCountdown(challenge.expiresInSeconds, challenge.challengeId);

  const verify = async (c: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onVerified(await pPost<PortalVerifyOtpResponse>('/auth/verify-otp', { challengeId: challenge.challengeId, code: c }));
    } catch (e) {
      setCode('');
      setError(e instanceof PortalApiError && e.statusCode === 401 ? 'That code is not right or has expired. Check it and try again.' : portalErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setError(null);
    try {
      setChallenge(await pPost<OtpChallengeResponse>('/auth/otp/resend', { challengeId: challenge.challengeId }));
      setCode('');
    } catch (e) {
      setError(portalErrorMessage(e));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enter your code</h1>
        <p className="mt-1 text-sm text-muted-foreground">We sent a 6-digit code to <span className="font-medium text-foreground">{challenge.destination}</span>.</p>
      </div>
      <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} autoFocus />
      {challenge.demoCode && <DemoCodeChip code={challenge.demoCode} onUse={(c) => { setCode(c); void verify(c); }} />}
      {error && <p role="alert" className="text-center text-sm font-medium text-destructive">{error}</p>}
      <Button size="lg" className="w-full" loading={busy} disabled={code.length < 6} onClick={() => void verify(code)}>Verify</Button>
      <div className="flex flex-col items-center gap-1 text-sm">
        {wait > 0 ? (
          <p className="text-muted-foreground" aria-live="polite">Resend code in <span className="tabular font-medium">{wait}s</span></p>
        ) : (
          <Button variant="link" size="sm" loading={resending} onClick={() => void resend()}>Resend code</Button>
        )}
        {expires === 0 && <p className="text-xs text-muted-foreground">This code has expired. Request a new one.</p>}
        {onBack && <Button variant="ghost" size="sm" onClick={onBack}>Use a different number</Button>}
      </div>
    </div>
  );
}
