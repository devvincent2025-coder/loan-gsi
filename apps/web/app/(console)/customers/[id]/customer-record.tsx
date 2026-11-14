'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Flag, Smartphone, UserRound } from 'lucide-react';
import type { ApplicationSummaryDto, CustomerDetailDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { BureauReport } from '@/components/bureau/bureau-report';
import { CustomerOverview } from '@/components/customers/customer-overview';
import { KycStatusBadge, KycTierBadge } from '@/components/customers/customer-ui';
import { DocumentsTable } from '@/components/customers/documents-table';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { OutcomeBadge, ApplicationStatusBadge } from '@/components/applications/application-ui';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';

const TABS = ['overview', 'documents', 'applications', 'bureau'] as const;
type Tab = (typeof TABS)[number];

export function CustomerRecord({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const canBureau = useCan('bureau:read');
  const canDocs = useCan('document:read');
  const initial = params.get('tab') as Tab | null;
  const [tab, setTab] = React.useState<Tab>(initial && TABS.includes(initial) ? initial : 'overview');
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => get<CustomerDetailDto>(`/customers/${id}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['customer', id] }); };

  React.useEffect(() => {
    if (tab === 'overview' && typeof window !== 'undefined' && window.location.hash === '#consents') {
      setTimeout(() => document.getElementById('consents')?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [tab, q.data]);

  if (q.isLoading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const c = q.data;
  const openFraud = c.fraudSignals.filter((s) => !s.resolvedAt).length;
  const activeFlags = c.riskFlags.filter((f) => f.active).length;

  const appColumns: DataColumn<ApplicationSummaryDto>[] = [
    { id: 'ref', header: 'Reference', sortable: true, accessor: (a) => a.reference, cell: (a) => <span className="font-mono text-xs font-medium">{a.reference}</span> },
    { id: 'product', header: 'Product', accessor: (a) => a.product.name, cell: (a) => a.product.name },
    { id: 'amount', header: 'Amount', sortable: true, align: 'right', accessor: (a) => a.amountKobo, cell: (a) => <MoneyText kobo={a.amountKobo} /> },
    { id: 'tenor', header: 'Tenor', accessor: (a) => a.tenorMonths, cell: (a) => `${a.tenorMonths} mo` },
    { id: 'status', header: 'Status', accessor: (a) => a.status, cell: (a) => <ApplicationStatusBadge status={a.status} /> },
    { id: 'outcome', header: 'Eligibility', accessor: (a) => a.eligibilityOutcome ?? '', cell: (a) => <OutcomeBadge outcome={a.eligibilityOutcome} score={a.score} /> },
    { id: 'submitted', header: 'Submitted', sortable: true, accessor: (a) => a.submittedAt ?? a.createdAt, cell: (a) => <DateTime value={a.submittedAt ?? a.createdAt} style="short" /> },
  ];

  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Customers</Link>
      <PageHeader
        title={c.fullName}
        description={`Customer since ${new Date(c.createdAt).getFullYear()}`}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-testid="customer-header">
            <KycTierBadge tier={c.kycTier} />
            <KycStatusBadge status={c.kycStatus} />
            <Badge variant="outline">Max loan <MoneyText kobo={c.maxLoanKobo} compact /></Badge>
            {c.branch && <Badge variant="outline"><Building2 className="size-3" aria-hidden />{c.branch.name}</Badge>}
            {c.portalRegistered && <Badge variant="info"><Smartphone className="size-3" aria-hidden />Portal</Badge>}
            {openFraud > 0 && <Badge variant="destructive"><Flag className="size-3" aria-hidden />{openFraud} fraud signal{openFraud > 1 ? 's' : ''}</Badge>}
            {activeFlags > 0 && <Badge variant="warning">{activeFlags} risk flag{activeFlags > 1 ? 's' : ''}</Badge>}
            {c.bureau?.summary.elsewhereDefault && <Badge variant="destructive">Elsewhere default</Badge>}
          </div>
        }
      />
      <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); router.replace(`/customers/${id}?tab=${v}`, { scroll: false }); }}>
        <TabsList>
          <TabsTrigger value="overview"><UserRound className="mr-1.5 size-4" aria-hidden />Overview</TabsTrigger>
          {canDocs && <TabsTrigger value="documents">Documents ({c.documents.length})</TabsTrigger>}
          <TabsTrigger value="applications">Applications ({c.applications.length})</TabsTrigger>
          {canBureau && <TabsTrigger value="bureau">Credit bureau</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview"><CustomerOverview customer={c} onChanged={refresh} /></TabsContent>
        {canDocs && <TabsContent value="documents"><DocumentsTable documents={c.documents} onChanged={refresh} /></TabsContent>}
        <TabsContent value="applications">
          <DataTable columns={appColumns} data={c.applications} rowKey={(a) => a.id} onRowClick={(a) => router.push(`/applications/${a.id}`)} exportName="customer-applications" emptyTitle="No applications" emptyDescription="This customer has not applied for a loan yet." searchPlaceholder="Search applications…" />
        </TabsContent>
        {canBureau && (
          <TabsContent value="bureau">
            <BureauReport customerId={c.id} customerHref={`/customers/${c.id}`} onGoToConsents={() => { setTab('overview'); router.replace(`/customers/${id}?tab=overview#consents`, { scroll: false }); }} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
