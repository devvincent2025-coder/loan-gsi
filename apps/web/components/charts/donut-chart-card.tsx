'use client';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_COLORS, ChartShell, ChartTooltip, type ChartCardBase } from './chart-shell';

export interface DonutDatum { name: string; value: number }
export interface DonutChartCardProps extends ChartCardBase {
  data: DonutDatum[];
  valueFormatter?: (v: number) => string;
  centerLabel?: string;
}

export function DonutChartCard({ data, valueFormatter = (v) => String(v), centerLabel, ...shell }: DonutChartCardProps) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <ChartShell {...shell} empty={!shell.loading && data.length === 0}>
      <div className="flex h-full items-center gap-4">
        <div className="relative h-full min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                {data.map((d, i) => <Cell key={d.name} fill={CHART_COLORS[i % 6]} />)}
              </Pie>
              <Tooltip content={<ChartTooltip formatter={valueFormatter} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-sm font-semibold">{valueFormatter(total)}</span>
            {centerLabel && <span className="text-[10px] text-muted-foreground">{centerLabel}</span>}
          </div>
        </div>
        <ul className="w-2/5 space-y-1.5 text-xs">
          {data.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[i % 6] }} />
              <span className="truncate text-muted-foreground">{d.name}</span>
              <span className="tabular ml-auto font-medium">{total ? Math.round((d.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartShell>
  );
}
