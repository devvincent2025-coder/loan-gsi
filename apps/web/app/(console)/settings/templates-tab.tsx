'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';
import { templateUpdateSchema, type TemplateDto } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/lib/auth';
import { errorMessage, get, post, put } from '@/lib/api';

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}
const sampleVars = (names: string[]) => Object.fromEntries(names.map((n) => [n, `[${n}]`]));

export function TemplatesTab() {
  const canEdit = useCan('template:update');
  const q = useQuery({ queryKey: ['templates'], queryFn: () => get<TemplateDto[]>('/notifications/templates') });
  const [editing, setEditing] = React.useState<TemplateDto | null>(null);
  const columns: DataColumn<TemplateDto>[] = [
    { id: 'name', header: 'Template', sortable: true, accessor: (t) => t.name, cell: (t) => <div><p className="font-medium">{t.name}</p><p className="font-mono text-xs text-muted-foreground">{t.key}</p></div> },
    { id: 'channel', header: 'Channel', sortable: true, accessor: (t) => t.channel, cell: (t) => <Badge variant="secondary">{t.channel}</Badge> },
    { id: 'vars', header: 'Variables', accessor: (t) => t.variables.join(' '), cell: (t) => <div className="flex flex-wrap gap-1">{t.variables.map((v) => <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{v}</code>)}</div> },
    { id: 'active', header: 'Status', accessor: (t) => (t.isActive ? 'Active' : 'Inactive'), cell: (t) => <StatusBadge status={t.isActive ? 'ACTIVE' : 'DISABLED'} label={t.isActive ? 'Active' : 'Inactive'} /> },
    { id: 'actions', header: '', noExport: true, cell: (t) => <Button variant="ghost" size="sm" onClick={() => setEditing(t)}><Pencil /> {canEdit ? 'Edit' : 'View'}</Button> },
  ];
  return (
    <>
      <DataTable columns={columns} data={q.data ?? []} rowKey={(t) => t.id} loading={q.isLoading} error={q.isError ? errorMessage(q.error) : null} onRetry={() => q.refetch()} exportName="templates" emptyTitle="No templates" searchPlaceholder="Search templates…" />
      <TemplateDialog template={editing} canEdit={canEdit} onClose={() => setEditing(null)} />
    </>
  );
}

function TemplateDialog({ template, canEdit, onClose }: { template: TemplateDto | null; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const canSend = useCan('notification:send');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [active, setActive] = React.useState(true);
  const [to, setTo] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (template) { setSubject(template.subject ?? ''); setBody(template.body); setActive(template.isActive); setError(null); setTo(''); }
  }, [template]);

  const save = useMutation({
    mutationFn: () => put(`/notifications/templates/${template!.id}`, { subject: subject || null, body, isActive: active }),
    onSuccess: () => { toast.success('Template saved'); void qc.invalidateQueries({ queryKey: ['templates'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => post('/notifications/test', { channel: template!.channel, to, templateKey: template!.key, variables: sampleVars(template!.variables) }),
    onSuccess: () => toast.success('Test notification queued'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const insert = (v: string) => {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) return setBody((b) => b + token);
    const s = el.selectionStart, e = el.selectionEnd;
    setBody(body.slice(0, s) + token + body.slice(e));
  };
  const submit = () => {
    const r = templateUpdateSchema.safeParse({ subject: subject || null, body, isActive: active });
    if (!r.success) return setError(r.error.issues[0]?.message ?? 'Invalid');
    setError(null);
    save.mutate();
  };
  const preview = template ? renderTemplate(body, sampleVars(template.variables)) : '';

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader><DialogTitle>{template?.name}</DialogTitle><DialogDescription>{template?.channel} template <code>{template?.key}</code></DialogDescription></DialogHeader>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            {template?.channel === 'EMAIL' && <FormField label="Subject" htmlFor="t-subj"><Input id="t-subj" value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} /></FormField>}
            <FormField label="Body" htmlFor="t-body" error={error ?? undefined}><Textarea id="t-body" ref={bodyRef} className="min-h-40 font-mono text-xs" value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} /></FormField>
            <div><p className="mb-1 text-xs text-muted-foreground">Variables{canEdit && ' (click to insert)'}</p>
              <div className="flex flex-wrap gap-1">{template?.variables.map((v) => <button key={v} type="button" disabled={!canEdit} onClick={() => insert(v)} className="rounded-full border bg-muted px-2 py-0.5 font-mono text-[11px] hover:bg-accent disabled:opacity-60">{`{{${v}}}`}</button>)}</div>
            </div>
            <div className="flex items-center gap-2"><Switch id="t-act" checked={active} disabled={!canEdit} onCheckedChange={setActive} /><label htmlFor="t-act" className="text-sm">Active</label></div>
          </div>
          <div className="space-y-3">
            <div><p className="mb-1 text-xs font-medium text-muted-foreground">Preview (sample values)</p><div className="min-h-24 whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{preview}</div></div>
            {canSend && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Send a test</p>
                <Input aria-label="Test recipient" placeholder={template?.channel === 'EMAIL' ? 'you@example.com' : '08012345678'} value={to} onChange={(e) => setTo(e.target.value)} />
                <Button size="sm" variant="outline" disabled={to.length < 3} loading={test.isPending} onClick={() => test.mutate()}>Send test</Button>
              </div>
            )}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button>{canEdit && <Button loading={save.isPending} onClick={submit}>Save template</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
