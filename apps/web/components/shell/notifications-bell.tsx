'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import type { InboxDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/ui/empty-state';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/utils';

export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => get<InboxDto>('/notifications/inbox'), refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['inbox'] });
  const read = useMutation({ mutationFn: (id: string) => post(`/notifications/inbox/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => post('/notifications/inbox/read-all'), onSuccess: refresh });
  const unread = inbox.data?.unread ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications, ${unread} unread`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground tabular">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" disabled={unread === 0 || readAll.isPending} onClick={() => readAll.mutate()}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {inbox.isLoading && <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {inbox.data && inbox.data.items.length === 0 && <EmptyState icon={Bell} title="You are all caught up" className="py-8" />}
          <ul>
            {inbox.data?.items.map((n) => {
              const inner = (
                <>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="block text-xs text-muted-foreground">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground"><DateTime value={n.createdAt} relative /></span>
                  </span>
                </>
              );
              return (
                <li key={n.id} className="border-b last:border-0">
                  {n.href ? (
                    <Link href={n.href} className="flex gap-2 px-4 py-3 hover:bg-muted/50" onClick={() => { if (!n.readAt) read.mutate(n.id); setOpen(false); }}>{inner}</Link>
                  ) : (
                    <button className="flex w-full gap-2 px-4 py-3 text-left hover:bg-muted/50" onClick={() => !n.readAt && read.mutate(n.id)}>{inner}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
