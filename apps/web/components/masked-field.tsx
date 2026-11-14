'use client';
import * as React from 'react';
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api';

export interface MaskedFieldProps {
  /** already-masked value as returned by the API */
  masked: string;
  label?: string;
  /** whether the viewer holds pii:reveal */
  canReveal: boolean;
  /** performs the audited reveal; resolves to the clear value */
  onReveal: (reason: string) => Promise<string>;
  /** auto re-mask delay (default 30s) */
  revealMs?: number;
  className?: string;
}

export function MaskedField({ masked, label, canReveal, onReveal, revealMs = 30_000, className }: MaskedFieldProps) {
  const [clear, setClear] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const remask = () => {
    if (timer.current) clearTimeout(timer.current);
    setClear(null);
  };

  const submit = async () => {
    if (reason.trim().length < 5) {
      setError('Give a reason of at least 5 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await onReveal(reason.trim());
      setClear(v);
      setAsking(false);
      setReason('');
      timer.current = setTimeout(() => setClear(null), revealMs);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revealed = clear !== null;
  const eyeLabel = revealed ? `Hide ${label ?? 'value'}` : `Reveal ${label ?? 'value'}`;

  return (
    <div className={cn('inline-flex flex-col gap-2', className)}>
      <div className="inline-flex items-center gap-1.5">
        <span className="tabular font-mono text-sm" data-testid="masked-value" aria-live="polite">
          {revealed ? clear : masked}
        </span>
        <Tooltip content={canReveal ? undefined : 'You need the pii:reveal permission'} disabled={canReveal}>
          <span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={eyeLabel}
              disabled={!canReveal}
              onClick={() => (revealed ? remask() : setAsking((a) => !a))}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </Button>
          </span>
        </Tooltip>
      </div>
      {asking && !revealed && (
        <form
          className="w-72 max-w-full space-y-2 rounded-md border bg-muted/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <ShieldAlert className="size-3.5" aria-hidden /> Revealing is logged
          </p>
          <label className="sr-only" htmlFor="reveal-reason">Reason for revealing</label>
          <Input id="reveal-reason" autoFocus placeholder="Reason (min 5 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Reveal for {Math.round(revealMs / 1000)}s
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAsking(false); setError(null); }}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
