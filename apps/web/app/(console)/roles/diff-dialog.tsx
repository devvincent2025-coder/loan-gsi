'use client';
import type { RoleDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type Draft = Record<string, string[]>;
export interface RoleDiff { role: RoleDto; added: string[]; removed: string[] }

export function computeDiff(roles: RoleDto[], base: Draft, current: Draft): RoleDiff[] {
  const out: RoleDiff[] = [];
  for (const role of roles) {
    const b = new Set(base[role.id] ?? []);
    const c = new Set(current[role.id] ?? []);
    const added = [...c].filter((p) => !b.has(p)).sort();
    const removed = [...b].filter((p) => !c.has(p)).sort();
    if (added.length || removed.length) out.push({ role, added, removed });
  }
  return out;
}

export function DiffDialog({ open, onOpenChange, diff, saving, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; diff: RoleDiff[]; saving: boolean; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Review permission changes</DialogTitle><DialogDescription>These changes apply immediately and are written to the audit log.</DialogDescription></DialogHeader>
        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {diff.map((d) => (
            <section key={d.role.id}>
              <h3 className="mb-1.5 text-sm font-semibold">{d.role.name}</h3>
              <ul className="space-y-1 font-mono text-xs">
                {d.added.map((p) => <li key={p} className="rounded bg-success/10 px-2 py-1 text-success">+ {p}</li>)}
                {d.removed.map((p) => <li key={p} className="rounded bg-destructive/10 px-2 py-1 text-destructive">− {p}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={saving} onClick={onConfirm}>Confirm and save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
