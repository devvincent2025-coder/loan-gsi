import { ArrowRight, Check, CircleSlash } from 'lucide-react';
import type { ApplicationStatus, StateMachineDto } from '@damez/shared';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Phase = StateMachineDto['states'][number]['phase'];
const PHASES: { key: Phase; label: string }[] = [
  { key: 'ORIGINATION', label: 'Origination' }, { key: 'DECISION', label: 'Decision' }, { key: 'BOOKED', label: 'Booked' },
  { key: 'RECOVERY', label: 'Recovery' }, { key: 'END', label: 'Closed' },
];
/** exits drawn on their own red branch */
export const EXIT_STATES: ApplicationStatus[] = ['REJECTED', 'CANCELLED', 'WRITTEN_OFF'];

export type NodeState = 'current' | 'past' | 'dimmed' | 'future';
export function nodeState(key: ApplicationStatus, implemented: boolean, current: ApplicationStatus, visited: ApplicationStatus[]): NodeState {
  if (key === current) return 'current';
  if (visited.includes(key)) return 'past';
  if (!implemented) return 'dimmed';
  return 'future';
}

function Node({ state, label, exit, hint }: { state: NodeState; label: string; exit?: boolean; hint?: string }) {
  const node = (
    <div
      data-testid="sm-node" data-state={state} data-exit={exit ? 'true' : undefined} aria-current={state === 'current' ? 'step' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
        state === 'current' && (exit ? 'border-destructive bg-destructive text-destructive-foreground shadow-card' : 'border-primary bg-primary text-primary-foreground shadow-card ring-2 ring-primary/30'),
        state === 'past' && (exit ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-success/40 bg-success/10 text-success'),
        state === 'future' && (exit ? 'border-destructive/30 text-destructive/80' : 'bg-card text-foreground'),
        state === 'dimmed' && 'border-dashed bg-muted/40 text-muted-foreground opacity-60',
      )}
    >
      {state === 'past' && <Check className="size-3" aria-label="completed" />}
      {state === 'dimmed' && <CircleSlash className="size-3" aria-label="not yet implemented" />}
      {label}
    </div>
  );
  return hint ? <Tooltip content={hint}>{node}</Tooltip> : node;
}

export function StateMachineGraph({ machine, current, visited }: { machine: StateMachineDto; current: ApplicationStatus; visited: ApplicationStatus[] }) {
  const hint = (s: StateMachineDto['states'][number]) => (s.implemented ? undefined : 'Not yet implemented (Prompt 3)');
  const columns = PHASES.map((p) => ({ ...p, states: machine.states.filter((s) => s.phase === p.key && !EXIT_STATES.includes(s.key)) })).filter((c) => c.states.length > 0);
  const exits = machine.states.filter((s) => EXIT_STATES.includes(s.key));
  return (
    <div className="space-y-4" data-testid="state-machine">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch gap-2">
          {columns.map((c, i) => (
            <div key={c.key} className="flex items-stretch gap-2">
              <div className="min-w-32 rounded-lg border bg-muted/20 p-2.5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
                <div className="flex flex-col gap-1.5">
                  {c.states.map((s) => <Node key={s.key} label={s.label} state={nodeState(s.key, s.implemented, current, visited)} hint={hint(s)} />)}
                </div>
              </div>
              {i < columns.length - 1 && <ArrowRight className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden />}
            </div>
          ))}
          {exits.length > 0 && (
            <div className="flex items-stretch gap-2">
              <ArrowRight className="size-4 shrink-0 self-center text-destructive/60" aria-hidden />
              <div className="min-w-32 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-destructive/80">Exit</p>
                <div className="flex flex-col gap-1.5">
                  {exits.map((s) => <Node key={s.key} label={s.label} exit state={nodeState(s.key, s.implemented, current, visited)} hint={hint(s)} />)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
