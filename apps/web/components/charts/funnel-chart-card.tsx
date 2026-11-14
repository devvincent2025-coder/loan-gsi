import { ChartShell, type ChartCardBase } from './chart-shell';

export interface FunnelDatum { stage: string; count: number }

export function FunnelChartCard({ data, ...shell }: ChartCardBase & { data: FunnelDatum[] }) {
  const top = data[0]?.count || 1;
  return (
    <ChartShell {...shell} height={shell.height ?? 260} empty={!shell.loading && data.length === 0}>
      <ol className="flex h-full flex-col justify-between gap-1.5">
        {data.map((d, i) => {
          const prev = i === 0 ? d.count : data[i - 1].count;
          const conv = prev ? (d.count / prev) * 100 : 0;
          return (
            <li key={d.stage} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{d.stage}</span>
              <div className="relative h-7 flex-1 rounded-md bg-muted">
                <div
                  className="h-full rounded-md bg-primary transition-all"
                  style={{ width: `${Math.max(2, (d.count / top) * 100)}%`, opacity: 1 - i * (0.5 / Math.max(1, data.length)) }}
                />
              </div>
              <span className="tabular w-14 text-right text-xs font-medium">{d.count.toLocaleString('en-NG')}</span>
              <span className="tabular w-12 text-right text-xs text-muted-foreground">{i === 0 ? '' : `${conv.toFixed(0)}%`}</span>
            </li>
          );
        })}
      </ol>
    </ChartShell>
  );
}
