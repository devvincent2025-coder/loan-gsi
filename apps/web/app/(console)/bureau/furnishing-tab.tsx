'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import type { BureauSubmissionDto, Page } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { BUREAU_LABEL } from '@/components/bureau/bureau-utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage, get, post } from '@/lib/api';
import { titleCase } from '@/lib/utils';

export function FurnishingTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const q = useQuery({ queryKey: ['bureau-submissions', page], queryFn: () => get<Page<BureauSubmissionDto>>('/bureau/submissions', { page, pageSize: 20 }), placeholderData: (p) => p });
  const run = useMutation({
    mutationFn: () => post<BureauSubmissionDto[]>('/bureau/furnishing/run', {}),
    onSuccess: (r) => {
      const rec = r.reduce((a, s) => a + s.recordCount, 0), rej = r.reduce((a, s) => a + s.rejectedCount, 0);
      toast.success(`Furnishing run complete: ${r.length} file(s), ${rec} record(s), ${rej} rejected`);
      void qc.invalidateQueries({ queryKey: ['bureau-submissions'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: DataColumn<BureauSubmissionDto>[] = [
    { id: 'when', header: 'Submitted', sortable: true, accessor: (s) => s.submittedAt, cell: (s) => <DateTime value={s.submittedAt} style="short" /> },
    { id: 'bureau', header: 'Bureau', accessor: (s) => s.bureau, cell: (s) => BUREAU_LABEL[s.bureau] ?? s.bureau },
    { id: 'period', header: 'Period', sortable: true, accessor: (s) => s.period, cell: (s) => <span className="tabular">{s.period}</span> },
    { id: 'file', header: 'File', accessor: (s) => s.fileName, cell: (s) => <span className="font-mono text-xs">{s.fileName}</span> },
    { id: 'format', header: 'Format', accessor: (s) => s.format, defaultHidden: true },
    { id: 'records', header: 'Records', align: 'right', accessor: (s) => s.recordCount, cell: (s) => <span className="tabular">{s.recordCount}</span> },
    { id: 'accepted', header: 'Accepted', align: 'right', accessor: (s) => s.acceptedCount, cell: (s) => <span className="tabular">{s.acceptedCount}</span> },
    { id: 'rejected', header: 'Rejected', align: 'right', accessor: (s) => s.rejectedCount, cell: (s) => <span className={`tabular ${s.rejectedCount ? 'font-semibold text-destructive' : ''}`}>{s.rejectedCount}</span> },
    { id: 'status', header: 'Status', accessor: (s) => s.status, cell: (s) => <Badge variant={s.status === 'SUBMITTED' ? 'success' : s.status === 'PARTIAL' ? 'warning' : 'destructive'}>{titleCase(s.status)}</Badge> },
  ];
  return (
    <DataTable
      mode="server" columns={columns} data={q.data?.items ?? []} rowKey={(s) => s.id} loading={q.isLoading} error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()}
      total={q.data?.total} page={page} pageSize={20} onPageChange={setPage} exportName="bureau-furnishing" searchPlaceholder="Filter this page…" emptyTitle="No submissions yet" emptyDescription="Monthly performance files sent to the bureaus appear here."
      renderExpanded={(s) => s.errors.length === 0 ? <p className="text-sm text-muted-foreground">No rejected records.</p> : (
        <div><p className="mb-2 text-sm font-medium">Rejected records ({s.errors.length})</p>
          <ul className="space-y-1 text-sm" data-testid="submission-errors">{s.errors.map((e, i) => <li key={i} className="flex gap-2"><span className="font-mono text-xs text-muted-foreground">{e.record}</span><span className="text-destructive">{e.message}</span></li>)}</ul></div>
      )}
      toolbar={canManage && <Button size="sm" loading={run.isPending} onClick={() => run.mutate()}><Send /> Run furnishing</Button>}
    />
  );
}
