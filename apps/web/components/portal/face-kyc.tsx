'use client';
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, ScanFace } from 'lucide-react';
import type { FaceSessionDto, KycStepResult, KycVerificationDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { pGet, pPost, portalErrorMessage } from '@/lib/portal-api';
import { usePortalMe } from '@/lib/portal-auth';
import { cn } from '@/lib/utils';

/** Minimal typing of the Dojah Web SDK (https://docs.dojah.io): loaded at runtime from widget.scriptUrl. */
export interface DojahConnectConfig {
  app_id: string;
  p_key: string;
  type: 'custom';
  config: { widget_id: string };
  user_data?: { first_name?: string; last_name?: string };
  metadata?: Record<string, string>;
  onSuccess?: (data: unknown) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}
export interface DojahConnectInstance { setup(): void; open(): void }
declare global {
  interface Window {
    Connect?: new (cfg: DojahConnectConfig) => DojahConnectInstance;
  }
}

const scriptCache = new Map<string, Promise<void>>();
export function loadScriptOnce(src: string): Promise<void> {
  const hit = scriptCache.get(src);
  if (hit) return hit;
  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing && window.Connect) return resolve();
    const s = existing ?? document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptCache.delete(src); reject(new Error('Could not load the verification tool. Check your connection and try again.')); };
    if (!existing) document.head.appendChild(s);
  });
  scriptCache.set(src, p);
  return p;
}

const IMAGE_KEY = /image|selfie|photo|picture|frame|video|base64|face_?img/i;
/** Drops anything image-like from the SDK payload: the browser callback is only a hint and must not carry biometrics. */
export function stripImageData(v: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (typeof v === 'string') return v.startsWith('data:') || v.length > 2000 ? undefined : v;
  if (Array.isArray(v)) return v.map((x) => stripImageData(x, depth + 1)).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (IMAGE_KEY.test(k)) continue;
      const c = stripImageData(val, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return v;
}

type Phase = 'intro' | 'starting' | 'widget' | 'verifying' | 'result' | 'error';

export function ResultPanel({ result, onRetry, onContinue }: { result: Pick<KycStepResult, 'status' | 'message' | 'retryAllowed'>; onRetry: () => void; onContinue?: () => void }) {
  const { status } = result;
  const cfg = {
    PASSED: { Icon: CheckCircle2, cls: 'text-success bg-success/10', title: 'Face verified', body: 'Your selfie matched your BVN photo. You are good to go.' },
    REVIEW: { Icon: Clock, cls: 'text-warning bg-warning/15', title: 'We are reviewing it', body: 'We will review in a few minutes. You can carry on with the next steps meanwhile.' },
    FAILED: { Icon: AlertTriangle, cls: 'text-destructive bg-destructive/10', title: 'We could not verify your face', body: 'Please try again.' },
    PENDING: { Icon: Clock, cls: 'text-info bg-info/12', title: 'Still verifying', body: 'This is taking longer than usual. We will update your progress shortly.' },
  }[status];
  return (
    <div className="space-y-4 text-center" data-testid="face-result" data-status={status}>
      <div className={cn('mx-auto flex size-16 items-center justify-center rounded-full', cfg.cls)}><cfg.Icon className="size-8" aria-hidden /></div>
      <div>
        <h3 className="text-lg font-semibold">{cfg.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{result.message || cfg.body}</p>
      </div>
      {status === 'FAILED' && (
        <ul className="mx-auto max-w-xs space-y-1 rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
          <li>Find good, even lighting, facing a window or lamp.</li>
          <li>Remove glasses, caps or face coverings.</li>
          <li>Hold the phone at eye level and keep your face inside the oval.</li>
        </ul>
      )}
      <div className="flex flex-col gap-2">
        {(status === 'PASSED' || status === 'REVIEW' || status === 'PENDING') && onContinue && <Button size="lg" onClick={onContinue}>Continue</Button>}
        {status === 'FAILED' && (result.retryAllowed ? <Button size="lg" onClick={onRetry}>Try again</Button> : <p className="text-sm text-muted-foreground">Please contact support so we can help you.</p>)}
      </div>
    </div>
  );
}

export interface FaceKycProps {
  /** fired once a terminal (or still-pending after polling) result is known */
  onResult?: (r: Pick<KycStepResult, 'status' | 'message' | 'retryAllowed'>) => void;
  onContinue?: () => void;
}

export function FaceKyc({ onResult, onContinue }: FaceKycProps) {
  const me = usePortalMe();
  const [phase, setPhase] = React.useState<Phase>('intro');
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Pick<KycStepResult, 'status' | 'message' | 'retryAllowed'> | null>(null);
  const done = React.useRef(false);

  const finish = React.useCallback((r: Pick<KycStepResult, 'status' | 'message' | 'retryAllowed'>) => {
    setResult(r);
    setPhase('result');
    onResult?.(r);
  }, [onResult]);

  /** server result is authoritative; if still PENDING poll the verifications list for up to ~20s */
  const settle = React.useCallback(async (res: KycStepResult, referenceId: string) => {
    if (res.status !== 'PENDING') return finish(res);
    setPhase('verifying');
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const list = await pGet<KycVerificationDto[]>('/kyc/verifications');
        const v = list.find((x) => x.type === 'FACE' && x.referenceId === referenceId);
        if (v && v.status !== 'PENDING') return finish({ status: v.status, message: v.summary, retryAllowed: v.status === 'FAILED' });
      } catch { /* keep polling */ }
    }
    finish({ status: 'PENDING', message: '', retryAllowed: false });
  }, [finish]);

  const complete = React.useCallback(async (body: { referenceId: string; sdkEvent?: unknown }) => {
    if (done.current) return;
    done.current = true;
    setPhase('verifying');
    try {
      const res = await pPost<KycStepResult>('/kyc/face/complete', body);
      await settle(res, body.referenceId);
    } catch (e) {
      done.current = false;
      setError(portalErrorMessage(e));
      setPhase('error');
    }
  }, [settle]);

  const start = async () => {
    setError(null);
    setPhase('starting');
    done.current = false;
    try {
      const s: FaceSessionDto = await pPost<FaceSessionDto>('/kyc/face/session');
      if (!s.widget) throw new Error('The verification tool is not available right now. Please try again shortly.');
      const w = s.widget;
      await loadScriptOnce(w.scriptUrl);
      if (!window.Connect) throw new Error('The verification tool did not load. Please try again.');
      setPhase('widget');
      const connect = new window.Connect({
        app_id: w.appId,
        p_key: w.publicKey,
        type: 'custom',
        config: { widget_id: w.widgetId },
        user_data: { first_name: me.firstName, last_name: me.lastName },
        metadata: { reference_id: s.referenceId },
        onSuccess: (data) => void complete({ referenceId: s.referenceId, sdkEvent: stripImageData(data) }),
        onError: (err) => {
          setError(typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : 'The verification was interrupted. Please try again.');
          setPhase('error');
        },
        onClose: () => setPhase((p) => (p === 'widget' ? 'intro' : p)),
      });
      connect.setup();
      connect.open();
    } catch (e) {
      setError(portalErrorMessage(e));
      setPhase('error');
    }
  };

  const retry = () => {
    setResult(null);
    setError(null);
    setPhase('intro');
  };

  if (phase === 'result' && result) return <ResultPanel result={result} onRetry={retry} onContinue={onContinue} />;
  if (phase === 'verifying') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center" role="status" aria-live="polite">
        <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
        <p className="font-semibold">Verifying…</p>
        <p className="max-w-xs text-sm text-muted-foreground">We are matching your face to your BVN photo. This usually takes a few seconds.</p>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="space-y-3 text-center">
        <p role="alert" className="text-sm font-medium text-destructive">{error}</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"><ScanFace className="size-8" aria-hidden /></div>
        <div>
          <h3 className="text-lg font-semibold">Quick selfie check</h3>
          <p className="mt-1 text-sm text-muted-foreground">We will match a live selfie to your BVN photo to keep your account safe. It takes about 30 seconds.</p>
        </div>
        <ul className="mx-auto max-w-xs space-y-1 text-left text-xs text-muted-foreground">
          <li>Use good lighting and face the camera.</li>
          <li>Remove glasses, caps or face coverings.</li>
          <li>Your selfie is not stored after verification.</li>
        </ul>
        <Button size="lg" className="w-full" loading={phase === 'starting' || phase === 'widget'} onClick={() => void start()}>Start face check</Button>
      </CardContent>
    </Card>
  );
}
