'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, FileText, Trash2, UploadCloud } from 'lucide-react';
import { ALLOWED_UPLOAD_MIME, DOCUMENT_KIND_LABELS, MAX_UPLOAD_BYTES, type DocumentDto, type DocumentKind } from '@damez/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { pDel, portalErrorMessage, portalUpload } from '@/lib/portal-api';
import { cn } from '@/lib/utils';
import { KEYS } from './hooks';

export function validateUpload(file: { type: string; size: number; name?: string }): string | null {
  const okType = (ALLOWED_UPLOAD_MIME as readonly string[]).includes(file.type);
  if (!okType) return 'Please upload a JPEG or PNG photo, a PDF or a CSV file.';
  if (file.size > MAX_UPLOAD_BYTES) return `That file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  if (file.size === 0) return 'That file looks empty.';
  return null;
}

const HELP: Partial<Record<DocumentKind, string>> & { OTHER: string } = {
  ID_CARD: 'A clear photo of your national ID, driver licence, voter card or passport. We encrypt it and scan it for viruses.',
  PROOF_OF_ADDRESS: 'A recent (last 3 months) utility bill or tenancy agreement, as a PDF or photo. We encrypt it and scan it for viruses.',
  PAYSLIP: 'Your latest payslip as a PDF or photo. We encrypt it and scan it for viruses.',
  BANK_STATEMENT: 'A recent PDF statement covering 6 months. We encrypt it and scan it for viruses.',
  OTHER: 'A recent PDF or photo. We encrypt it and scan it for viruses.',
};

const SCAN: Record<DocumentDto['scanStatus'], { label: string; v: 'secondary' | 'success' | 'destructive' | 'warning' }> = {
  PENDING: { label: 'Scanning', v: 'secondary' },
  CLEAN: { label: 'Virus-free', v: 'success' },
  INFECTED: { label: 'Virus found', v: 'destructive' },
  ERROR: { label: 'Scan error', v: 'warning' },
};
const REVIEW: Record<DocumentDto['reviewStatus'], { label: string; v: 'secondary' | 'success' | 'destructive' }> = {
  PENDING: { label: 'Awaiting review', v: 'secondary' },
  APPROVED: { label: 'Approved', v: 'success' },
  REJECTED: { label: 'Rejected', v: 'destructive' },
};

export function DocumentRow({ doc, onDelete, deleting }: { doc: DocumentDto; onDelete?: () => void; deleting?: boolean }) {
  const scan = SCAN[doc.scanStatus];
  const review = REVIEW[doc.reviewStatus];
  return (
    <li className="rounded-md border bg-background p-3" data-doc={doc.id}>
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{doc.fileName}</p>
          <p className="text-xs text-muted-foreground">{(doc.sizeBytes / 1024).toFixed(0)} KB</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant={scan.v}>{scan.label}</Badge>
            <Badge variant={review.v}>{review.label}</Badge>
          </div>
          {doc.reviewNote && <p className="mt-1.5 text-xs text-muted-foreground">Note from our team: {doc.reviewNote}</p>}
          {doc.reviewStatus === 'REJECTED' && <p className="mt-1 text-xs font-medium text-destructive">Please upload a clearer or newer copy.</p>}
        </div>
        {doc.reviewStatus === 'PENDING' && onDelete && (
          <Button variant="ghost" size="icon" aria-label={`Delete ${doc.fileName}`} loading={deleting} onClick={onDelete}><Trash2 /></Button>
        )}
      </div>
    </li>
  );
}

export interface DocumentUploadCardProps {
  kind: DocumentKind;
  docs: DocumentDto[];
  applicationId?: string;
  required?: boolean;
  className?: string;
  onUploaded?: (d: DocumentDto) => void;
}

export function DocumentUploadCard({ kind, docs, applicationId, required, className, onUploaded }: DocumentUploadCardProps) {
  const qc = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const camRef = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState(false);
  const mine = docs.filter((d) => d.kind === kind);
  const satisfied = mine.some((d) => d.reviewStatus !== 'REJECTED' && d.scanStatus !== 'INFECTED');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEYS.documents });
    void qc.invalidateQueries({ queryKey: KEYS.onboarding });
    void qc.invalidateQueries({ queryKey: KEYS.applications });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('kind', kind);
      if (applicationId) form.append('applicationId', applicationId);
      form.append('file', file);
      return portalUpload<DocumentDto>('/documents', form, setProgress);
    },
    onSuccess: (d) => { setProgress(null); refresh(); onUploaded?.(d); },
    onError: (e) => { setProgress(null); setError(portalErrorMessage(e)); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => pDel(`/documents/${id}`),
    onSuccess: refresh,
    onError: (e) => setError(portalErrorMessage(e)),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = validateUpload(file);
    setError(problem);
    if (!problem) { setProgress(0); upload.mutate(file); }
  };
  const busy = upload.isPending;

  return (
    <Card className={className} data-testid={`doc-card-${kind}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">{DOCUMENT_KIND_LABELS[kind]}{required === false && <span className="text-xs font-normal text-muted-foreground">Optional</span>}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{HELP[kind]}</p>
          </div>
          {satisfied && <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Uploaded" />}
        </div>
        {mine.length > 0 && (
          <ul className="space-y-2">
            {mine.map((d) => <DocumentRow key={d.id} doc={d} deleting={remove.isPending && remove.variables === d.id} onDelete={() => remove.mutate(d.id)} />)}
          </ul>
        )}
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={cn('rounded-lg border-2 border-dashed p-4 text-center transition-colors', drag ? 'border-primary bg-primary/5' : 'border-input')}
        >
          <UploadCloud className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-1 text-xs text-muted-foreground">Drag a file here, or</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>Choose file</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} className="md:hidden" onClick={() => camRef.current?.click()}><Camera /> Take photo</Button>
          </div>
          <input ref={fileRef} type="file" hidden accept={ALLOWED_UPLOAD_MIME.join(',')} aria-label={`Choose ${DOCUMENT_KIND_LABELS[kind]} file`} data-testid={`file-${kind}`} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={camRef} type="file" hidden accept="image/*" capture="environment" aria-label={`Take photo of ${DOCUMENT_KIND_LABELS[kind]}`} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <p className="mt-2 text-[11px] text-muted-foreground">JPEG, PNG, PDF or CSV, up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB</p>
        </div>
        {progress !== null && (
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Upload progress" className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
