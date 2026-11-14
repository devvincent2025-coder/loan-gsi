'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import type { UnderwritingNoteDto } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { DateTime } from '@/components/date-time';
import { SectionCard } from '@/components/staff/ui-bits';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { addApplicationNote, getApplicationNotes } from '@/lib/underwriting-api';

const KIND_VARIANT: Record<UnderwritingNoteDto['kind'], NonNullable<BadgeProps['variant']>> = {
  NOTE: 'secondary',
  DECISION: 'success',
  REQUEST_INFO: 'warning',
};
const KIND_LABEL: Record<UnderwritingNoteDto['kind'], string> = {
  NOTE: 'Note',
  DECISION: 'Decision',
  REQUEST_INFO: 'Request info',
};

export function NotesPanel({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient();
  const canDecide = useCan('underwriting:decide');
  const [body, setBody] = React.useState('');
  const q = useQuery({ queryKey: ['application-notes', applicationId], queryFn: () => getApplicationNotes(applicationId) });

  const add = useMutation({
    mutationFn: () => addApplicationNote(applicationId, body.trim()),
    onSuccess: () => {
      setBody('');
      toast.success('Note added');
      void qc.invalidateQueries({ queryKey: ['application-notes', applicationId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <SectionCard title="Decision notes" description="Internal notes and decisions on this application.">
      <div className="space-y-4">
        {q.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.data && q.data.length > 0 ? (
          <ol className="space-y-3">
            {[...q.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((n) => (
              <li key={n.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{n.authorName}</span>
                    <Badge variant={KIND_VARIANT[n.kind]}>{KIND_LABEL[n.kind]}</Badge>
                  </div>
                  <DateTime value={n.createdAt} relative />
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm">{n.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        )}

        {canDecide && (
          <div className="space-y-2 border-t pt-3">
            <Textarea aria-label="Add a note" placeholder="Add a note…" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex justify-end">
              <Button size="sm" loading={add.isPending} disabled={body.trim().length < 1} onClick={() => add.mutate()}>
                <Send /> Add note
              </Button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
