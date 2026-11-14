import { ChartShell, type ChartCardBase } from './chart-shell';

export interface HeatmapData { rows: string[]; cols: string[]; values: number[][] }

/** Sequential colour: alpha-scaled primary over the card background. */
export function heatColor(v: number, min: number, max: number): string {
  const t = max === min ? 0 : (v - min) / (max - min);
  return `hsl(var(--primary) / ${(0.06 + t * 0.84).toFixed(2)})`;
}

export function HeatmapChart({ data, valueLabel = 'applications', ...shell }: ChartCardBase & { data: HeatmapData; valueLabel?: string }) {
  const flat = data.values.flat();
  const min = flat.length ? Math.min(...flat) : 0;
  const max = flat.length ? Math.max(...flat) : 0;
  return (
    <ChartShell {...shell} height={shell.height ?? 260} empty={!shell.loading && data.rows.length === 0}>
      <div className="h-full overflow-x-auto">
        <div className="grid min-w-[420px] gap-1" style={{ gridTemplateColumns: `3rem repeat(${data.cols.length}, minmax(0, 1fr))` }} role="table" aria-label="Heatmap">
          <div />
          {data.cols.map((c) => (
            <div key={c} className="text-center text-[10px] text-muted-foreground" role="columnheader">{c}</div>
          ))}
          {data.rows.map((r, ri) => (
            <div key={r} className="contents" role="row">
              <div className="flex items-center text-[11px] text-muted-foreground" role="rowheader">{r}</div>
              {data.cols.map((c, ci) => {
                const v = data.values[ri]?.[ci] ?? 0;
                return (
                  <div
                    key={c}
                    role="cell"
                    title={`${r} ${c}: ${v} ${valueLabel}`}
                    className="tabular flex h-7 items-center justify-center rounded text-[10px]"
                    style={{ background: heatColor(v, min, max), color: max !== min && (v - min) / (max - min) > 0.55 ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))' }}
                  >
                    {v}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </ChartShell>
  );
}
