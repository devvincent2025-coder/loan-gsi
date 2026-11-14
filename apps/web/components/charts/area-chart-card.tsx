'use client';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisProps, CHART_COLORS, ChartShell, ChartTooltip, gridStroke, type ChartCardBase, type SeriesDef } from './chart-shell';

export interface AreaChartCardProps<T extends object> extends ChartCardBase {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  yFormatter?: (v: number) => string;
  xFormatter?: (v: string) => string;
  stacked?: boolean;
}

export function AreaChartCard<T extends object>({ data, xKey, series, yFormatter, xFormatter, stacked, ...shell }: AreaChartCardProps<T>) {
  return (
    <ChartShell {...shell} empty={!shell.loading && data.length === 0}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`g-${shell.title.replace(/\W/g, '')}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color ?? CHART_COLORS[i % 6]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={s.color ?? CHART_COLORS[i % 6]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={24} />
          <YAxis {...axisProps} width={56} tickFormatter={yFormatter} />
          <Tooltip content={<ChartTooltip formatter={yFormatter} />} />
          {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? 'a' : undefined}
              stroke={s.color ?? CHART_COLORS[i % 6]}
              strokeWidth={2}
              fill={`url(#g-${shell.title.replace(/\W/g, '')}-${s.key})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
