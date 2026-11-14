'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Plus, Send } from 'lucide-react';
import type { ApplicationDetailDto, LoanOfferDto, LoanQuoteDto, OfferStatus } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTime } from '@/components/date-time';
import { MoneyInput, MoneyText } from '@/components/money';
import { CostOfCreditCard, ScheduleTable } from '@/components/applications/quote-panel';
import { NumberInput, SectionCard } from '@/components/staff/ui-bits';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage, post } from '@/lib/api';
import { createOffer, getOffers, offerLetterUrl, sendOffer } from '@/lib/underwriting-api';
import { useDebounced } from '@/lib/hooks';

const OFFER_VARIANT: Record<OfferStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'secondary', SENT: 'info', ACCEPTED: 'success', DECLINED: 'destructive', EXPIRED: 'destructive', WITHDRAWN: 'secondary',
};

function OfferRow({ offer, onSent }: { offer: LoanOfferDto; onSent: () => void }) {
  const canCreate = useCan('offer:create');
  const send = useMutation({
    mutationFn: () => sendOffer(offer.id),
    onSuccess: () => { toast.success('Offer sent to customer'); onSent(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium">{offer.offerNumber}</span>
          <Badge variant={OFFER_VARIANT[offer.status]}>{offer.status}</Badge>
          {offer.isCounterOffer && <Badge variant="warning">Counter-offer</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={offerLetterUrl(offer.id)} target="_blank" rel="noreferrer">
            <Download className="size-3" aria-hidden /> Download letter
          </a>
          {canCreate && offer.status === 'DRAFT' && (
            <Button size="sm" variant="outline" loading={send.isPending} onClick={() => send.mutate()}><Send /> Send</Button>
          )}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Principal</dt><dd><MoneyText kobo={offer.principalKobo} /></dd></div>
        <div><dt className="text-xs text-muted-foreground">Tenor</dt><dd>{offer.tenorMonths} mo</dd></div>
        <div><dt className="text-xs text-muted-foreground">Monthly rate</dt><dd className="tabular">{(offer.monthlyRateBps / 100).toFixed(2)}%</dd></div>
        <div><dt className="text-xs text-muted-foreground">Total repayable</dt><dd><MoneyText kobo={offer.totalRepayableKobo} /></dd></div>
      </dl>
      {(offer.sentAt || offer.expiresAt || offer.acceptedAt || offer.declinedAt) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {offer.sentAt && <>Sent <DateTime value={offer.sentAt} relative /> · </>}
          {offer.expiresAt && <>Expires <DateTime value={offer.expiresAt} style="short" /> · </>}
          {offer.acceptedAt && <>Accepted <DateTime value={offer.acceptedAt} relative /> · </>}
          {offer.declinedAt && <>Declined <DateTime value={offer.declinedAt} relative />{offer.declineReason ? `: ${offer.declineReason}` : ''}</>}
        </p>
      )}
    </li>
  );
}

function CreateOfferDialog({ app, open, onOpenChange, onCreated }: {
  app: ApplicationDetailDto; open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void;
}) {
  const [principalKobo, setPrincipalKobo] = React.useState<number | null>(app.amountKobo);
  const [tenorMonths, setTenorMonths] = React.useState<number | null>(app.tenorMonths);
  const [monthlyRateBps, setMonthlyRateBps] = React.useState<number | null>(null);
  const [isCounterOffer, setIsCounterOffer] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);

  const dAmount = useDebounced(principalKobo, 300);
  const dTenor = useDebounced(tenorMonths, 300);
  const preview = useQuery({
    queryKey: ['offer-schedule-preview', app.product.id, dAmount, dTenor],
    queryFn: () => post<LoanQuoteDto>('/loans/schedule-preview', { productId: app.product.id, amountKobo: dAmount, tenorMonths: dTenor }),
    enabled: open && !!dAmount && !!dTenor && dAmount > 0 && dTenor > 0,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () =>
      createOffer(app.id, {
        principalKobo: principalKobo!,
        tenorMonths: tenorMonths!,
        monthlyRateBps: monthlyRateBps ?? undefined,
        isCounterOffer,
        note: note.trim() || undefined,
      }),
    onSuccess: () => { toast.success('Offer created'); onOpenChange(false); onCreated(); },
    onError: (e) => setErr(errorMessage(e)),
  });

  React.useEffect(() => {
    if (open) {
      setPrincipalKobo(app.amountKobo);
      setTenorMonths(app.tenorMonths);
      setMonthlyRateBps(null);
      setIsCounterOffer(false);
      setNote('');
      setErr(null);
    }
  }, [open, app.amountKobo, app.tenorMonths]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create offer</DialogTitle>
          <DialogDescription>Review the computed schedule before issuing an offer for {app.reference}.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Principal" htmlFor="offer-amount" required>
            <MoneyInput id="offer-amount" value={principalKobo} onChange={setPrincipalKobo} />
          </FormField>
          <FormField label="Tenor (months)" htmlFor="offer-tenor" required>
            <NumberInput id="offer-tenor" value={tenorMonths} onChange={setTenorMonths} min={1} max={120} />
          </FormField>
          <FormField label="Monthly rate override (bps, optional)" htmlFor="offer-rate" hint="Leave blank to use the product's default rate.">
            <NumberInput id="offer-rate" value={monthlyRateBps} onChange={setMonthlyRateBps} min={1} max={2500} nullable />
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isCounterOffer} onCheckedChange={(v) => setIsCounterOffer(v === true)} aria-label="Mark as counter-offer" />
          This is a counter-offer (different terms than the customer requested)
        </label>

        <FormField label="Note (optional)" htmlFor="offer-note">
          <Textarea id="offer-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>

        {preview.isLoading && <Skeleton className="h-40 w-full" />}
        {preview.isError && <ErrorState message={errorMessage(preview.error)} onRetry={() => preview.refetch()} />}
        {preview.data && (
          <div className="space-y-4">
            <CostOfCreditCard cost={preview.data.cost} title="Preview: cost of credit" />
            <div>
              <p className="mb-2 text-sm font-medium">Preview: repayment schedule</p>
              <ScheduleTable schedule={preview.data.schedule} />
            </div>
          </div>
        )}

        {err && <p role="alert" className="text-xs font-medium text-destructive">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
          <Button loading={create.isPending} disabled={!principalKobo || !tenorMonths} onClick={() => create.mutate()}>Create offer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OfferPanel({ app }: { app: ApplicationDetailDto }) {
  const qc = useQueryClient();
  const canRead = useCan('offer:read');
  const canCreate = useCan('offer:create');
  const [creating, setCreating] = React.useState(false);
  const q = useQuery({ queryKey: ['offers', app.id], queryFn: () => getOffers(app.id), enabled: canRead });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['offers', app.id] });

  if (!canRead) return null;

  return (
    <SectionCard
      title="Offers"
      description="Loan offers generated for this application."
      actions={canCreate && app.status === 'APPROVED' && (
        <Button size="sm" onClick={() => setCreating(true)}><Plus /> Create offer</Button>
      )}
    >
      {q.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-16 w-full" /></div>
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <ol className="space-y-3">
          {[...q.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => (
            <OfferRow key={o.id} offer={o} onSent={refresh} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No offers yet.</p>
      )}

      <CreateOfferDialog app={app} open={creating} onOpenChange={setCreating} onCreated={refresh} />
    </SectionCard>
  );
}
