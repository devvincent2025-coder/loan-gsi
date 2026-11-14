'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import type { CustomerDto, Page } from '@damez/shared';
import { Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, get } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/** Search customers (masked) via GET /customers?q and pick one. */
export function CustomerPicker({ value, onChange, id = 'customer-picker' }: { value: CustomerDto | null; onChange: (c: CustomerDto | null) => void; id?: string }) {
  const [q, setQ] = React.useState('');
  const dq = useDebounced(q, 300);
  const res = useQuery({
    queryKey: ['customers', 'picker', dq],
    queryFn: () => get<Page<CustomerDto>>('/customers', { q: dq, pageSize: 6 }),
    placeholderData: (p) => p,
  });
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input id={id} className="pl-8" placeholder="Search by name, phone or BVN…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      {value && <p className="text-xs text-muted-foreground" data-testid="picked-customer">Selected: <span className="font-medium text-foreground">{value.fullName}</span> · {value.phone}</p>}
      <ul className="max-h-48 divide-y overflow-y-auto rounded-md border" role="listbox" aria-label="Customers">
        {res.isLoading && <li className="p-2"><Skeleton className="h-5 w-full" /></li>}
        {res.isError && <li className="p-3 text-xs text-destructive">{errorMessage(res.error)}</li>}
        {res.data?.items.length === 0 && <li className="p-3 text-xs text-muted-foreground">No customers found.</li>}
        {res.data?.items.map((c) => (
          <li key={c.id} role="option" aria-selected={value?.id === c.id}>
            <button type="button" onClick={() => onChange(c)} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60', value?.id === c.id && 'bg-accent')}>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.fullName}</span><span className="block truncate font-mono text-xs text-muted-foreground">{c.phone} · {c.bvn}</span></span>
              {value?.id === c.id && <Check className="size-4 text-primary" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
