'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ExternalLink, FileX2 } from 'lucide-react';
import { DOCUMENT_KIND_LABELS, formatLagos, type ApplicationDetailDto, type ApplicationStatus, type ScorecardDto, type StateMachineDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { ActorIcon, ApplicationStatusBadge, OutcomeBadge, statusLabel } from '@/components/applications/application-ui';
import { EligibilityPanel } from '@/components/applications/eligibility-panel';
import { QuoteSummary } from '@/components/applications/quote-panel';
import { StateMachineGraph } from '@/components/applications/state-machine-graph';
import { TransitionActions } from '@/components/applications/transition-actions';
import { BureauReport } from '@/components/bureau/bureau-report';
import { KycTierBadge } from '@/components/customers/customer-ui';
import { DocumentsTable } from '@/components/customers/documents-table';
import { FraudSignalsPanel } from '@/components/customers/fraud-panel';
import { DisbursementPanel } from '@/components/offers/disbursement-panel';
import { OfferPanel } from '@/components/offers/offer-panel';
import { DecisionPanel } from '@/components/underwriting/decision-panel';
import { NotesPanel } from '@/components/underwriting/notes-panel';
import { MoneyText } from '@/components/money';
import { KeyValue, SectionCard } from '@/components/staff/ui-bits';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';
import { titleCase } from '@/lib/utils';

export function ApplicationDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const canScorecard = useCan('scorecard:read');
  const canDecide = useCan('underwriting:decide');
  const canReadNotes = useCan('underwriting:read');
  const q = useQuery({ queryKey: ['application', id], queryFn: () => get<ApplicationDetailDto>(`/applications/${id}`) });
  const machine = useQuery({ queryKey: ['application-state-machine'], queryFn: () => get<StateMachineDto>('/applications/state-machine'), staleTime: 300_000 });
  const scorecardId = q.data?.eligibility?.scorecard.id;
  const scorecard = useQuery({ queryKey: ['scorecard', scorecardId], queryFn: () => get<ScorecardDto>(`/scorecards/${scorecardId}`), enabled: canScorecard && !!scorecardId, retry: false });

  const update = (a: ApplicationDetailDto) => { qc.setQueryData(['application', id], a); void qc.invalidateQueries({ queryKey: ['applications'] }); void qc.invalidateQueries({ queryKey: ['bureau', a.customer.id] }); };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['application', id] }); };

  if (q.isLoading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const a = q.data;
  const visited: ApplicationStatus[] = [...new Set(a.events.flatMap((e) => [e.to, ...(e.from ? [e.from] : [])]))];
  const dtiLimit = scorecard.data?.definition.affordability.maxDtiBps;
  const missing = a.requiredDocs.filter((d) => !d.satisfied).length;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/applications" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Applications</Link>
        <PageHeader
          title={a.reference}
          description={`${a.customer.name} · ${a.product.name} · ${a.channel === 'PORTAL' ? 'Customer portal' : 'Branch'}`}
          actions={<><ApplicationStatusBadge status={a.status} /><OutcomeBadge outcome={a.eligibilityOutcome} score={a.score} /></>}
        />
      </div>

      <SectionCard title="Lifecycle" description={a.statusReason || undefined}>
        {machine.isLoading ? 
        <Skeleton className="h-32 w-full" /> : machine.isError ? 
        <ErrorState message={errorMessage(machine.error)} onRetry={() => machine.refetch()} /> : 
        machine.data && 
        <StateMachineGraph machine={machine.data} current={a.status} visited={visited} />}
        <div className="mt-4 border-t pt-4"><TransitionActions app={a} onUpdated={update} /></div>
      </SectionCard>

      {a.status === 'UNDER_REVIEW' && canDecide && <DecisionPanel app={a} onUpdated={update} />}

      {(a.status === 'APPROVED' || a.status === 'OFFER_SENT' || a.status === 'OFFER_ACCEPTED') && <OfferPanel app={a} />}

      {(a.status === 'OFFER_ACCEPTED' || a.status === 'DISBURSED' || a.status === 'ACTIVE') && <DisbursementPanel app={a} />}

      {canReadNotes && <NotesPanel applicationId={a.id} />}

      <SectionCard title="Request & pricing">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KeyValue label="Customer"><Link className="text-primary underline-offset-4 hover:underline" href={a.customerDetailHref}>{a.customer.name}</Link></KeyValue>
          <KeyValue label="Amount"><MoneyText kobo={a.amountKobo} /></KeyValue>
          <KeyValue label="Tenor">{a.tenorMonths} months</KeyValue>
          <KeyValue label="Purpose">{a.purpose ?? '—'}</KeyValue>
          <KeyValue label="Interest method">{titleCase(a.interestMethod)}</KeyValue>
          <KeyValue label="Monthly rate"><span className="tabular">{(a.monthlyRateBps / 100).toFixed(2)}%</span></KeyValue>
          <KeyValue label="Branch">{a.branch?.name ?? '—'}</KeyValue>
          <KeyValue label="Submitted">{a.submittedAt ? formatLagos(a.submittedAt) : 'Not submitted'}</KeyValue>
        </dl>
      </SectionCard>
      <QuoteSummary quote={a.quote} />

      {a.eligibility ? (
        <EligibilityPanel result={a.eligibility} dtiLimitBps={dtiLimit} minScore={scorecard.data?.definition.minScore} maxScore={scorecard.data?.definition.maxScore} />
      ) : (
        <SectionCard title="Eligibility assessment"><EmptyState title="Not assessed yet" description="Eligibility runs when the application is submitted. Use Re-assess to run it now." /></SectionCard>
      )}

      <SectionCard title="Credit bureau" description="Summary of the latest report. The full report lives on the customer record.">
        <BureauReport customerId={a.customer.id} compact customerHref={a.customerDetailHref} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="KYC" actions={<Link className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={a.customerDetailHref}>Customer record <ExternalLink className="size-3" aria-hidden /></Link>}>
          <dl className="grid grid-cols-2 gap-4"><KeyValue label="KYC tier"><KycTierBadge tier={a.kyc.tier} /></KeyValue><KeyValue label="Max loan for tier"><MoneyText kobo={a.kyc.maxLoanKobo} /></KeyValue></dl>
        </SectionCard>
        <SectionCard title="Required documents" description={missing ? `${missing} outstanding` : 'All required documents provided'}>
          {a.requiredDocs.length === 0 ? <p className="text-sm text-muted-foreground">This product requires no documents.</p> : (
            <ul className="space-y-1.5" data-testid="docs-checklist">
              {a.requiredDocs.map((d) => (
                <li key={d.kind} className="flex items-center gap-2 text-sm" data-satisfied={d.satisfied}>
                  {d.satisfied ? <Check className="size-4 text-success" aria-label="Provided" /> : <FileX2 className="size-4 text-destructive" aria-label="Missing" />}
                  <span className={d.satisfied ? '' : 'text-destructive'}>{DOCUMENT_KIND_LABELS[d.kind]}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <FraudSignalsPanel signals={a.fraudSignals} onChanged={refresh} />

      <SectionCard title="Documents"><DocumentsTable documents={a.documents} onChanged={refresh} exportName="application-documents" /></SectionCard>

      <SectionCard title="Event history">
        {a.events.length === 0 ? <p className="text-sm text-muted-foreground">No events yet.</p> : (
          <ol className="relative space-y-4 border-l pl-6" data-testid="event-history">
            {[...a.events].sort((x, y) => y.at.localeCompare(x.at)).map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[33px] top-0 flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground"><ActorIcon type={e.actor.type} /></span>
                <p className="text-sm"><span className="font-medium">{e.from ? `${statusLabel(e.from)} → ` : ''}{statusLabel(e.to)}</span> <span className="text-muted-foreground">by {e.actor.name} ({titleCase(e.actor.type)})</span></p>
                {e.reason && <p className="text-sm text-muted-foreground">{e.reason}</p>}
                <p className="text-xs text-muted-foreground">{formatLagos(e.at)}</p>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
