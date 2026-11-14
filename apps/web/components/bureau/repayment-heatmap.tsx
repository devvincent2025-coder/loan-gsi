'use client';
import * as React from 'react';
import type { BureauFacilityDto } from '@damez/shared';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DPD_LEGEND, dpdStyle } from './bureau-utils';

/** Union of all months across facilities, oldest to newest, capped to the most recent 36. */
export function heatmapMonths(facilities: Pick<BureauFacilityDto, 'history'>[]): string[] {
  const set = new Set<string>();
  for (const f of facilities) for (const h of f.history) set.add(h.month);
  return [...set].sort().slice(-36);
}
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  const name = new Date(Date.UTC(Number(y), Number(mo) - 1, 1)).toLocaleString('en-NG', { month: 'short', timeZone: 'UTC' });
  return `${name} ${y?.slice(2)}`;
};

export function RepaymentHeatmap({ facilities }: { facilities: BureauFacilityDto[] }) {
  const months = heatmapMonths(facilities);
  const rows = facilities.filter((f) => f.history.length > 0);
  if (months.length === 0 || rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No repayment history reported.</p>;
  }
  return (
    <div>
      <div className="overflow-x-auto pb-2" data-testid="repayment-heatmap">
        <table className="border-separate border-spacing-[3px] text-[10px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card pr-2 text-left font-medium text-muted-foreground">Facility</th>
              {months.map((m, i) => (
                <th key={m} scope="col" className="w-5 min-w-5 text-center font-normal text-muted-foreground">
                  {i % 3 === 0 ? <span className="inline-block origin-bottom-left -rotate-45 whitespace-nowrap">{monthLabel(m)}</span> : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const byMonth = new Map(f.history.map((h) => [h.month, h.dpd]));
              return (
                <tr key={f.id}>
                  <th scope="row" className="sticky left-0 z-10 max-w-40 truncate bg-card pr-2 text-left text-xs font-medium" title={`${f.lender} · ${f.productType}`}>
                    {f.lender}
                  </th>
                  {months.map((m) => {
                    const dpd = byMonth.get(m);
                    const st = dpdStyle(dpd);
                    return (
                      <td key={m} className="p-0">
                        <Tooltip content={`${monthLabel(m)} · ${f.lender}: ${dpd === undefined ? 'no data' : `${dpd} DPD`}`}>
                          <div data-testid="heat-cell" data-bucket={st.bucket} aria-label={`${f.lender} ${m}: ${dpd === undefined ? 'no data' : `${dpd} days past due`}`} className={cn('size-5 rounded-sm', st.className)} />
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {DPD_LEGEND.map((l) => (
          <li key={l.bucket} className="flex items-center gap-1.5"><span className={cn('size-3 rounded-sm', l.className)} />{l.label}</li>
        ))}
      </ul>
    </div>
  );
}
