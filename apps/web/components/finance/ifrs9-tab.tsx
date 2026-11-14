'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNaira } from '@damez/shared';
import type { LoanStagingDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { KpiCard } from '@/components/kpi-card';
import { MoneyText } from '@/components/money';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { FormField, Input } from '@/components/ui/form';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { getProvisioningReport } from '@/lib/finance-api';
import { EclConfigDialog } from './ecl-config-dialog';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const STAGE_VARIANT: Record<number, 'success' | 'warning' | 'destructive'> = { 1: 'success', 2: 'warning', 3: 'destructive' };
const nairaAxis = (v: number) => formatNaira(v, { compact: true });

export function Ifrs9Tab() {
  const canEditConfig = useCan('settings:update');
  const [asOfDate, setAsOfDate] = React.useState(todayIso());
  const q = useQuery({ queryKey: ['ifrs9', 'provisioning-report', asOfDate], queryFn: () => getProvisioningReport(asOfDate) });
  const d = q.data;

  const loanColumns: DataColumn<LoanStagingDto>[] = [
    { id: 'reference', header: 'Reference', sortable: true, accessor: (l) => l.reference, cell: (l) => <span className="font-mono text-xs">{l.reference}</span> },
    { id: 'customerName', header: 'Customer', sortable: true, accessor: (l) => l.customerName },
    { id: 'outstanding', header: 'Outstanding', align: 'right', sortable: true, accessor: (l) => l.outstandingKobo, cell: (l) => <MoneyText kobo={l.outstandingKobo} /> },
    { id: 'dpd', header: 'DPD', align: 'right', sortable: true, accessor: (l) => l.dpd },
    { id: 'stage', header: 'Stage', sortable: true, accessor: (l) => l.stage, cell: (l) => <Badge variant={STAGE_VARIANT[l.stage] ?? 'outline'}>Stage {l.stage}</Badge> },
    { id: 'pd', header: 'PD (bps)', align: 'right', accessor: (l) => l.pdBps },
    { id: 'lgd', header: 'LGD (bps)', align: 'right', accessor: (l) => l.lgdBps },
    { id: 'ead', header: 'EAD', align: 'right', sortable: true, accessor: (l) => l.eadKobo, cell: (l) => <MoneyText kobo={l.eadKobo} /> },
    { id: 'ecl', header: 'ECL', align: 'right', sortable: true, accessor: (l) => l.eclKobo, cell: (l) => <MoneyText kobo={l.eclKobo} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FormField label="As of date" htmlFor="ifrs9-date" className="w-auto">
          <Input id="ifrs9-date" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
        </FormField>
        {canEditConfig && <EclConfigDialog />}
      </div>

      {q.isError && <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>}

      <section aria-label="ECL totals" className="grid gap-4 sm:grid-cols-2">
        {q.isLoading || !d ? (
          <>
            <KpiCard loading label="" value="" />
            <KpiCard loading label="" value="" />
          </>
        ) : (
          <>
            <KpiCard label="Total EAD" value={formatNaira(d.totalEadKobo, { compact: true })} />
            <KpiCard label="Total ECL" value={formatNaira(d.totalEclKobo, { compact: true })} />
          </>
        )}
      </section>

      <BarChartCard
        title="ECL by stage"
        description="Exposure at default vs expected credit loss"
        loading={q.isLoading}
        data={(d?.byStage ?? []).map((s) => ({ ...s, stageLabel: `Stage ${s.stage}` }))}
        xKey="stageLabel"
        yFormatter={nairaAxis}
        series={[{ key: 'eadKobo', label: 'EAD' }, { key: 'eclKobo', label: 'ECL' }]}
      />

      <DataTable
        columns={loanColumns}
        data={d?.loans ?? []}
        rowKey={(l) => l.loanId}
        loading={q.isLoading}
        error={null}
        exportName="ifrs9-staging"
        emptyTitle="No loans staged"
        searchPlaceholder="Search loans…"
      />
    </div>
  );
}
