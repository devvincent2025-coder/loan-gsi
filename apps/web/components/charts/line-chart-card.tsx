'use client';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, CHART_COLORS, ChartShell, ChartTooltip, gridStroke, type ChartCardBase, type SeriesDef } from './chart-shell';

export interface LineChartCardProps<T extends object> extends ChartCardBase {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  yFormatter?: (v: number) => string;
  xFormatter?: (v: string) => string;
}

export function LineChartCard<T extends object>({ data, xKey, series, yFormatter, xFormatter, ...shell }: LineChartCardProps<T>) {
  return (
    <ChartShell {...shell} empty={!shell.loading && data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={24} />
          <YAxis {...axisProps} width={44} tickFormatter={yFormatter} />
          <Tooltip content={<ChartTooltip formatter={yFormatter} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? CHART_COLORS[i % 6]} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
