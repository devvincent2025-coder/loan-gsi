'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertOctagon, ArrowRight, Clock, FileSearch, History, RefreshCw, ShieldAlert, ShieldOff, Skull } from 'lucide-react';
import { formatLagos, type BureauPullDto, type BureauReportDto, type BureauReportListItem, type BureauScoreDto, type BureauSummaryDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { KpiCard } from '@/components/kpi-card';
import { MoneyText } from '@/components/money';
import { Callout, SectionCard } from '@/components/staff/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';
import { hasApiCode, postQuiet } from '@/lib/staff-api-extra';
import { titleCase } from '@/lib/utils';
import { BAND_COLOR, BUREAU_LABEL, bandForScore } from './bureau-utils';
import { EnquiryTimeline } from './enquiry-timeline';
import { FacilityTable } from './facility-table';
import { RepaymentHeatmap } from './repayment-heatmap';
import { ScoreGauge } from './score-gauge';

/* ───────── banners ───────── */
export function BureauBanners({ summary }: { summary: BureauSummaryDto }) {
  return (
    <div className="space-y-2" data-testid="bureau-banners">
      {summary.elsewhereDefault && (
        <div role="alert" data-testid="elsewhere-default-banner" className="flex items-start gap-3 rounded-md border-2 border-destructive bg-destructive px-4 py-3 text-destructive-foreground shadow-card">
          <AlertOctagon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-bold uppercase tracking-wide">Elsewhere default</p>
            <p className="text-sm">This customer is currently Unpaid or defaulted on a facility at another lender. Escalate before any offer is made.</p>
          </div>
        </div>
      )}
      {summary.fraudFlag && (
        <Callout tone="danger" icon={<ShieldAlert className="size-4" aria-hidden />} title="Fraud / watchlist flag" data-testid="fraud-banner">A credit bureau returned a fraud or watchlist flag for this customer.</Callout>
      )}
      {summary.hasWriteOff24m && (
        <Callout tone="danger" icon={<Skull className="size-4" aria-hidden />} title="Write-off in the last 24 months" data-testid="writeoff-banner">
          {summary.lastWriteOffMonthsAgo !== null ? `Most recent write-off was ${summary.lastWriteOffMonthsAgo} month(s) ago. ` : ''}This breaches the auto-decline policy.
        </Callout>
      )}
      {summary.hasDpd90In12m && (
        <Callout tone="danger" icon={<Clock className="size-4" aria-hidden />} title="90+ days past due in the last 12 months" data-testid="dpd90-banner">This breaches the auto-decline policy.</Callout>
      )}
    </div>
  );
}

/* ───────── scores ───────── */
export function BureauScores({ scores, summary }: { scores: BureauScoreDto[]; summary: BureauSummaryDto }) {
  return (
    <div className="grid gap-6 md:grid-cols-[auto,1fr] md:items-center">
      <div className="flex justify-center">
        <ScoreGauge score={summary.averageScore} band={summary.scoreBand} size="lg" label="Average score" />
      </div>
      <div className="space-y-3">
        {summary.thinFile && <Badge variant="warning">Thin file: little or no credit history</Badge>}
        {scores.length === 0 && <p className="text-sm text-muted-foreground">No bureau returned a score.</p>}
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {scores.map((s) => {
            const has = s.score !== null;
            const band = has ? (s.band ?? bandForScore(s.score!, s.minScore, s.maxScore)) : null;
            const pct = has ? Math.round(((s.score! - s.minScore) / Math.max(1, s.maxScore - s.minScore)) * 100) : 0;
            return (
              <li key={s.bureau} className="rounded-md border p-3" data-testid={`bureau-score-${s.bureau}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{BUREAU_LABEL[s.bureau] ?? s.bureau}</span>
                  <span className="tabular text-lg font-semibold">{has ? s.score : '—'}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${s.bureau} score`} aria-valuemin={s.minScore} aria-valuemax={s.maxScore} aria-valuenow={s.score ?? undefined}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: band ? BAND_COLOR[band] : undefined }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>{s.minScore}</span><span>{band ? titleCase(band) : 'No score'}</span><span>{s.maxScore}</span></div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ───────── KPIs ───────── */
export function BureauKpis({ summary, compact }: { summary: BureauSummaryDto; compact?: boolean }) {
  const cards: { label: string; value: React.ReactNode }[] = [
    { label: 'Active facilities', value: summary.activeFacilityCount },
    { label: 'Total outstanding', value: <MoneyText kobo={summary.totalOutstandingKobo} compact /> },
    { label: 'Total monthly obligations', value: <MoneyText kobo={summary.totalMonthlyObligationKobo} /> },
    { label: 'Enquiries 30 / 90 / 180d', value: `${summary.enquiries30d} / ${summary.enquiries90d} / ${summary.enquiries180d}` },
    { label: 'Defaults', value: summary.defaultCount },
    { label: 'Write-offs', value: summary.writeOffCount },
    { label: 'Worst DPD ever', value: `${summary.worstDpdEver}d` },
    { label: 'Legal actions', value: summary.legalActionCount },
  ];
  if (!compact) {
    cards.push({ label: 'Sold to collections', value: summary.soldToCollectionsCount });
    cards.push({ label: 'Guarantor exposure', value: <MoneyText kobo={summary.guarantorExposureKobo} compact /> });
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="bureau-kpis">
      {cards.map((c) => <KpiCard key={c.label} label={c.label} value={c.value} className="p-4" />)}
    </div>
  );
}

/* ───────── pull log ───────── */
export function PullLog({ customerId }: { customerId: string }) {
  const q = useQuery({ queryKey: ['bureau', customerId, 'pulls'], queryFn: () => get<BureauPullDto[]>(`/customers/${customerId}/bureau/pulls`) });
  const columns: DataColumn<BureauPullDto>[] = [
    { id: 'when', header: 'When', sortable: true, accessor: (p) => p.createdAt, cell: (p) => <DateTime value={p.createdAt} style="short" /> },
    { id: 'bureau', header: 'Bureau', accessor: (p) => p.bureau, cell: (p) => BUREAU_LABEL[p.bureau] ?? p.bureau },
    { id: 'reason', header: 'Reason', accessor: (p) => p.reason, cell: (p) => titleCase(p.reason) },
    { id: 'status', header: 'Status', accessor: (p) => p.status, cell: (p) => <Badge variant={p.status === 'SUCCESS' ? 'success' : p.status === 'CACHED' || p.status === 'NO_HIT' ? 'secondary' : 'destructive'}>{titleCase(p.status)}</Badge> },
    { id: 'cost', header: 'Cost', align: 'right', accessor: (p) => p.costKobo, cell: (p) => <MoneyText kobo={p.costKobo} /> },
    { id: 'by', header: 'Requested by', accessor: (p) => p.requestedBy?.name ?? 'System', cell: (p) => p.requestedBy?.name ?? <span className="text-muted-foreground">System</span> },
  ];
  return (
    <DataTable columns={columns} data={q.data ?? []} rowKey={(p) => p.id} loading={q.isLoading} error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()} pageSize={5} exportName="bureau-pulls" emptyTitle="No pulls yet" searchPlaceholder="Filter pulls…" />
  );
}

/* ───────── empty / consent states ───────── */
export function BureauEmptyState({ canPull, pulling, onPull, consentRequired, consentsHref, onGoToConsents }: {
  canPull: boolean; pulling?: boolean; onPull: () => void; consentRequired?: boolean; consentsHref?: string; onGoToConsents?: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="bureau-empty">
      {consentRequired && <ConsentRequiredNotice consentsHref={consentsHref} onGoToConsents={onGoToConsents} />}
      <EmptyState
        icon={FileSearch}
        title="No credit bureau report yet"
        description="Pull a report from CRC, FirstCentral and CreditRegistry to see this customer's scores, facilities and repayment history."
        action={canPull ? <Button onClick={onPull} loading={pulling}>Pull report</Button> : <p className="text-xs text-muted-foreground">You need the bureau:pull permission to pull a report.</p>}
      />
    </div>
  );
}

export function ConsentRequiredNotice({ consentsHref, onGoToConsents }: { consentsHref?: string; onGoToConsents?: () => void }) {
  return (
    <Callout tone="warning" icon={<ShieldOff className="size-4" aria-hidden />} title="Bureau consent is missing" data-testid="consent-required">
      <p>The customer has not granted (or has revoked) consent for credit bureau checks, so no report can be pulled. Ask the customer to grant it in their portal; the consent record is listed in the Overview tab.</p>
      {onGoToConsents ? (
        <button className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" onClick={onGoToConsents}>View consents <ArrowRight className="size-3" aria-hidden /></button>
      ) : consentsHref ? (
        <Link href={consentsHref} className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">View consents <ArrowRight className="size-3" aria-hidden /></Link>
      ) : null}
    </Callout>
  );
}

/* ───────── presentational report ───────── */
export function BureauReportView({ report, compact, fullReportHref }: { report: BureauReportDto; compact?: boolean; fullReportHref?: string }) {
  const { summary } = report;
  return (
    <div className="space-y-5">
      <BureauBanners summary={summary} />
      <SectionCard title="Credit score" description={`Pulled ${formatLagos(report.pulledAt)} (WAT)`}>
        <BureauScores scores={report.scores} summary={summary} />
      </SectionCard>
      <BureauKpis summary={summary} compact={compact} />
      {compact ? (
        fullReportHref && (
          <Button asChild variant="outline"><Link href={fullReportHref}>Open full report <ArrowRight /></Link></Button>
        )
      ) : (
        <>
          <SectionCard title="Credit facilities" description="Defaults, write-offs, collections and legal cases are highlighted in red.">
            <FacilityTable facilities={report.facilities} />
          </SectionCard>
          <SectionCard title="Repayment heatmap" description="Days past due per facility per month, oldest to newest (up to 36 months).">
            <RepaymentHeatmap facilities={report.facilities} />
          </SectionCard>
          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title="Enquiry timeline"><EnquiryTimeline enquiries={report.enquiries} summary={summary} /></SectionCard>
            <SectionCard title="Flags">
              {report.flags.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No fraud, watchlist or guarantor-default flags.</p>
              ) : (
                <ul className="space-y-2" data-testid="bureau-flags">
                  {report.flags.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <Badge variant="destructive">{titleCase(f.type)}</Badge>
                      <div className="min-w-0 flex-1"><p>{f.detail}</p><p className="text-xs text-muted-foreground">{BUREAU_LABEL[f.source] ?? f.source} · <DateTime value={f.date} style="date" /></p></div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────── container ───────── */
export interface BureauReportProps {
  customerId: string;
  /** summary-only variant for embedding (application detail) */
  compact?: boolean;
  /** where "open full report" / "view consents" point (customer detail page) */
  customerHref?: string;
  /** when embedded in the customer page: switch to the Overview tab instead of navigating */
  onGoToConsents?: () => void;
}

export function BureauReport({ customerId, compact, customerHref, onGoToConsents }: BureauReportProps) {
  const qc = useQueryClient();
  const canRead = useCan('bureau:read');
  const canPull = useCan('bureau:pull');
  const [reportId, setReportId] = React.useState<string | null>(null);
  const [consentRequired, setConsentRequired] = React.useState(false);

  const latest = useQuery({
    queryKey: ['bureau', customerId, 'latest'],
    queryFn: () => get<BureauReportDto | null>(`/customers/${customerId}/bureau`),
    enabled: canRead,
  });
  const past = useQuery({
    queryKey: ['bureau', customerId, 'report', reportId],
    queryFn: () => get<BureauReportDto>(`/customers/${customerId}/bureau/reports/${reportId}`),
    enabled: canRead && !!reportId,
  });
  const history = useQuery({
    queryKey: ['bureau', customerId, 'history'],
    queryFn: () => get<BureauReportListItem[]>(`/customers/${customerId}/bureau/history`),
    enabled: canRead && !compact,
  });

  const pull = useMutation({
    mutationFn: (force: boolean) => postQuiet<BureauReportDto>(`/customers/${customerId}/bureau/pull`, { force }),
    onSuccess: (r, force) => {
      setConsentRequired(false);
      setReportId(null);
      qc.setQueryData(['bureau', customerId, 'latest'], r);
      void qc.invalidateQueries({ queryKey: ['bureau', customerId] });
      void qc.invalidateQueries({ queryKey: ['customer', customerId] });
      toast.success(force ? 'Fresh report pulled from the bureaus' : 'Credit report pulled');
    },
    onError: (e) => {
      if (hasApiCode(e, 'CONSENT_REQUIRED')) setConsentRequired(true);
      else toast.error(errorMessage(e));
    },
  });

  if (!canRead) return <EmptyState icon={ShieldOff} title="Not available" description="You need the bureau:read permission to view credit reports." />;
  if (latest.isLoading) return <div className="space-y-3" aria-busy="true" data-testid="bureau-loading"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (latest.isError) return <ErrorState message={errorMessage(latest.error)} onRetry={() => latest.refetch()} />;

  const consentsHref = customerHref ? `${customerHref}?tab=overview#consents` : undefined;
  const viewing = reportId ? past.data : latest.data;
  if (!latest.data && !reportId) {
    return <BureauEmptyState canPull={canPull} pulling={pull.isPending} onPull={() => pull.mutate(false)} consentRequired={consentRequired} consentsHref={consentsHref} onGoToConsents={onGoToConsents} />;
  }

  return (
    <div className="space-y-5">
      {consentRequired && <ConsentRequiredNotice consentsHref={consentsHref} onGoToConsents={onGoToConsents} />}
      {viewing && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-card" data-testid="bureau-header">
          <div className="min-w-0">
            <p className="text-sm font-medium">Pulled <DateTime value={viewing.pulledAt} /></p>
            <p className="text-xs text-muted-foreground">{viewing.ageDays} day(s) old · {titleCase(viewing.reason)}</p>
          </div>
          {viewing.stale && <Badge variant="warning" data-testid="stale-badge">Stale</Badge>}
          {reportId && <Badge variant="info">Past report</Badge>}
          <div className="flex flex-wrap items-center gap-1">
            {viewing.bureausQueried.map((b) => {
              const failed = viewing.bureausFailed.find((f) => f.bureau === b);
              return <Badge key={b} variant={failed ? 'destructive' : 'secondary'} title={failed?.error}>{BUREAU_LABEL[b] ?? b}{failed ? ' failed' : ''}</Badge>;
            })}
            {viewing.bureausFailed.filter((f) => !viewing.bureausQueried.includes(f.bureau)).map((f) => <Badge key={f.bureau} variant="destructive" title={f.error}>{BUREAU_LABEL[f.bureau] ?? f.bureau} failed</Badge>)}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!compact && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><History /> History</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                  <DropdownMenuLabel>Past reports</DropdownMenuLabel>
                  {history.isLoading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
                  {history.data?.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No past reports</div>}
                  {reportId && <DropdownMenuItem onSelect={() => setReportId(null)}>Back to latest</DropdownMenuItem>}
                  {history.data?.map((h) => (
                    <DropdownMenuItem key={h.id} onSelect={() => setReportId(h.id)}>
                      <span className="flex flex-col"><span>{formatLagos(h.pulledAt, 'short')} · {titleCase(h.reason)}</span><span className="text-xs text-muted-foreground">Avg score {h.averageScore ?? '—'}</span></span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canPull && (
              <Button size="sm" variant="outline" loading={pull.isPending} onClick={() => pull.mutate(true)}><RefreshCw /> Refresh (force)</Button>
            )}
          </div>
        </div>
      )}
      {reportId && past.isLoading && <Skeleton className="h-64 w-full" />}
      {reportId && past.isError && <ErrorState message={errorMessage(past.error)} onRetry={() => past.refetch()} />}
      {viewing && <BureauReportView report={viewing} compact={compact} fullReportHref={customerHref ? `${customerHref}?tab=bureau` : undefined} />}
      {!compact && (
        <SectionCard title="Pull log" description="Every bureau call for this customer, with cost.">
          <PullLog customerId={customerId} />
        </SectionCard>
      )}
    </div>
  );
}
