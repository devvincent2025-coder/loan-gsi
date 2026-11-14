'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, BadgeCheck, Landmark, Mail, Phone } from 'lucide-react';
import { formatLagos, type ConsentDto, type ConsentPurpose } from '@damez/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MoneyText } from '@/components/money';
import { Skeleton } from '@/components/ui/skeleton';
import { pPost, portalErrorMessage } from '@/lib/portal-api';
import { usePortalMe } from '@/lib/portal-auth';
import { KEYS, useConsents } from './hooks';
import { TierBadge } from './tier-badge';

export function ProfileView() {
  const me = usePortalMe();
  const qc = useQueryClient();
  const consents = useConsents();
  const [revoking, setRevoking] = React.useState<ConsentPurpose | null>(null);
  const revoke = useMutation({
    mutationFn: (p: ConsentPurpose) => pPost<ConsentDto>(`/consents/${p}/revoke`),
    onSuccess: () => { toast.success('Consent withdrawn'); setRevoking(null); void qc.invalidateQueries({ queryKey: KEYS.consents }); void qc.invalidateQueries({ queryKey: KEYS.onboarding }); },
    onError: (e) => { toast.error(portalErrorMessage(e)); setRevoking(null); },
  });
  const text = consents.data?.texts.find((t) => t.purpose === revoking);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Profile</h1>
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2"><p className="text-lg font-semibold">{me.firstName} {me.lastName}</p><TierBadge tier={me.kycTier} /></div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" aria-hidden /><dt className="sr-only">Phone</dt><dd className="tabular">{me.phone}</dd>{me.phoneVerified && <Badge variant="success"><BadgeCheck className="size-3" aria-hidden /> Verified</Badge>}</div>
            <div className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" aria-hidden /><dt className="sr-only">Email</dt><dd>{me.email ?? 'No email added'}</dd>{me.emailVerified && <Badge variant="success"><BadgeCheck className="size-3" aria-hidden /> Verified</Badge>}</div>
          </dl>
          <p className="text-xs text-muted-foreground">Your details are masked for your safety.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Link href="/portal/linked-accounts" className="flex items-center justify-between gap-3 p-4 hover:bg-accent/40">
            <div className="flex items-center gap-3"><Landmark className="size-5 text-primary" aria-hidden /><div><p className="text-sm font-semibold">Linked accounts</p><p className="text-xs text-muted-foreground">Manage bank accounts and autodebit</p></div></div>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Loan limit</CardTitle><CardDescription>Based on your verification level.</CardDescription></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-2xl font-semibold"><MoneyText kobo={me.maxLoanKobo} trimZeroKobo /></p>
          {me.kycTier < 3 && <Button size="sm" variant="outline" asChild><Link href="/portal/onboarding">Raise my limit</Link></Button>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Your consents</CardTitle><CardDescription>You control how we use your data. You can withdraw consent at any time.</CardDescription></CardHeader>
        <CardContent>
          {consents.isLoading ? <Skeleton className="h-32 w-full" /> : (
            <ul className="divide-y">
              {(consents.data?.texts ?? []).map((t) => {
                const c = consents.data?.consents.filter((x) => x.purpose === t.purpose).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))[0];
                const active = c?.status === 'GRANTED';
                return (
                  <li key={t.purpose} className="flex items-start justify-between gap-3 py-3" data-purpose={t.purpose}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{active ? `Granted ${formatLagos(c.grantedAt, 'date')}` : c ? `${c.status === 'REVOKED' ? 'Withdrawn' : 'Expired'} ${formatLagos(c.revokedAt ?? c.expiresAt ?? c.grantedAt, 'date')}` : 'Not given'}</p>
                    </div>
                    {active ? <Button size="sm" variant="outline" onClick={() => setRevoking(t.purpose)}>Withdraw</Button> : <Badge variant="secondary">{c ? 'Off' : 'Not given'}</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)} destructive loading={revoke.isPending}
        title={`Withdraw "${text?.title ?? 'consent'}"?`} confirmLabel="Withdraw consent"
        description={text?.required ? 'This permission is needed to apply for loans. You will have to agree again before your next application.' : 'You can give this permission again at any time.'}
        onConfirm={() => { if (revoking) revoke.mutate(revoking); }}
      />
    </div>
  );
}
