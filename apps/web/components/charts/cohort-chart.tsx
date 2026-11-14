import { ChartShell, type ChartCardBase } from './chart-shell';
import { heatColor } from './heatmap-chart';

export interface CohortDatum { label: string; size: number; retention: number[] }

export function CohortChart({ data, ...shell }: ChartCardBase & { data: CohortDatum[] }) {
  const maxCols = Math.max(0, ...data.map((d) => d.retention.length));
  return (
    <ChartShell {...shell} height={shell.height ?? 300} empty={!shell.loading && data.length === 0}>
      <div className="h-full overflow-auto">
        <table className="w-full min-w-[480px] border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-2 text-left font-medium">Cohort</th>
              <th className="px-2 text-right font-medium">Loans</th>
              {Array.from({ length: maxCols }, (_, i) => <th key={i} className="px-1 font-medium">M{i}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row" className="whitespace-nowrap px-2 text-left font-medium">{d.label}</th>
                <td className="tabular px-2 text-right text-muted-foreground">{d.size.toLocaleString('en-NG')}</td>
                {Array.from({ length: maxCols }, (_, i) => {
                  const v = d.retention[i];
                  if (v === undefined) return <td key={i} />;
                  return (
                    <td
                      key={i}
                      className="tabular rounded px-1 py-1 text-center"
                      title={`${d.label}, month ${i}: ${v.toFixed(1)}% performing`}
                      style={{ background: heatColor(v, 60, 100), color: v > 92 ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))' }}
                    >
                      {v.toFixed(0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartShell>
  );
}
