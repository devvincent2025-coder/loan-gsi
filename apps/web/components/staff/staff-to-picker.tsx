'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { StaffDirectoryEntryDto } from '@damez/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, get } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Gmail "To"-style multi-picker: type to search the staff directory, pick from the
 * dropdown, picks become removable chips inline with the input. Backed by GET /users/directory.
 */
export function StaffToPicker({
  value, onChange, max = 2, id = 'staff-to-picker', placeholder = 'Type a name or email…', autoFocus,
}: {
  value: StaffDirectoryEntryDto[];
  onChange: (next: StaffDirectoryEntryDto[]) => void;
  max?: number;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const dq = useDebounced(q, 250);
  const atMax = value.length >= max;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const res = useQuery({
    queryKey: ['staff-directory', dq],
    queryFn: () => get<StaffDirectoryEntryDto[]>('/staff/directory', { q: dq }),
    enabled: dq.trim().length > 0 && !atMax,
    placeholderData: (p) => p,
  });
  const options = (res.data ?? []).filter((s) => !value.some((v) => v.id === s.id));

  React.useEffect(() => setHighlight(0), [dq, options.length]);

  React.useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const add = (s: StaffDirectoryEntryDto) => {
    if (value.some((v) => v.id === s.id) || value.length >= max) return;
    onChange([...value, s]);
    setQ('');
    setOpen(false);
    inputRef.current?.focus();
  };
  const remove = (id: string) => onChange(value.filter((v) => v.id !== id));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && q === '' && value.length > 0) {
      remove(value[value.length - 1].id);
      return;
    }
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); add(options[highlight]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div
        className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground" data-testid="staff-chip">
            {s.fullName}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(s.id); }}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Remove ${s.fullName}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {!atMax && (
          <input
            ref={inputRef}
            id={id}
            autoFocus={autoFocus}
            className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={value.length === 0 ? placeholder : ''}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-listbox`}
          />
        )}
      </div>

      {atMax && <p className="mt-1 text-xs text-muted-foreground">Up to {max} staff member{max === 1 ? '' : 's'} — remove one to add another.</p>}

      {open && !atMax && dq.trim().length > 0 && (
        <ul id={`${id}-listbox`} role="listbox" aria-label="Staff members" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {res.isLoading && <li className="p-2"><Skeleton className="h-5 w-full" /></li>}
          {res.isError && <li className="p-3 text-xs text-destructive">{errorMessage(res.error)}</li>}
          {!res.isLoading && !res.isError && options.length === 0 && <li className="p-3 text-xs text-muted-foreground">No staff found.</li>}
          {options.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(s)}
                onMouseEnter={() => setHighlight(i)}
                className={cn('flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted/60', i === highlight && 'bg-accent')}
              >
                <span className="font-medium">{s.fullName}</span>
                <span className="text-xs text-muted-foreground">{s.email} · {s.roleName}{s.branchName ? ` · ${s.branchName}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
