'use client';
import { AlertOctagon, GitCompareArrows } from 'lucide-react';
import type { BureauFacilityDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { MoneyText } from '@/components/money';
import { DateTime } from '@/components/date-time';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { titleCase } from '@/lib/utils';
import { isRedFacility, RED_ROW_CLASS, SOURCE_SHORT } from './bureau-utils';

const STATUS_VARIANT: Record<BureauFacilityDto['status'], NonNullable<BadgeProps['variant']>> = {
  PERFORMING: 'success', Unpaid: 'warning', DEFAULTED: 'destructive', WRITTEN_OFF: 'destructive', CLOSED: 'secondary',
};

export function FacilityTable({ facilities }: { facilities: BureauFacilityDto[] }) {
  const columns: DataColumn<BureauFacilityDto>[] = [
    {
      id: 'lender', header: 'Lender', sortable: true, accessor: (f) => f.lender,
      cell: (f) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            {isRedFacility(f) && <AlertOctagon className="size-3.5 shrink-0 text-destructive" aria-label="High risk facility" />}
            {f.lender}
          </p>
          <p className="text-xs text-muted-foreground">{titleCase(f.productType)}{f.isGuarantor ? ' · guarantor' : ''}</p>
        </div>
      ),
    },
    { id: 'granted', header: 'Granted', sortable: true, align: 'right', accessor: (f) => f.amountGrantedKobo, cell: (f) => <MoneyText kobo={f.amountGrantedKobo} /> },
    { id: 'outstanding', header: 'Outstanding', sortable: true, align: 'right', accessor: (f) => f.outstandingKobo, cell: (f) => <MoneyText kobo={f.outstandingKobo} className={f.outstandingKobo > 0 && isRedFacility(f) ? 'font-semibold text-destructive' : undefined} /> },
    {
      id: 'status', header: 'Status', sortable: true, accessor: (f) => f.status,
      cell: (f) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={STATUS_VARIANT[f.status]}>{titleCase(f.status)}</Badge>
          {f.soldToCollections && <Badge variant="destructive">Collections</Badge>}
          {f.legalAction && <Badge variant="destructive">Legal</Badge>}
        </div>
      ),
    },
    { id: 'tenor', header: 'Tenor', align: 'right', accessor: (f) => f.tenorMonths, cell: (f) => (f.tenorMonths ? `${f.tenorMonths} mo` : '—') },
    { id: 'monthly', header: 'Monthly', sortable: true, align: 'right', accessor: (f) => f.monthlyPaymentKobo, cell: (f) => <MoneyText kobo={f.monthlyPaymentKobo} /> },
    { id: 'opened', header: 'Opened', sortable: true, accessor: (f) => f.openedAt, cell: (f) => <DateTime value={f.openedAt} style="date" /> },
    { id: 'closed', header: 'Closed', accessor: (f) => f.closedAt, cell: (f) => <DateTime value={f.closedAt} style="date" />, defaultHidden: true },
    { id: 'lastPayment', header: 'Last payment', accessor: (f) => f.lastPaymentAt, cell: (f) => <DateTime value={f.lastPaymentAt} style="date" /> },
    { id: 'dpd', header: 'Worst DPD', sortable: true, align: 'right', accessor: (f) => f.worstDpd, cell: (f) => <span className={`tabular ${f.worstDpd >= 90 ? 'font-semibold text-destructive' : ''}`}>{f.worstDpd}</span> },
    {
      id: 'sources', header: 'Sources', accessor: (f) => f.sources.map((s) => SOURCE_SHORT[s]).join('/'),
      cell: (f) => (
        <div className="flex items-center gap-1">
          {f.sources.map((s) => <Badge key={s} variant="outline" className="px-1.5 text-[10px]">{SOURCE_SHORT[s] ?? s}</Badge>)}
          {f.conflict && (
            <Tooltip content="Bureaus disagreed on this facility's status; the most severe is shown.">
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-warning" data-testid="conflict-marker"><GitCompareArrows className="size-3.5" aria-hidden />conflict</span>
            </Tooltip>
          )}
        </div>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={facilities}
      rowKey={(f) => f.id}
      rowClassName={(f) => (isRedFacility(f) ? RED_ROW_CLASS : undefined)}
      exportName="bureau-facilities"
      pageSize={25}
      emptyTitle="No facilities reported"
      emptyDescription="The bureaus returned no credit facilities for this customer."
      searchPlaceholder="Search lender…"
    />
  );
}
