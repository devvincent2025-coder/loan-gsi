'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { DOCUMENT_KIND_LABELS, formatLagos, type ApplicationStatus } from '@damez/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MoneyText } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PortalApiError, pPost, portalErrorMessage } from '@/lib/portal-api';
import { DocumentUploadCard } from './document-upload-card';
import { EligibilityResultView } from './eligibility-result';
import { KEYS, TRANSITIONAL, useApplication, useDocuments } from './hooks';
import { OfferAcceptance } from './offer-acceptance';
import { QuoteSummary } from './quote-summary';
import { StatusChip } from './status-chip';
import { StatusTimeline } from './status-timeline';

const CANCELLABLE: ApplicationStatus[] = ['DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT'];

export function ApplicationDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useApplication(id);
  const docs = useDocuments();
  const [confirm, setConfirm] = React.useState(false);
  const cancel = useMutation({
    mutationFn: () => pPost(`/applications/${id}/cancel`),
    onSuccess: () => { toast.success('Application cancelled'); setConfirm(false); void qc.invalidateQueries({ queryKey: KEYS.applications }); },
    onError: (e) => { toast.error(portalErrorMessage(e)); setConfirm(false); },
  });

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError || !q.data) {
    const nf = q.error instanceof PortalApiError && q.error.statusCode === 404;
    return <ErrorState message={nf ? 'We could not find that application.' : portalErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  }
  const app = q.data;
  const action = app.nextAction && app.nextAction.type !== 'NONE' ? app.nextAction : null;
  const missingDocs = app.requiredDocs.filter((d) => !d.satisfied);
  const processing = (TRANSITIONAL as readonly string[]).includes(app.status);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" asChild><Link href="/portal/loans"><ArrowLeft /> My loans</Link></Button>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{app.product.name}</h1>
          <p className="text-xs text-muted-foreground">{app.reference} · started {formatLagos(app.createdAt, 'date')}</p>
        </div>
        <StatusChip status={app.status} />
      </div>
      <Card>
        <CardContent className="flex items-baseline justify-between p-5">
          <p className="text-3xl font-semibold"><MoneyText kobo={app.amountKobo} trimZeroKobo /></p>
          <p className="text-sm text-muted-foreground">over {app.tenorMonths} months{app.purpose ? ` · ${app.purpose}` : ''}</p>
        </CardContent>
      </Card>

      {action && (
        <Card className="border-primary/40 bg-primary/5"><CardContent className="flex items-center justify-between gap-3 p-4">
          <div><p className="text-sm font-semibold">Action needed</p><p className="text-sm text-muted-foreground">{action.label}</p></div>
          <Button asChild><Link href={action.href}>{action.type === 'UPLOAD_DOCUMENT' ? 'Upload' : action.type === 'GIVE_CONSENT' ? 'Review' : 'Continue'} <ArrowRight /></Link></Button>
        </CardContent></Card>
      )}

      <Card>
        <CardHeader><CardTitle>Progress</CardTitle><CardDescription>{processing ? 'We are working on it. This page updates automatically.' : app.statusMessage}</CardDescription></CardHeader>
        <CardContent><StatusTimeline status={app.status} statusLabel={app.statusLabel} statusMessage={app.statusMessage} /></CardContent>
      </Card>

      {app.requiredDocs.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Documents</CardTitle><CardDescription>{missingDocs.length === 0 ? 'All required documents received.' : `${missingDocs.length} still needed.`}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5" aria-label="Required documents">
              {app.requiredDocs.map((d) => (
                <li key={d.kind} className="flex items-center gap-2 text-sm" data-satisfied={d.satisfied}>
                  {d.satisfied ? <CheckCircle2 className="size-5 text-success" aria-label="Done" /> : <Circle className="size-5 text-muted-foreground" aria-label="Missing" />}
                  {DOCUMENT_KIND_LABELS[d.kind]}
                </li>
              ))}
            </ul>
            {missingDocs.map((d) => <DocumentUploadCard key={d.kind} kind={d.kind} applicationId={app.id} docs={docs.data ?? []} />)}
          </CardContent>
        </Card>
      )}

      {app.eligibility && (
        <Card><CardHeader><CardTitle>Eligibility summary</CardTitle></CardHeader><CardContent><EligibilityResultView result={app.eligibility} /></CardContent></Card>
      )}

      {app.status === 'OFFER_SENT' && <OfferAcceptance applicationId={app.id} />}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Your repayment plan</h2>
        <QuoteSummary quote={app.quote} />
      </div>

      {CANCELLABLE.includes(app.status) && (
        <Button variant="outline" className="w-full text-destructive" onClick={() => setConfirm(true)}>Cancel application</Button>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive loading={cancel.isPending} title="Cancel this application?" confirmLabel="Yes, cancel it" description="You can always start a new application later." onConfirm={() => cancel.mutate()} />
    </div>
  );
}
