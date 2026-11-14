'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { CONSENT_TEXTS, type ConsentDto, type ConsentPurpose } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { pPost, portalErrorMessage } from '@/lib/portal-api';
import { KEYS } from './hooks';

export function consentText(purpose: ConsentPurpose) {
  return CONSENT_TEXTS.find((t) => t.purpose === purpose);
}

/** Expandable consent wording (used on register for the privacy notice). */
export function ConsentWording({ purpose, label }: { purpose: ConsentPurpose; label?: string }) {
  const t = consentText(purpose);
  if (!t) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-primary">
        {label ?? `Read the ${t.title.toLowerCase()}`}
        <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">{t.body}</CollapsibleContent>
    </Collapsible>
  );
}

export interface ConsentCardProps {
  purpose: ConsentPurpose;
  /** plain-language "what happens next" */
  explain?: string;
  agreeLabel?: string;
  checkboxLabel?: string;
  onGranted?: (c: ConsentDto) => void;
  className?: string;
}

/** Shows the versioned consent wording with an explicit checkbox; granting records purpose + textVersion. */
export function ConsentCard({ purpose, explain, agreeLabel = 'I agree', checkboxLabel, onGranted, className }: ConsentCardProps) {
  const text = consentText(purpose);
  const qc = useQueryClient();
  const [checked, setChecked] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const grant = useMutation({
    mutationFn: () => pPost<ConsentDto>('/consents', { purpose, textVersion: text?.version }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: KEYS.consents });
      void qc.invalidateQueries({ queryKey: KEYS.onboarding });
      onGranted?.(c);
    },
    onError: (e) => setError(portalErrorMessage(e)),
  });
  if (!text) return null;
  const id = `consent-${purpose}`;
  return (
    <Card className={className} data-testid={`consent-card-${purpose}`}>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div><CardTitle>{text.title}</CardTitle>{explain && <CardDescription className="mt-1.5 text-sm">{explain}</CardDescription>}</div>
      </CardHeader>
      <CardContent className="space-y-4">
        <blockquote className="max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-sm leading-relaxed">{text.body}</blockquote>
        <div className="flex items-start gap-3">
          <Checkbox id={id} checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5 size-5" />
          <label htmlFor={id} className="text-sm leading-snug">{checkboxLabel ?? 'I have read and understood this, and I give my consent.'}</label>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <Button size="lg" className="w-full" disabled={!checked} loading={grant.isPending} onClick={() => { setError(null); grant.mutate(); }}>{agreeLabel}</Button>
      </CardContent>
    </Card>
  );
}
