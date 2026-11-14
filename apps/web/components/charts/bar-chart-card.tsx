'use client';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, CHART_COLORS, ChartShell, ChartTooltip, gridStroke, type ChartCardBase, type SeriesDef } from './chart-shell';

export interface BarChartCardProps<T extends object> extends ChartCardBase {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  /** 'vertical' draws horizontal bars (category on Y axis) */
  layout?: 'horizontal' | 'vertical';
  yFormatter?: (v: number) => string;
}

export function BarChartCard<T extends object>({ data, xKey, series, layout = 'horizontal', yFormatter, ...shell }: BarChartCardProps<T>) {
  const vertical = layout === 'vertical';
  return (
    <ChartShell {...shell} empty={!shell.loading && data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={layout} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" horizontal={!vertical} vertical={vertical} />
          {vertical ? (
            <>
              <XAxis type="number" {...axisProps} tickFormatter={yFormatter} />
              <YAxis type="category" dataKey={xKey} {...axisProps} width={80} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} {...axisProps} />
              <YAxis {...axisProps} width={44} tickFormatter={yFormatter} />
            </>
          )}
          <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<ChartTooltip formatter={yFormatter} />} />
          {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? CHART_COLORS[i % 6]} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
