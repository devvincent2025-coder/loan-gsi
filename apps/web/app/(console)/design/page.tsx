'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Inbox } from 'lucide-react';
import { formatNaira, type CustomerDto, type Page, type PiiRevealResponse } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { DataTable, type DataColumn } from '@/components/data-table';
import { AreaChartCard } from '@/components/charts/area-chart-card';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { LineChartCard } from '@/components/charts/line-chart-card';
import { DonutChartCard } from '@/components/charts/donut-chart-card';
import { FunnelChartCard } from '@/components/charts/funnel-chart-card';
import { HeatmapChart } from '@/components/charts/heatmap-chart';
import { CohortChart } from '@/components/charts/cohort-chart';
import { MaskedField } from '@/components/masked-field';
import { MoneyInput, MoneyText } from '@/components/money';
import { DateTime } from '@/components/date-time';
import { StatusBadge } from '@/components/status-badge';
import { OtpInput } from '@/components/otp-input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Logo } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { useCan } from '@/lib/auth';
import { errorMessage, get, post } from '@/lib/api';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div><h2 className="text-lg font-semibold">{title}</h2>{description && <p className="text-sm text-muted-foreground">{description}</p>}</div>
      {children}
    </section>
  );
}

const days = Array.from({ length: 14 }, (_, i) => ({ d: `D${i + 1}`, a: 40 + ((i * 7) % 23), b: 30 + ((i * 11) % 19) }));
interface Row { id: string; name: string; amountKobo: number; status: string }
const rows: Row[] = [
  { id: '1', name: 'Ada Okafor', amountKobo: 25_000_000, status: 'ACTIVE' },
  { id: '2', name: 'Bola Adeyemi', amountKobo: 120_050_000, status: 'LOCKED' },
  { id: '3', name: 'Chidi Eze', amountKobo: 5_500_000, status: 'DISABLED' },
];
const cols: DataColumn<Row>[] = [
  { id: 'name', header: 'Name', sortable: true, accessor: (r) => r.name },
  { id: 'amount', header: 'Amount', sortable: true, align: 'right', accessor: (r) => r.amountKobo, cell: (r) => <MoneyText kobo={r.amountKobo} /> },
  { id: 'status', header: 'Status', accessor: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
];

export default function DesignPage() {
  const canReveal = useCan('pii:reveal');
  const [kobo, setKobo] = React.useState<number | null>(150_000_00);
  const [otp, setOtp] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [sw, setSw] = React.useState(true);
  const customers = useQuery({ queryKey: ['customers', 'first'], queryFn: () => get<Page<CustomerDto>>('/customers', { pageSize: 1 }) });
  const c = customers.data?.items[0];

  return (
    <div className="space-y-10">
      <PageHeader title="Design system" description="Live examples of every reusable component." />

      <Section title="Brand & tokens"><Card className="flex flex-wrap items-center gap-6 p-5">
        <Logo />
        <div className="flex gap-1.5">{['primary', 'success', 'warning', 'info', 'destructive'].map((t) => <span key={t} title={t} className="size-8 rounded-md border" style={{ background: `hsl(var(--${t}))` }} />)}</div>
        <div className="flex gap-1.5">{[1, 2, 3, 4, 5, 6].map((n) => <span key={n} title={`chart-${n}`} className="size-8 rounded-md" style={{ background: `hsl(var(--chart-${n}))` }} />)}</div>
      </Card></Section>

      <Section title="Buttons & badges"><Card className="flex flex-wrap items-center gap-3 p-5">
        <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Destructive</Button><Button loading>Loading</Button><Button disabled>Disabled</Button>
        <Badge>Default</Badge><Badge variant="success">Success</Badge><Badge variant="warning">Warning</Badge><Badge variant="destructive">Destructive</Badge><Badge variant="info">Info</Badge>
        {['ACTIVE', 'LOCKED', 'PENDING', 'ESCALATED', 'EXECUTED', 'REJECTED', 'SUCCESS', 'DENIED'].map((s) => <StatusBadge key={s} status={s} />)}
      </Card></Section>

      <Section title="KpiCard"><div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Disbursed (MTD)" value={formatNaira(184_500_000_00, { compact: true })} delta={8.2} sparkline={[3, 4, 3, 6, 5, 8, 9]} />
        <KpiCard label="PAR 30" value="6.4%" delta={1.3} invertDelta sparkline={[5, 5, 6, 6, 7, 6, 7]} />
        <KpiCard loading label="" value="" />
      </div></Section>

      <Section title="Forms"><Card className="grid gap-4 p-5 sm:grid-cols-2">
        <FormField label="Text input" htmlFor="d-in" hint="Helper text"><Input id="d-in" placeholder="Type here" /></FormField>
        <FormField label="With error" htmlFor="d-err" error="This field is required"><Input id="d-err" aria-invalid /></FormField>
        <FormField label="Select" htmlFor="d-sel"><Select id="d-sel"><option>Lagos</option><option>Abuja</option></Select></FormField>
        <FormField label="MoneyInput" htmlFor="d-money" hint={`Stored as kobo: ${kobo ?? 'null'}`}><MoneyInput id="d-money" value={kobo} onChange={setKobo} /></FormField>
        <FormField label="Textarea" htmlFor="d-ta" className="sm:col-span-2"><Textarea id="d-ta" /></FormField>
        <label className="flex items-center gap-2 text-sm"><Switch checked={sw} onCheckedChange={setSw} /> Switch</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox defaultChecked /> Checkbox</label>
        <div className="sm:col-span-2"><p className="mb-2 text-sm font-medium">OtpInput</p><OtpInput value={otp} onChange={setOtp} /></div>
        <p className="text-sm">MoneyText: <MoneyText kobo={123_456_789} /> · DateTime: <DateTime value={new Date()} /></p>
      </Card></Section>

      <Section title="Overlays"><Card className="flex flex-wrap items-center gap-3 p-5">
        <Dialog><DialogTrigger asChild><Button variant="outline">Dialog</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Dialog</DialogTitle><DialogDescription>Accessible modal built on Radix.</DialogDescription></DialogHeader></DialogContent></Dialog>
        <Sheet><SheetTrigger asChild><Button variant="outline">Sheet</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>Sheet</SheetTitle><SheetDescription>Side drawer.</SheetDescription></SheetHeader></SheetContent></Sheet>
        <Button variant="outline" onClick={() => setConfirm(true)}>ConfirmDialog</Button>
        <Tooltip content="Helpful hint"><Button variant="outline">Tooltip</Button></Tooltip>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">Dropdown</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>One</DropdownMenuItem><DropdownMenuItem>Two</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <Button variant="outline" onClick={() => toast.success('Toast from sonner')}><Bell /> Toast</Button>
        <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Are you sure?" description="Confirm dialogs guard destructive actions." onConfirm={() => setConfirm(false)} />
      </Card></Section>

      <Section title="Tabs, skeleton, empty state"><div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5"><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">One</TabsTrigger><TabsTrigger value="b">Two</TabsTrigger></TabsList><TabsContent value="a">First panel</TabsContent><TabsContent value="b">Second panel</TabsContent></Tabs><div className="mt-4 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div></Card>
        <Card><EmptyState icon={Inbox} title="Nothing here yet" description="Empty states explain what to do next." action={<Button size="sm">Primary action</Button>} /></Card>
      </div></Section>

      <Section title="DataTable" description="Sort, filter, select, hide columns, saved views and CSV/Excel export."><DataTable columns={cols} data={rows} rowKey={(r) => r.id} selectable bulkActions={(sel) => <span>{sel.length} chosen</span>} exportName="demo" savedViewsKey="design-demo" /></Section>

      <Section title="MaskedField" description="Personal data stays masked. Revealing needs pii:reveal and a reason, is audited, and re-masks after 30s.">
        <Card className="space-y-3 p-5">
          {customers.isLoading && <Skeleton className="h-8 w-48" />}
          {customers.isError && <p className="text-sm text-muted-foreground">Could not load a customer: {errorMessage(customers.error)}</p>}
          {customers.data && !c && <p className="text-sm text-muted-foreground">No customers yet. Showing a static example.</p>}
          {c && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {(['bvn', 'phone'] as const).map((field) => (
                <div key={field}><dt className="mb-1 text-xs uppercase text-muted-foreground">{c.fullName} · {field}</dt>
                  <dd><MaskedField label={field} masked={c[field]} canReveal={canReveal} onReveal={async (reason) => (await post<PiiRevealResponse>('/pii/reveal', { resource: 'customer', id: c.id, field, reason })).value} /></dd></div>
              ))}
            </dl>
          )}
          {!c && <MaskedField label="BVN" masked="•••••••4821" canReveal={canReveal} onReveal={async () => '22212344821'} />}
        </Card>
      </Section>

      <Section title="Charts">
        <div className="grid gap-4 lg:grid-cols-2">
          <AreaChartCard title="AreaChartCard" data={days} xKey="d" series={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} height={200} />
          <LineChartCard title="LineChartCard" data={days} xKey="d" series={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} height={200} />
          <BarChartCard title="BarChartCard" data={days.slice(0, 6)} xKey="d" series={[{ key: 'a', label: 'A' }]} height={200} />
          <DonutChartCard title="DonutChartCard" data={[{ name: 'Salary', value: 60 }, { name: 'SME', value: 30 }, { name: 'Other', value: 10 }]} height={200} />
          <FunnelChartCard title="FunnelChartCard" data={[{ stage: 'Applied', count: 1000 }, { stage: 'Eligible', count: 700 }, { stage: 'Approved', count: 420 }, { stage: 'Disbursed', count: 390 }]} height={200} />
          <HeatmapChart title="HeatmapChart" height={200} data={{ rows: ['Mon', 'Tue', 'Wed'], cols: ['8', '12', '16', '20'], values: [[1, 5, 9, 3], [2, 6, 12, 4], [0, 7, 8, 2]] }} />
          <CohortChart className="lg:col-span-2" title="CohortChart" height={160} data={[{ label: 'Jan', size: 120, retention: [100, 97, 94, 91] }, { label: 'Feb', size: 140, retention: [100, 96, 92] }, { label: 'Mar', size: 160, retention: [100, 98] }]} />
        </div>
      </Section>
    </div>
  );
}
