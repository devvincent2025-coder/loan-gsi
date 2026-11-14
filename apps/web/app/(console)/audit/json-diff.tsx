import { cn } from '@/lib/utils';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Top-level keys whose JSON differs between before and after. */
export function changedKeys(before: unknown, after: unknown): Set<string> {
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.add(k);
  }
  return out;
}

function Side({ title, value, changed, tone }: { title: string; value: unknown; changed: Set<string>; tone: 'before' | 'after' }) {
  if (value === null || value === undefined) return <div><p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p><p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">None</p></div>;
  const entries = isObj(value) ? Object.entries(value) : null;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
        {entries
          ? entries.map(([k, v]) => (
              <div key={k} className={cn(changed.has(k) && (tone === 'before' ? 'bg-destructive/15' : 'bg-success/15'))}>
                {JSON.stringify(k)}: {JSON.stringify(v)}
              </div>
            ))
          : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  if ((before === null || before === undefined) && (after === null || after === undefined)) return <p className="text-xs text-muted-foreground">No before/after snapshot recorded.</p>;
  const changed = changedKeys(before, after);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Side title="Before" value={before} changed={changed} tone="before" />
      <Side title="After" value={after} changed={changed} tone="after" />
    </div>
  );
}
