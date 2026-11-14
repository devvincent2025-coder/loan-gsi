'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldOff } from 'lucide-react';
import { formatNaira, type BureauUsageDto, type SettingDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { AreaChartCard } from '@/components/charts/area-chart-card';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { DonutChartCard } from '@/components/charts/donut-chart-card';
import { KpiCard } from '@/components/kpi-card';
import { MoneyText } from '@/components/money';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BUREAU_LABEL } from '@/components/bureau/bureau-utils';
import { useCan } from '@/lib/auth';
import { errorMessage, get } from '@/lib/api';
import { titleCase } from '@/lib/utils';
import { PullLogTab } from './pull-log-tab';
import { FurnishingTab } from './furnishing-tab';
import { MonitoringTab } from './monitoring-tab';
import { DistributionTab } from './distribution-tab';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PRESETS = [{ label: '7 days', days: 7 }, { label: '30 days', days: 30 }, { label: '90 days', days: 90 }];
const naira = (kobo: number) => formatNaira(kobo, { compact: true });

export default function BureauPage() {
  const canUsage = useCan('bureau:usage');
  const canManage = useCan('bureau:manage');
  const canSettings = useCan('settings:read');
  const [from, setFrom] = React.useState(daysAgo(30));
  const [to, setTo] = React.useState(iso(new Date()));
  const usage = useQuery({ queryKey: ['bureau-usage', from, to], queryFn: () => get<BureauUsageDto>('/bureau/usage', { from, to }), enabled: canUsage, placeholderData: (p) => p });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<{ settings: SettingDto[] }>('/settings'), enabled: canSettings, retry: false });
  const budgetRaw = settings.data?.settings.find((s) => s.key === 'bureau.monthly_budget_kobo')?.value;
  const budget = typeof budgetRaw === 'number' ? budgetRaw : typeof budgetRaw === 'string' && /^\d+$/.test(budgetRaw) ? Number(budgetRaw) : null;

  if (!canUsage) return <EmptyState icon={ShieldOff} title="Not available" description="You need the bureau:usage permission to view credit bureau usage and spend." />;
  const u = usage.data;
  const loading = usage.isLoading;
  const hitRate = u && u.totalPulls > 0 ? (u.cacheHits / u.totalPulls) * 100 : 0;
  // contract: plain percent; tolerate a 0-1 fraction if every bureau reports <= 1
  const rateScale = (u?.byBureau ?? []).length > 0 && (u?.byBureau ?? []).every((b) => b.successRate <= 1) ? 100 : 1;
  const budgetPct = u && budget ? (u.totalCostKobo / budget) * 100 : null;

  return (
    <>
      <PageHeader
        title="Credit bureau"
        description="Access customers credit report, monitor their score."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex gap-1" role="group" aria-label="Date presets">
              {PRESETS.map((p) => <Button key={p.days} size="sm" variant={from === daysAgo(p.days) && to === iso(new Date()) ? 'default' : 'outline'} onClick={() => { setFrom(daysAgo(p.days)); setTo(iso(new Date())); }}>{p.label}</Button>)}
            </div>
            <div><Label htmlFor="bu-from" className="sr-only">From</Label><Input id="bu-from" type="date" className="w-36" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
            <div><Label htmlFor="bu-to" className="sr-only">To</Label><Input id="bu-to" type="date" className="w-36" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
          </div>
        }
      />
      {usage.isError && !u ? (
        <Card><ErrorState message={errorMessage(usage.error)} onRetry={() => usage.refetch()} /></Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="bureau-usage-kpis">
            <KpiCard loading={loading} label="Total pulls" value={u?.totalPulls ?? 0} />
            <KpiCard loading={loading} label="Billable pulls" value={u?.billablePulls ?? 0} />
            <KpiCard loading={loading} label="Cache hit rate" value={`${hitRate.toFixed(1)}%`} />
            <KpiCard loading={loading} label="Failed" value={u?.failed ?? 0} />
            <KpiCard loading={loading} label="Blocked (no consent)" value={u?.blockedNoConsent ?? 0} />
            <KpiCard loading={loading} label="Total spend" value={<MoneyText kobo={u?.totalCostKobo ?? 0} />} />
            <KpiCard loading={loading} label="Avg cost / billable pull" value={<MoneyText kobo={u?.avgCostPerBillablePullKobo ?? 0} />} />
            {budget !== null ? (
              <KpiCard loading={loading} label="Spend vs monthly budget" value={<span className={budgetPct !== null && budgetPct > 100 ? 'text-destructive' : ''}>{budgetPct?.toFixed(0)}%</span>} />
            ) : (
              <KpiCard loading={loading} label="Monthly budget" value={<span className="text-sm font-normal text-muted-foreground">{canSettings ? 'Not set' : 'Hidden'}</span>} />
            )}
          </div>
          {/* {budget !== null && budgetPct !== null && (
            <p className="text-xs text-muted-foreground">Budget: <MoneyText kobo={budget} /> per month. Percentage compares the selected range&apos;s spend to one month&apos;s budget.</p>
          )} */}
          <div className="grid gap-5 lg:grid-cols-2">
            <AreaChartCard title="Daily spend" description="Naira spent on billable pulls" loading={loading} data={(u?.daily ?? []).map((d) => ({ date: d.date.slice(5), spend: d.costKobo }))} xKey="date" series={[{ key: 'spend', label: 'Spend' }]} yFormatter={naira} height={240} />
            <BarChartCard title="Daily pulls" description="All pulls including cache hits" loading={loading} data={(u?.daily ?? []).map((d) => ({ date: d.date.slice(5), pulls: d.pulls }))} xKey="date" series={[{ key: 'pulls', label: 'Pulls' }]} height={240} />
            <DonutChartCard title="Spend by bureau" loading={loading} data={(u?.byBureau ?? []).filter((b) => b.costKobo > 0).map((b) => ({ name: BUREAU_LABEL[b.bureau] ?? b.bureau, value: b.costKobo }))} valueFormatter={naira} centerLabel="total" height={240} />
            <BarChartCard title="Pulls by reason" loading={loading} layout="vertical" data={(u?.byReason ?? []).map((r) => ({ reason: titleCase(r.reason), pulls: r.pulls }))} xKey="reason" series={[{ key: 'pulls', label: 'Pulls' }]} height={240} />
            <BarChartCard className="lg:col-span-2" title="Success rate per bureau" description="Share of calls that returned a response" loading={loading} data={(u?.byBureau ?? []).map((b) => ({ bureau: BUREAU_LABEL[b.bureau] ?? b.bureau, rate: Number((b.successRate * rateScale).toFixed(1)) }))} xKey="bureau" series={[{ key: 'rate', label: 'Success %' }]} yFormatter={(v) => `${v}%`} height={220} />
          </div>
        </div>
      )}

      <Tabs defaultValue="pulls" className="mt-6">
        <TabsList>
          <TabsTrigger value="pulls">Pull log</TabsTrigger>
          <TabsTrigger value="furnishing">Furnishing</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
        </TabsList>
        <TabsContent value="pulls"><PullLogTab defaultFrom={from} defaultTo={to} /></TabsContent>
        <TabsContent value="furnishing"><FurnishingTab canManage={canManage} /></TabsContent>
        <TabsContent value="monitoring"><MonitoringTab canManage={canManage} /></TabsContent>
        <TabsContent value="distribution"><DistributionTab /></TabsContent>
      </Tabs>
    </>
  );
}
