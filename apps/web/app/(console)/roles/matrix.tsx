'use client';
import * as React from 'react';
import { ChevronDown, Lock } from 'lucide-react';
import { SUPER_ADMIN_ROLE_KEY, type PermissionCatalogDto, type RoleDto } from '@damez/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function PermissionMatrix({
  roles, catalog, current, base, canEdit, onToggle,
}: {
  roles: RoleDto[];
  catalog: PermissionCatalogDto;
  current: Record<string, string[]>;
  base: Record<string, string[]>;
  canEdit: boolean;
  onToggle: (roleId: string, perms: string[], on: boolean) => void;
}) {
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  const sets = React.useMemo(() => Object.fromEntries(roles.map((r) => [r.id, new Set(current[r.id] ?? [])])), [roles, current]);
  const baseSets = React.useMemo(() => Object.fromEntries(roles.map((r) => [r.id, new Set(base[r.id] ?? [])])), [roles, base]);
  const locked = (r: RoleDto) => r.key === SUPER_ADMIN_ROLE_KEY;

  return (
    <div className="max-h-[70vh] overflow-auto border-t">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-64 border-b bg-card px-4 py-3 text-left text-xs font-medium text-muted-foreground">Permission</th>
            {roles.map((r) => (
              <th key={r.id} scope="col" className="sticky top-0 z-20 min-w-28 border-b bg-card px-2 py-3 text-center text-xs font-semibold">
                <span className="inline-flex items-center gap-1">{locked(r) && <Tooltip content="Super Admin permissions are locked"><Lock className="size-3 text-muted-foreground" aria-label="Locked" /></Tooltip>}{r.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {catalog.groups.map((g) => {
            const isClosed = closed.has(g.module);
            const keys = g.permissions.map((p) => p.key);
            return (
              <React.Fragment key={g.module}>
                <tr className="bg-muted/60">
                  <th scope="rowgroup" className="sticky left-0 z-10 bg-muted px-4 py-2 text-left">
                    <button
                      className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
                      aria-expanded={!isClosed}
                      onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(g.module)) n.delete(g.module); else n.add(g.module); return n; })}
                    >
                      <ChevronDown className={cn('size-3.5 transition-transform', isClosed && '-rotate-90')} aria-hidden />
                      {g.label}
                      <span className="font-normal normal-case text-muted-foreground">({keys.length})</span>
                    </button>
                  </th>
                  {roles.map((r) => {
                    const n = keys.filter((k) => sets[r.id].has(k)).length;
                    const state = n === 0 ? false : n === keys.length ? true : ('indeterminate' as const);
                    return (
                      <td key={r.id} className="bg-muted/60 text-center">
                        <Checkbox
                          aria-label={`Toggle all ${g.label} for ${r.name}`}
                          checked={state}
                          disabled={!canEdit || locked(r)}
                          onCheckedChange={() => onToggle(r.id, keys, state !== true)}
                        />
                      </td>
                    );
                  })}
                </tr>
                {!isClosed &&
                  g.permissions.map((p) => (
                    <tr key={p.key} className="group">
                      <th scope="row" className="sticky left-0 z-10 border-b bg-card px-4 py-2 text-left font-normal group-hover:bg-muted">
                        <p className="font-mono text-xs">{p.key}</p>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      </th>
                      {roles.map((r) => {
                        const on = sets[r.id].has(p.key);
                        const changed = on !== baseSets[r.id].has(p.key);
                        return (
                          <td key={r.id} className={cn('border-b text-center group-hover:bg-muted/50', changed && 'bg-warning/10')}>
                            <Checkbox
                              aria-label={`${p.key} for ${r.name}`}
                              checked={on}
                              disabled={!canEdit || locked(r)}
                              onCheckedChange={(v) => onToggle(r.id, [p.key], v === true)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
