'use client';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { ShieldAlert } from 'lucide-react';
import { useCan } from '@/lib/auth';
import { CashPositionTab } from '@/components/finance/cash-position-tab';
import { ReconciliationTab } from '@/components/finance/reconciliation-tab';
import { LedgerTab } from '@/components/finance/ledger-tab';
import { Ifrs9Tab } from '@/components/finance/ifrs9-tab';
import { AutodebitTab } from '@/components/autodebit/autodebit-tab';

const TABS = [
  { value: 'cash-position', label: 'Cash Position', permission: 'treasury:read' },
  { value: 'reconciliation', label: 'Reconciliation', permission: 'reconciliation:read' },
  { value: 'ledger', label: 'Ledger', permission: 'ledger:read' },
  { value: 'ifrs9', label: 'IFRS9 / ECL', permission: 'report:read' },
  { value: 'autodebit', label: 'Autodebit', permission: 'autodebit:read' },
] as const;

function NoAccess() {
  return <EmptyState icon={ShieldAlert} title="You don't have access to this section" description="Ask an administrator for the required permission." />;
}

export default function TreasuryPage() {
  const canCash = useCan('treasury:read');
  const canRecon = useCan('reconciliation:read');
  const canLedger = useCan('ledger:read');
  const canReport = useCan('report:read');
  const canAutodebit = useCan('autodebit:read');
  const access: Record<(typeof TABS)[number]['value'], boolean> = {
    'cash-position': canCash,
    reconciliation: canRecon,
    ledger: canLedger,
    ifrs9: canReport,
    autodebit: canAutodebit,
  };
  const firstAvailable = TABS.find((t) => access[t.value])?.value ?? TABS[0].value;

  return (
    <>
      <PageHeader title="Accounting & Treasury" description="Cash position, reconciliation, ledger and IFRS 9 provisioning." />
      <Tabs defaultValue={firstAvailable}>
        <TabsList>
          {TABS.map((t) => <TabsTrigger key={t.value} value={t.value} disabled={!access[t.value]}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="cash-position">{access['cash-position'] ? <CashPositionTab /> : <NoAccess />}</TabsContent>
        <TabsContent value="reconciliation">{access.reconciliation ? <ReconciliationTab /> : <NoAccess />}</TabsContent>
        <TabsContent value="ledger">{access.ledger ? <LedgerTab /> : <NoAccess />}</TabsContent>
        <TabsContent value="ifrs9">{access.ifrs9 ? <Ifrs9Tab /> : <NoAccess />}</TabsContent>
        <TabsContent value="autodebit">{access.autodebit ? <AutodebitTab /> : <NoAccess />}</TabsContent>
      </Tabs>
    </>
  );
}
