'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, CheckSquare, Loader2, Search, User, Users } from 'lucide-react';
import type { SearchResultDto } from '@damez/shared';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { get } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const ICONS = { user: User, branch: Building2, customer: Users, approval: CheckSquare } as const;
const LABELS = { user: 'Staff', branch: 'Branches', customer: 'Customers', approval: 'Approvals' } as const;

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const dq = useDebounced(q.trim(), 250);
  const res = useQuery({
    queryKey: ['search', dq],
    queryFn: () => get<SearchResultDto>('/search', { q: dq }),
    enabled: open && dq.length >= 2,
  });
  const flat = React.useMemo(
    () => (res.data?.groups ?? []).flatMap((g) => g.items.map((i) => ({ ...i, type: g.type }))),
    [res.data],
  );
  React.useEffect(() => setActive(0), [dq]);
  React.useEffect(() => { if (!open) setQ(''); }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="top-[20%] -translate-y-0 gap-0 p-0">
        <DialogTitle className="sr-only">Global search</DialogTitle>
        <DialogDescription className="sr-only">Search users, branches, customers and approvals</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            aria-label="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && flat[active]) go(flat[active].href);
            }}
            placeholder="Search users, branches, customers, approvals…"
            className="h-12 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {res.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />}
        </div>
        <div className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Results">
          {dq.length < 2 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type at least 2 characters.</p>}
          {dq.length >= 2 && !res.isFetching && flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No results for “{dq}”.</p>}
          {(res.data?.groups ?? []).map((g) => {
            const Icon = ICONS[g.type];
            return (
              <div key={g.type} className="mb-1">
                <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{LABELS[g.type]}</p>
                {g.items.map((i) => {
                  const idx = flat.findIndex((f) => f.id === i.id && f.type === g.type);
                  return (
                    <button
                      key={`${g.type}-${i.id}`}
                      role="option"
                      aria-selected={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(i.href)}
                      className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm', idx === active && 'bg-accent')}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{i.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{i.subtitle}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
