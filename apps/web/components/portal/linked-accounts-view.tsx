'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical, Landmark, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { NIGERIAN_BANKS, type LinkedAccountDto, type LinkedAccountStatus } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, Input, Select } from '@/components/ui/form';
import { OtpInput } from '@/components/otp-input';
import { Skeleton } from '@/components/ui/skeleton';
import { fieldErrors, portalErrorMessage } from '@/lib/portal-api';
import {
  createMandate, grantGsiConsent, linkAccount, removeLinkedAccount, requestGsiConsentOtp,
  useInvalidateAutodebit, useLinkedAccounts, useMandates,
} from '@/lib/portal-autodebit-api';
import { consentText } from './consent-card';
import { useConsents } from './hooks';

const STATUS_META: Record<LinkedAccountStatus, { label: string; variant: NonNullable<BadgeProps['variant']> }> = {
  PENDING: { label: 'Verifying', variant: 'info' },
  VERIFIED: { label: 'Verified', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  REMOVED: { label: 'Removed', variant: 'secondary' },
};

/* ───────────── list + remove ───────────── */
function AccountRow({ a }: { a: LinkedAccountDto }) {
  const invalidate = useInvalidateAutodebit();
  const [confirm, setConfirm] = React.useState(false);
  const remove = useMutation({
    mutationFn: () => removeLinkedAccount(a.id),
    onSuccess: () => { toast.success('Account removed'); setConfirm(false); invalidate(); },
    onError: (e) => { toast.error(portalErrorMessage(e)); setConfirm(false); },
  });
  const meta = STATUS_META[a.status];
  return (
    <li className="flex items-center justify-between gap-3 py-3" data-testid="linked-account-row">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{a.bankName}</p>
          {a.isPrimary && <Star className="size-3.5 text-warning" aria-label="Primary" />}
        </div>
        <p className="text-xs text-muted-foreground">{a.accountNumberMasked} · {a.accountNameMasked}</p>
        {a.status === 'FAILED' && a.failureReason && <p className="text-xs text-destructive">{a.failureReason}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={meta.variant}>{meta.label}</Badge>
        {!a.isPrimary && a.status !== 'REMOVED' && (
          <Button variant="ghost" size="icon" aria-label="Remove account" onClick={() => setConfirm(true)}><Trash2 className="size-4 text-destructive" /></Button>
        )}
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive loading={remove.isPending} title="Remove this account?" confirmLabel="Remove" description="You can link it again later." onConfirm={() => remove.mutate()} />
    </li>
  );
}

function AccountsList({ accounts }: { accounts: LinkedAccountDto[] }) {
  const active = accounts.filter((a) => a.status !== 'REMOVED');
  if (active.length === 0) return <EmptyState icon={Landmark} title="No linked accounts yet" description="Add a bank account below so we can verify it and set up autodebit." />;
  return <ul className="divide-y">{active.map((a) => <AccountRow key={a.id} a={a} />)}</ul>;
}

/* ───────────── add account ───────────── */
function AddAccountForm() {
  const invalidate = useInvalidateAutodebit();
  const [bank, setBank] = React.useState('');
  const [acct, setAcct] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => linkAccount({ accountNumber: acct, bankCode: bank }),
    onSuccess: (a) => {
      toast.success(a.status === 'VERIFIED' ? 'Account linked and verified' : 'Account added. We are verifying it.');
      setBank(''); setAcct(''); setError(null); invalidate();
    },
    onError: (e) => setError(fieldErrors(e).accountNumber ?? fieldErrors(e).bankCode ?? portalErrorMessage(e)),
  });
  const valid = bank !== '' && /^\d{10}$/.test(acct);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); if (valid) add.mutate(); }}>
      <FormField label="Bank" htmlFor="la-bank"><Select id="la-bank" className="h-12 text-base" value={bank} onChange={(e) => setBank(e.target.value)}>
        <option value="">Select your bank</option>
        {NIGERIAN_BANKS.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
      </Select></FormField>
      <FormField label="Account number (NUBAN)" htmlFor="la-acct" error={error ?? undefined} hint="The account must be in your own name.">
        <Input id="la-acct" inputMode="numeric" autoComplete="off" maxLength={10} className="h-12 text-lg tracking-widest tabular" value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={!valid} loading={add.isPending}>Add account</Button>
    </form>
  );
}

/* ───────────── GSI consent + mandate ───────────── */
function GsiConsentSetup({ onGranted }: { onGranted: () => void }) {
  const text = consentText('GSI_AUTODEBIT');
  const [otp, setOtp] = React.useState<{ challengeId: string; destination: string; demoCode?: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [agree, setAgree] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestOtp = useMutation({
    mutationFn: () => requestGsiConsentOtp(),
    onSuccess: (r) => { setOtp(r); setError(null); },
    onError: (e) => setError(portalErrorMessage(e)),
  });
  const grant = useMutation({
    mutationFn: () => grantGsiConsent({ acknowledged: agree, otpCode: code, challengeId: otp?.challengeId }),
    onSuccess: () => { toast.success('Autodebit authorization granted'); onGranted(); },
    onError: (e) => { setError(portalErrorMessage(e)); setCode(''); },
  });

  return (
    <Card>
      <CardHeader><CardTitle>Authorize autodebit</CardTitle><CardDescription>{text?.title ?? 'Standing instruction & autodebit'}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {text && <blockquote className="max-h-40 overflow-y-auto rounded-md bg-muted p-3 text-sm leading-relaxed">{text.body}</blockquote>}
        {!otp ? (
          <Button className="w-full" loading={requestOtp.isPending} onClick={() => { setError(null); requestOtp.mutate(); }}>Send me a code</Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to {otp.destination}.</p>
            <OtpInput value={code} onChange={setCode} autoFocus />
            {otp.demoCode && (
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
                <FlaskConical className="size-3.5 text-warning" aria-hidden />
                <span>Demo mode: your code is <span className="font-semibold tabular">{otp.demoCode}</span></span>
                <button type="button" onClick={() => setCode(otp.demoCode!)} className="rounded-full bg-warning/20 px-2 py-0.5 font-semibold hover:bg-warning/30">Use code</button>
              </div>
            )}
            <div className="flex items-start gap-3">
              <Checkbox id="gsi-agree" checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5 size-5" />
              <label htmlFor="gsi-agree" className="text-sm leading-snug">I authorize Damez to debit my linked account(s) for scheduled and overdue repayments.</label>
            </div>
            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
            <Button className="w-full" disabled={code.length < 6 || !agree} loading={grant.isPending} onClick={() => grant.mutate()}>Grant authorization</Button>
          </div>
        )}
        {error && !otp && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function CreateMandateForm({ verifiedAccounts }: { verifiedAccounts: LinkedAccountDto[] }) {
  const invalidate = useInvalidateAutodebit();
  const [accountId, setAccountId] = React.useState(verifiedAccounts[0]?.id ?? '');
  const create = useMutation({
    mutationFn: () => createMandate({ type: 'NIBSS_EMANDATE', linkedAccountId: accountId }),
    onSuccess: () => { toast.success('Mandate requested'); invalidate(); },
    onError: (e) => toast.error(portalErrorMessage(e)),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Set up autodebit mandate</CardTitle><CardDescription>NIBSS e-mandate on a verified account.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <FormField label="Account" htmlFor="mandate-account">
          <Select id="mandate-account" className="h-12 text-base" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {verifiedAccounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.accountNumberMasked}</option>)}
          </Select>
        </FormField>
        <Button className="w-full" disabled={!accountId} loading={create.isPending} onClick={() => create.mutate()}>Create NIBSS e-mandate</Button>
        <p className="text-xs text-muted-foreground">Card tokenization is coming soon as a second autodebit method.</p>
      </CardContent>
    </Card>
  );
}

function MandatesList() {
  const q = useMandates();
  if (q.isLoading) return <Skeleton className="h-16 w-full" />;
  if (!q.data || q.data.length === 0) return null;
  return (
    <ul className="space-y-2">
      {q.data.map((m) => (
        <li key={m.id} className="flex items-center justify-between rounded-md border bg-card p-3 text-sm">
          <div>
            <p className="font-medium">{m.type === 'NIBSS_EMANDATE' ? 'NIBSS e-mandate' : m.type === 'CARD_TOKEN' ? 'Card' : 'GSI'}{m.cardLast4 ? ` ••${m.cardLast4}` : ''}</p>
            {m.failureReason && <p className="text-xs text-destructive">{m.failureReason}</p>}
          </div>
          <Badge variant={m.status === 'ACTIVE' ? 'success' : m.status === 'FAILED' || m.status === 'REVOKED' ? 'destructive' : 'info'}>{m.status[0] + m.status.slice(1).toLowerCase()}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Linked-account management + autodebit (GSI consent + NIBSS e-mandate) setup. */
export function LinkedAccountsView() {
  const accountsQ = useLinkedAccounts();
  const consents = useConsents();
  const [gsiJustGranted, setGsiJustGranted] = React.useState(false);

  const verified = (accountsQ.data ?? []).filter((a) => a.status === 'VERIFIED');
  const gsiGranted = gsiJustGranted || !!consents.data?.consents.some((c) => c.purpose === 'GSI_AUTODEBIT' && c.status === 'GRANTED');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" aria-hidden /><h1 className="text-xl font-semibold">Linked accounts</h1></div>
      <Card>
        <CardHeader><CardTitle>Your accounts</CardTitle><CardDescription>Verified accounts are used for disbursement and autodebit repayments.</CardDescription></CardHeader>
        <CardContent>{accountsQ.isLoading ? <Skeleton className="h-24 w-full" /> : <AccountsList accounts={accountsQ.data ?? []} />}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Add an account</CardTitle></CardHeader>
        <CardContent><AddAccountForm /></CardContent>
      </Card>
      {verified.length > 0 && (
        <>
          {!gsiGranted ? <GsiConsentSetup onGranted={() => setGsiJustGranted(true)} /> : (
            <>
              <CreateMandateForm verifiedAccounts={verified} />
              <MandatesList />
            </>
          )}
        </>
      )}
    </div>
  );
}
