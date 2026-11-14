'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { JournalEntryDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { MoneyText } from '@/components/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { FormField, Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { DateTime } from '@/components/date-time';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { getJournal, getLedgerAccounts, glExportUrl } from '@/lib/finance-api';
import { ManualPostingDialog } from './manual-posting-dialog';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function monthAgoIso() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export function LedgerTab() {
  const canPost = useCan('ledger:post');
  const [from, setFrom] = React.useState(monthAgoIso());
  const [to, setTo] = React.useState(todayIso());

  const accountsQ = useQuery({ queryKey: ['ledger', 'accounts'], queryFn: getLedgerAccounts });
  const journalQ = useQuery({ queryKey: ['ledger', 'journal', from, to], queryFn: () => getJournal({ from, to }) });

  const journalColumns: DataColumn<JournalEntryDto>[] = [
    { id: 'reference', header: 'Reference', sortable: true, accessor: (j) => j.reference, cell: (j) => <span className="font-mono text-xs">{j.reference}</span> },
    { id: 'date', header: 'Date', sortable: true, accessor: (j) => j.date, cell: (j) => <DateTime value={j.date} style="date" /> },
    { id: 'memo', header: 'Memo', accessor: (j) => j.memo },
    { id: 'sourceType', header: 'Source', sortable: true, accessor: (j) => j.sourceType, cell: (j) => <Badge variant="secondary">{j.sourceType}</Badge> },
    {
      id: 'total',
      header: 'Amount',
      align: 'right',
      accessor: (j) => j.postings.filter((p) => p.side === 'DEBIT').reduce((s, p) => s + p.amountKobo, 0),
      cell: (j) => <MoneyText kobo={j.postings.filter((p) => p.side === 'DEBIT').reduce((s, p) => s + p.amountKobo, 0)} />,
    },
  ];

  const exportHref = glExportUrl({ from, to, format: 'csv' });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Chart of accounts</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {accountsQ.isLoading && <Skeleton className="h-40" />}
          {accountsQ.isError && <ErrorState message={errorMessage(accountsQ.error)} onRetry={() => accountsQ.refetch()} />}
          {accountsQ.data && accountsQ.data.length === 0 && <EmptyState title="No accounts configured" />}
          {accountsQ.data && accountsQ.data.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Normal side</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {accountsQ.data.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                      <td className="px-3 py-2">{a.name}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{a.type}</Badge></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{a.normalSide}</td>
                      <td className="px-3 py-2 text-right"><MoneyText kobo={a.balanceKobo} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <FormField label="From" htmlFor="j-from" className="w-auto">
            <Input id="j-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To" htmlFor="j-to" className="w-auto">
            <Input id="j-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
          <Button asChild variant="outline" size="sm">
            <a href={exportHref} download><Download /> GL export</a>
          </Button>
          {canPost && accountsQ.data && <ManualPostingDialog accounts={accountsQ.data} />}
        </div>
        <DataTable
          columns={journalColumns}
          data={journalQ.data ?? []}
          rowKey={(j) => j.id}
          loading={journalQ.isLoading}
          error={journalQ.isError ? errorMessage(journalQ.error) : null}
          onRetry={() => journalQ.refetch()}
          exportName="journal"
          emptyTitle="No journal entries in this range"
          searchPlaceholder="Search journal…"
          renderExpanded={(j) => (
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full text-xs">
                <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {j.postings.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2">{p.accountCode} — {p.accountName}</td>
                      <td className="px-3 py-2">
                        <Badge variant={p.side === 'DEBIT' ? 'info' : 'secondary'}>{p.side}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right"><MoneyText kobo={p.amountKobo} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />
      </div>
    </div>
  );
}
