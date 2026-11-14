'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { DOCUMENT_KIND_LABELS, type StaffDocumentDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/form';
import { Tooltip } from '@/components/ui/tooltip';
import { useCan } from '@/lib/auth';
import { errorMessage, post } from '@/lib/api';
import { documentDownloadUrl } from '@/lib/staff-api-extra';
import { formatBytes } from './customer-ui';

function ReviewDialog({ doc, onClose, onDone }: { doc: StaffDocumentDto | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { setNote(''); setErr(null); }, [doc?.id]);
  const m = useMutation({
    mutationFn: (status: 'APPROVED' | 'REJECTED') => post(`/documents/${doc!.id}/review`, { status, note: note.trim() || undefined }),
    onSuccess: (_d, status) => { toast.success(`Document ${status === 'APPROVED' ? 'approved' : 'rejected'}`); onDone(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Review document</DialogTitle>
          <DialogDescription>{doc ? `${DOCUMENT_KIND_LABELS[doc.kind]} · ${doc.fileName}` : ''}</DialogDescription>
        </DialogHeader>
        <FormField label="Note" htmlFor="doc-note" hint="Shown to the customer when rejected. Required for rejections." error={err ?? undefined}>
          <Textarea id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Image is blurry, please re-upload" />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button variant="destructive" loading={m.isPending && m.variables === 'REJECTED'} onClick={() => { if (note.trim().length < 3) return setErr('Add a short reason for rejecting.'); setErr(null); m.mutate('REJECTED'); }}>Reject</Button>
          <Button loading={m.isPending && m.variables === 'APPROVED'} onClick={() => m.mutate('APPROVED')}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsTable({ documents, onChanged, loading, exportName = 'documents' }: { documents: StaffDocumentDto[]; onChanged: () => void; loading?: boolean; exportName?: string }) {
  const canRead = useCan('document:read');
  const canReview = useCan('document:review');
  const [reviewing, setReviewing] = React.useState<StaffDocumentDto | null>(null);
  const columns: DataColumn<StaffDocumentDto>[] = [
    { id: 'kind', header: 'Kind', sortable: true, accessor: (d) => DOCUMENT_KIND_LABELS[d.kind], cell: (d) => <span className="font-medium">{DOCUMENT_KIND_LABELS[d.kind]}</span> },
    { id: 'file', header: 'File', accessor: (d) => d.fileName, cell: (d) => <span className="block max-w-48 truncate" title={d.fileName}>{d.fileName}</span> },
    { id: 'size', header: 'Size', align: 'right', accessor: (d) => d.sizeBytes, cell: (d) => <span className="tabular">{formatBytes(d.sizeBytes)}</span> },
    { id: 'scan', header: 'Scan', accessor: (d) => d.scanStatus, cell: (d) => <Badge variant={d.scanStatus === 'CLEAN' ? 'success' : d.scanStatus === 'PENDING' ? 'secondary' : 'destructive'}>{d.scanStatus === 'INFECTED' ? 'Infected' : d.scanStatus.charAt(0) + d.scanStatus.slice(1).toLowerCase()}</Badge> },
    { id: 'review', header: 'Review', accessor: (d) => d.reviewStatus, cell: (d) => (<div><StatusBadge status={d.reviewStatus === 'APPROVED' ? 'VERIFIED' : d.reviewStatus} label={d.reviewStatus.charAt(0) + d.reviewStatus.slice(1).toLowerCase()} />{d.reviewNote && <p className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground" title={d.reviewNote}>{d.reviewNote}</p>}</div>) },
    { id: 'uploaded', header: 'Uploaded', sortable: true, accessor: (d) => d.uploadedAt, cell: (d) => <DateTime value={d.uploadedAt} style="short" /> },
    {
      id: 'actions', header: '', noExport: true,
      cell: (d) => (
        <div className="flex items-center gap-1.5">
          <Tooltip content="Downloads are audited" disabled={!canRead}>
            <Button asChild={canRead} size="sm" variant="outline" disabled={!canRead || d.scanStatus === 'INFECTED'}>
              {canRead ? <a href={documentDownloadUrl(d.id)} target="_blank" rel="noreferrer" aria-label={`Download ${d.fileName}`}><Download /> Download</a> : <span><Download /> Download</span>}
            </Button>
          </Tooltip>
          {canReview && d.reviewStatus === 'PENDING' && <Button size="sm" onClick={() => setReviewing(d)}>Review</Button>}
        </div>
      ),
    },
  ];
  return (
    <>
      <DataTable columns={columns} data={documents} rowKey={(d) => d.id} loading={loading} exportName={exportName} pageSize={10} emptyTitle="No documents uploaded" emptyDescription="Customer uploads appear here after the virus scan." searchPlaceholder="Search documents…" />
      <ReviewDialog doc={reviewing} onClose={() => setReviewing(null)} onDone={onChanged} />
    </>
  );
}
