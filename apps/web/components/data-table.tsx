'use client';
import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, Search, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { toCsv, downloadCsv, downloadExcel, type ExportCell, type ExportColumn } from '@/lib/export';
import { cn, safeStorage } from '@/lib/utils';

export interface DataColumn<T> {
  id: string;
  header: string;
  /** rendered cell; defaults to the accessor value */
  cell?: (row: T) => React.ReactNode;
  /** primitive value used for sort, global filter and export */
  accessor?: (row: T) => ExportCell;
  sortable?: boolean;
  /** excluded from export (e.g. action columns) */
  noExport?: boolean;
  defaultHidden?: boolean;
  className?: string;
  align?: 'left' | 'right';
}

export interface SortState { id: string; desc: boolean }

export function sortRows<T>(rows: T[], columns: DataColumn<T>[], sort: SortState | null): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.id === sort.id);
  if (!col?.accessor) return rows;
  const acc = col.accessor;
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = acc(a), y = acc(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

export function filterRows<T>(rows: T[], columns: DataColumn<T>[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) =>
    columns.some((c) => {
      const v = c.accessor?.(r);
      return v !== null && v !== undefined && String(v).toLowerCase().includes(needle);
    }),
  );
}

export function exportColumns<T>(columns: DataColumn<T>[]): ExportColumn<T>[] {
  return columns.filter((c) => c.accessor && !c.noExport).map((c) => ({ header: c.header, value: c.accessor! }));
}

export function rowsToCsv<T>(columns: DataColumn<T>[], rows: T[]): string {
  return toCsv(exportColumns(columns), rows);
}

interface SavedView { name: string; q: string; sort: SortState | null; hidden: string[] }

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 'client' paginates/filters locally; 'server' expects controlled page/search and `total` */
  mode?: 'client' | 'server';
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (p: number) => void;
  search?: string;
  onSearchChange?: (q: string) => void;
  selectable?: boolean;
  bulkActions?: (rows: T[], clear: () => void) => React.ReactNode;
  toolbar?: React.ReactNode;
  exportName?: string;
  savedViewsKey?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** extra classes per row (e.g. highlight risky rows) */
  rowClassName?: (row: T) => string | undefined;
  renderExpanded?: (row: T) => React.ReactNode;
  searchPlaceholder?: string;
  className?: string;
}

export function DataTable<T>({
  columns, data, rowKey, loading, error, onRetry, mode = 'client', total, page: pageProp, pageSize: pageSizeProp = 20,
  onPageChange, search: searchProp, onSearchChange, selectable, bulkActions, toolbar, exportName = 'export', savedViewsKey,
  emptyTitle = 'Nothing to show', emptyDescription, emptyAction, onRowClick, rowClassName, renderExpanded, searchPlaceholder = 'Search…', className,
}: DataTableProps<T>) {
  const server = mode === 'server';
  const [localQ, setLocalQ] = React.useState('');
  const q = server ? (searchProp ?? '') : localQ;
  const setQ = (v: string) => (server ? onSearchChange?.(v) : setLocalQ(v));
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [localPage, setLocalPage] = React.useState(1);
  const page = server ? (pageProp ?? 1) : localPage;
  const [hidden, setHidden] = React.useState<string[]>(() => columns.filter((c) => c.defaultHidden).map((c) => c.id));
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [views, setViews] = React.useState<SavedView[]>([]);

  React.useEffect(() => {
    if (!savedViewsKey) return;
    const raw = safeStorage.get(`dt:views:${savedViewsKey}`);
    if (raw) {
      try {
        setViews(JSON.parse(raw) as SavedView[]);
      } catch {
        /* ignore */
      }
    }
  }, [savedViewsKey]);
  const persistViews = (v: SavedView[]) => {
    setViews(v);
    if (savedViewsKey) safeStorage.set(`dt:views:${savedViewsKey}`, JSON.stringify(v));
  };

  const visibleCols = columns.filter((c) => !hidden.includes(c.id));

  const processed = React.useMemo(() => {
    const filtered = server ? data : filterRows(data, columns, q);
    return sortRows(filtered, columns, sort);
  }, [data, columns, q, sort, server]);

  const totalRows = server ? (total ?? data.length) : processed.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSizeProp));
  const safePage = Math.min(page, pageCount);
  const pageRows = server ? processed : processed.slice((safePage - 1) * pageSizeProp, safePage * pageSizeProp);

  const setPage = (p: number) => (server ? onPageChange?.(p) : setLocalPage(p));
  const selectedRows = data.filter((r) => selected.has(rowKey(r)));
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(rowKey(r)));
  const someOnPage = pageRows.some((r) => selected.has(rowKey(r)));

  const toggleSort = (id: string) =>
    setSort((s) => (!s || s.id !== id ? { id, desc: false } : s.desc ? null : { id, desc: true }));

  const exportRows = server ? processed : processed;
  const cols = exportColumns(visibleCols);

  const saveView = () => {
    const name = window.prompt('Name this view');
    if (!name) return;
    persistViews([...views.filter((v) => v.name !== name), { name, q, sort, hidden }]);
  };

  const colSpan = visibleCols.length + (selectable ? 1 : 0) + (renderExpanded ? 1 : 0);

  return (
    <div className={cn('rounded-lg bg-card shadow-card', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search table" className="pl-8" placeholder={searchPlaceholder} value={q} onChange={(e) => { setQ(e.target.value); if (!server) setLocalPage(1); }} />
        </div>
        {toolbar}
        <div className="ml-auto flex items-center gap-1.5">
          {savedViewsKey && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><Bookmark /> Views</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {views.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet</div>}
                {views.map((v) => (
                  <DropdownMenuItem key={v.name} onSelect={() => { setQ(v.q); setSort(v.sort); setHidden(v.hidden); }}>
                    {v.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={saveView}>Save current view…</DropdownMenuItem>
                {views.length > 0 && (
                  <DropdownMenuItem destructive onSelect={() => persistViews([])}>Clear saved views</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Columns"><Columns3 /> <span className="hidden sm:inline">Columns</span></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {columns.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={!hidden.includes(c.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) => setHidden((h) => (v ? h.filter((x) => x !== c.id) : [...h, c.id]))}
                >
                  {c.header || c.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exportRows.length === 0}><Download /> Export <ChevronDown className="size-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => downloadCsv(`${exportName}.csv`, cols, exportRows)}>CSV (current rows)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadExcel(`${exportName}.xlsx`, cols, exportRows)}>Excel (current rows)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {selectable && selectedRows.length > 0 && bulkActions && (
        <div className="flex items-center gap-3 border-b bg-accent px-3 py-2 text-sm" role="status">
          <span className="font-medium">{selectedRows.length} selected</span>
          {bulkActions(selectedRows, () => setSelected(new Set()))}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    aria-label="Select all rows on page"
                    checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                    onCheckedChange={(v) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        pageRows.forEach((r) => (v ? n.add(rowKey(r)) : n.delete(rowKey(r))));
                        return n;
                      })
                    }
                  />
                </th>
              )}
              {renderExpanded && <th className="w-8" />}
              {visibleCols.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort!.desc ? 'descending' : 'ascending') : undefined}
                    className={cn('px-3 py-2.5 font-medium', c.align === 'right' && 'text-right', c.className)}
                  >
                    {c.sortable && c.accessor ? (
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.id)}>
                        {c.header}
                        {active ? (sort!.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />) : <ArrowUpDown className="size-3 opacity-50" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="border-b last:border-0" data-testid="skeleton-row">
                  <td colSpan={colSpan} className="px-3 py-3"><Skeleton className="h-5 w-full" /></td>
                </tr>
              ))}
            {!loading && error && (
              <tr><td colSpan={colSpan}><ErrorState message={error} onRetry={onRetry} /></td></tr>
            )}
            {!loading && !error && pageRows.length === 0 && (
              <tr><td colSpan={colSpan}><EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} action={emptyAction} /></td></tr>
            )}
            {!loading && !error &&
              pageRows.map((r) => {
                const key = rowKey(r);
                const isOpen = expanded === key;
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={cn('border-b transition-colors last:border-0 hover:bg-muted/40', selected.has(key) && 'bg-accent/50', onRowClick && 'cursor-pointer', rowClassName?.(r))}
                      onClick={onRowClick ? () => onRowClick(r) : undefined}
                    >
                      {selectable && (
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label="Select row"
                            checked={selected.has(key)}
                            onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(key); else n.delete(key); return n; })}
                          />
                        </td>
                      )}
                      {renderExpanded && (
                        <td className="px-1">
                          <Button variant="ghost" size="icon" className="size-7" aria-expanded={isOpen} aria-label={isOpen ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : key); }}>
                            <ChevronRight className={cn('transition-transform', isOpen && 'rotate-90')} />
                          </Button>
                        </td>
                      )}
                      {visibleCols.map((c) => (
                        <td key={c.id} className={cn('px-3 py-2.5 align-middle', c.align === 'right' && 'text-right', c.className)}>
                          {c.cell ? c.cell(r) : String(c.accessor?.(r) ?? '—')}
                        </td>
                      ))}
                    </tr>
                    {isOpen && renderExpanded && (
                      <tr className="border-b bg-muted/30"><td colSpan={colSpan} className="p-4">{renderExpanded(r)}</td></tr>
                    )}
                  </React.Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">{totalRows.toLocaleString('en-NG')} {totalRows === 1 ? 'row' : 'rows'}</span>
        <div className="flex items-center gap-2">
          <span className="tabular">Page {safePage} of {pageCount}</span>
          <Button variant="outline" size="icon" className="size-7" aria-label="Previous page" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><ChevronLeft /></Button>
          <Button variant="outline" size="icon" className="size-7" aria-label="Next page" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
