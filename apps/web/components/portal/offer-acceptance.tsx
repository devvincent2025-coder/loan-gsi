'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, Download, FlaskConical } from 'lucide-react';
import { formatLagos, type LoanOfferDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField, Input, Textarea } from '@/components/ui/form';
import { MoneyText } from '@/components/money';
import { OtpInput } from '@/components/otp-input';
import { Skeleton } from '@/components/ui/skeleton';
import { portalErrorMessage } from '@/lib/portal-api';
import { useLinkedAccounts } from '@/lib/portal-autodebit-api';
import { acceptOffer, declineOffer, offerLetterUrl, requestOfferOtp, useInvalidateOffer, useOfferForApplication, type OfferOtpResponse } from '@/lib/portal-offers-api';
import { KEYS } from './hooks';

/**
 * Minimum VERIFIED linked accounts the server requires before `POST /offers/:id/accept` (the `linkedAccountsVerified`
 * guard in `OffersService`): `AUTODEBIT_MIN_LINKED_ACCOUNTS` (default 2) + 1 primary = 3. Not exposed via a portal
 * DTO/endpoint, so mirrored here as a client-side pre-check; the server's own 403 (`LINKED_ACCOUNTS_REQUIRED`,
 * with the exact configured count in its message) is still the source of truth and is surfaced verbatim on submit.
 */
const MIN_VERIFIED_LINKED_ACCOUNTS = 3;
const TERMS_VERSION = 'offer-terms-v1';

function OfferSummary({ offer }: { offer: LoanOfferDto }) {
  const firstInstalment = offer.schedule[0]?.totalKobo;
  return (
    <Card>
      <CardHeader><CardTitle>Your offer</CardTitle><CardDescription>Offer {offer.offerNumber}{offer.expiresAt ? ` · expires ${formatLagos(offer.expiresAt, 'date')}` : ''}</CardDescription></CardHeader>
      <CardContent>
        <dl className="divide-y">
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><dt className="text-muted-foreground">Loan amount</dt><dd className="font-medium"><MoneyText kobo={offer.principalKobo} trimZeroKobo /></dd></div>
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><dt className="text-muted-foreground">Tenor</dt><dd className="font-medium">{offer.tenorMonths} months</dd></div>
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><dt className="text-muted-foreground">Rate</dt><dd className="font-medium">{(offer.monthlyRateBps / 100).toFixed(2)}% per month</dd></div>
          {firstInstalment !== undefined && <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><dt className="text-muted-foreground">Monthly instalment</dt><dd className="font-semibold"><MoneyText kobo={firstInstalment} trimZeroKobo /></dd></div>}
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><dt className="text-muted-foreground">Total cost of credit</dt><dd className="font-medium"><MoneyText kobo={offer.totalCostOfCreditKobo} trimZeroKobo /></dd></div>
          <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><dt className="text-muted-foreground">Total you repay</dt><dd className="font-semibold"><MoneyText kobo={offer.totalRepayableKobo} trimZeroKobo /></dd></div>
        </dl>
        <Button variant="outline" className="mt-3 w-full" asChild><a href={offerLetterUrl(offer.id)} target="_blank" rel="noreferrer"><Download /> Download offer letter</a></Button>
      </CardContent>
    </Card>
  );
}

type Step = 'summary' | 'otp' | 'sign';

/** Accept flow: request OTP → enter code → e-signature name + terms checkbox → submit. Mirrors `OtpStep`'s pattern (OtpInput + demo-code chip), but cannot reuse that component directly: here the code is verified together with the e-signature in one `POST /offers/:id/accept` call rather than a standalone `/auth/verify-otp`. */
function AcceptFlow({ offer, applicationId }: { offer: LoanOfferDto; applicationId: string }) {
  const invalidate = useInvalidateOffer(applicationId);
  const qc = useQueryClient();
  const [step, setStep] = React.useState<Step>('summary');
  const [otpMeta, setOtpMeta] = React.useState<OfferOtpResponse | null>(null);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [agree, setAgree] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const requestOtp = useMutation({
    mutationFn: () => requestOfferOtp(offer.id),
    onSuccess: (r) => { setOtpMeta(r); setStep('otp'); setError(null); },
    onError: (e) => setError(portalErrorMessage(e)),
  });
  const accept = useMutation({
    mutationFn: () => acceptOffer(offer.id, { otpCode: code, eSignatureName: name.trim(), acceptedTermsVersion: TERMS_VERSION }),
    onSuccess: () => { toast.success('Offer accepted. We are preparing your disbursement.'); invalidate(); void qc.invalidateQueries({ queryKey: KEYS.application(applicationId) }); void qc.invalidateQueries({ queryKey: KEYS.applications }); },
    onError: (e) => { setError(portalErrorMessage(e)); setCode(''); },
  });

  if (step === 'summary') {
    return <Button size="lg" className="w-full" loading={requestOtp.isPending} onClick={() => { setError(null); requestOtp.mutate(); }}>Review and accept offer</Button>;
  }
  if (step === 'otp') {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">We sent a 6-digit code to {otpMeta?.destination ?? 'your registered phone'}.</p>
        <OtpInput value={code} onChange={setCode} onComplete={() => setStep('sign')} autoFocus />
        {otpMeta?.demoCode && (
          <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
            <FlaskConical className="size-3.5 text-warning" aria-hidden />
            <span>Demo mode: your code is <span className="font-semibold tabular">{otpMeta.demoCode}</span></span>
            <button type="button" onClick={() => { setCode(otpMeta.demoCode!); setStep('sign'); }} className="rounded-full bg-warning/20 px-2 py-0.5 font-semibold hover:bg-warning/30">Use code</button>
          </div>
        )}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <Button className="w-full" disabled={code.length < 6} onClick={() => setStep('sign')}>Continue</Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <FormField label="Full legal name (your e-signature)" htmlFor="esign-name" hint="Type your name exactly as it appears on your ID.">
        <Input id="esign-name" className="h-12 text-base" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="flex items-start gap-3">
        <Checkbox id="esign-agree" checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5 size-5" />
        <label htmlFor="esign-agree" className="text-sm leading-snug">I have read the offer letter and agree to its terms. I understand this is a legally binding e-signature.</label>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <Button size="lg" className="w-full" disabled={name.trim().length < 2 || !agree} loading={accept.isPending} onClick={() => { setError(null); accept.mutate(); }}>Accept offer</Button>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setStep('otp')}>Back</Button>
    </div>
  );
}

function DeclineAction({ offer, applicationId }: { offer: LoanOfferDto; applicationId: string }) {
  const invalidate = useInvalidateOffer(applicationId);
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const decline = useMutation({
    mutationFn: () => declineOffer(offer.id, reason.trim() || undefined),
    onSuccess: () => { toast.success('Offer declined'); setOpen(false); invalidate(); void qc.invalidateQueries({ queryKey: KEYS.application(applicationId) }); },
    onError: (e) => toast.error(portalErrorMessage(e)),
  });
  return (
    <>
      <Button variant="ghost" size="sm" className="w-full text-destructive" onClick={() => setOpen(true)}>Decline this offer</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} destructive loading={decline.isPending} title="Decline this offer?" confirmLabel="Decline offer" onConfirm={() => decline.mutate()}>
        <FormField label="Reason (optional)" htmlFor="decline-reason"><Textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </ConfirmDialog>
    </>
  );
}

/** Rendered on `ApplicationDetail` when `status === 'OFFER_SENT'`. */
export function OfferAcceptance({ applicationId }: { applicationId: string }) {
  const offerQ = useOfferForApplication(applicationId);
  const linkedQ = useLinkedAccounts();

  if (offerQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (offerQ.isError) return null; // non-essential: ApplicationDetail already shows the primary error surface
  const offer = offerQ.data;
  if (!offer) return null;

  if (offer.status === 'ACCEPTED') {
    return (
      <Card className="border-success/40 bg-success/10"><CardContent className="flex items-center gap-3 p-4"><CheckCircle2 className="size-6 text-success" aria-hidden /><p className="text-sm">Offer accepted. We are preparing your disbursement.</p></CardContent></Card>
    );
  }
  if (offer.status === 'DECLINED') {
    return (
      <Card className="border-muted bg-muted/40"><CardContent className="flex items-center gap-3 p-4"><Ban className="size-6 text-muted-foreground" aria-hidden /><p className="text-sm">You declined this offer{offer.declineReason ? `: "${offer.declineReason}"` : ''}.</p></CardContent></Card>
    );
  }
  if (offer.status !== 'SENT') return null;

  const verifiedCount = linkedQ.data?.filter((a) => a.status === 'VERIFIED').length ?? 0;
  const enoughLinkedAccounts = verifiedCount >= MIN_VERIFIED_LINKED_ACCOUNTS;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Your loan offer</h2>
      <OfferSummary offer={offer} />
      {linkedQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : enoughLinkedAccounts ? (
        <>
          <AcceptFlow offer={offer} applicationId={applicationId} />
          <DeclineAction offer={offer} applicationId={applicationId} />
        </>
      ) : (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div className="space-y-2">
              <p className="text-sm font-medium">Link and verify at least {MIN_VERIFIED_LINKED_ACCOUNTS} bank accounts before accepting</p>
              <p className="text-sm text-muted-foreground">You currently have {verifiedCount} verified. We need this so we can set up autodebit for your repayments.</p>
              <Button size="sm" asChild><Link href="/portal/linked-accounts">Add accounts <ArrowRight /></Link></Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
