'use client';
import * as React from 'react';
import { formatNaira } from '@damez/shared';
import { LineChartCard } from '@/components/charts/line-chart-card';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import type { PortfolioMetrics, BranchMetric } from '@/lib/executive-api';

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', timeZone: 'Africa/Lagos' });

const pctAxis = (v: number) => `${v.toFixed(1)}%`;
const nairaAxis = (v: number) => formatNaira(v, { compact: true });

export function PARTrendChart({ metrics, loading }: { metrics?: PortfolioMetrics; loading?: boolean }) {
  return (
    <LineChartCard
      title="PAR Trend"
      description="PAR30 / PAR90 / NPL over time"
      loading={loading}
      data={metrics?.series ?? []}
      xKey="date"
      xFormatter={shortDate}
      yFormatter={pctAxis}
      series={[
        { key: 'par30', label: 'PAR 30' },
        { key: 'par90', label: 'PAR 90' },
        { key: 'nplRatio', label: 'NPL Ratio' },
      ]}
    />
  );
}

export function BranchPARChart({ branches, loading }: { branches?: BranchMetric[]; loading?: boolean }) {
  const data = (branches ?? []).map((b) => ({
    branch: b.branchName,
    par30: b.par30,
    par90: b.par90,
  }));

  return (
    <BarChartCard
      title="Branch PAR Comparison"
      description="PAR30 & PAR90 by branch"
      loading={loading}
      data={data}
      xKey="branch"
      yFormatter={pctAxis}
      series={[
        { key: 'par30', label: 'PAR 30' },
        { key: 'par90', label: 'PAR 90' },
      ]}
    />
  );
}

export function CollectionEfficiencyChart({ metrics, loading }: { metrics?: PortfolioMetrics; loading?: boolean }) {
  return (
    <LineChartCard
      title="Collection Efficiency"
      description="% of scheduled repayments collected"
      loading={loading}
      data={metrics?.series ?? []}
      xKey="date"
      xFormatter={shortDate}
      yFormatter={pctAxis}
      series={[{ key: 'collectionEfficiency', label: 'Efficiency' }]}
    />
  );
}

export function DisbursementTargetChart({ metrics, loading }: { metrics?: PortfolioMetrics; loading?: boolean }) {
  const data = (metrics?.series ?? []).map((p) => ({
    date: p.date,
    disbursedKobo: p.disbursedKobo,
  }));

  return (
    <BarChartCard
      title="Disbursements"
      description="Daily disbursed amount (30d)"
      loading={loading}
      data={data}
      xKey="date"
      yFormatter={nairaAxis}
      series={[{ key: 'disbursedKobo', label: 'Disbursed' }]}
    />
  );
}
