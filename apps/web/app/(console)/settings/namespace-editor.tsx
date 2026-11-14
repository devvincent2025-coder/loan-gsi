'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SettingDto } from '@damez/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { errorMessage, put } from '@/lib/api';

const PLACEHOLDER_PREFIXES = ['llm.', 'scorecards.'];

/** Human-readable label for each setting key. Falls back to a title-cased version of the key suffix. */
const SETTING_LABELS: Record<string, string> = {
  'general.company_name':           'Company name',
  'general.timezone':               'Display timezone',
  'security.session_idle_minutes':  'Session idle timeout (minutes)',
  'security.max_failed_logins':     'Max failed login attempts',
  'security.lockout_minutes':       'Lockout duration (minutes)',
  'fees.schedule':                  'Fee schedule',
  'scorecards.default':             'Default scorecard',
  'llm.enabled':                    'LLM features enabled',
  'llm.provider':                   'LLM provider',
  'llm.allow_pii':                  'Allow PII in LLM prompts',
};

function settingLabel(key: string): string {
  if (SETTING_LABELS[key]) return SETTING_LABELS[key];
  const suffix = key.includes('.') ? key.split('.').slice(1).join('.') : key;
  return suffix.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Parse editor text back into a typed value matching the original value's type. */
export function parseSettingValue(original: unknown, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof original === 'number') {
    const n = Number(text);
    return text.trim() !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'Enter a valid number' };
  }
  if (typeof original === 'string') return { ok: true, value: text };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
}

function SettingRow({ s, canUpdate }: { s: SettingDto; canUpdate: boolean }) {
  const qc = useQueryClient();
  const isBool = typeof s.value === 'boolean';
  const isJson = typeof s.value === 'object' && s.value !== null || s.value === null;
  const initial = isJson ? JSON.stringify(s.value, null, 2) : String(s.value);
  const [text, setText] = React.useState(initial);
  const [bool, setBool] = React.useState(isBool ? (s.value as boolean) : false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setText(initial); if (isBool) setBool(s.value as boolean); setError(null); }, [initial, isBool, s.value]);

  const m = useMutation({
    mutationFn: (value: unknown) => put(`/settings/${s.key}`, { value }),
    onSuccess: () => { toast.success(`${s.key} saved`); void qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = isBool ? bool !== s.value : text !== initial;
  const save = () => {
    if (isBool) return m.mutate(bool);
    const r = parseSettingValue(s.value, text);
    if (!r.ok) return setError(r.error);
    setError(null);
    m.mutate(r.value);
  };
  const placeholder = PLACEHOLDER_PREFIXES.some((p) => s.key.startsWith(p));
  const id = `set-${s.key}`;
  return (
    <div className="grid gap-3 border-b py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{settingLabel(s.key)}</label>
        {s.description && <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>}
        {placeholder && <Badge variant="warning" className="mt-2">Placeholder, wired in a later phase</Badge>}
      </div>
      <div className="space-y-2">
        {isBool ? (
          <div className="flex items-center gap-2"><Switch id={id} checked={bool} disabled={!canUpdate} onCheckedChange={setBool} /><span className="text-sm">{bool ? 'Enabled' : 'Disabled'}</span></div>
        ) : isJson ? (
          <Textarea id={id} className="min-h-32 font-mono text-xs" value={text} disabled={!canUpdate} aria-invalid={!!error} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        ) : (
          <Input id={id} type={typeof s.value === 'number' ? 'number' : 'text'} value={text} disabled={!canUpdate} aria-invalid={!!error} onChange={(e) => setText(e.target.value)} />
        )}
        {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
        {canUpdate && <Button size="sm" disabled={!dirty} loading={m.isPending} onClick={save}>Save</Button>}
      </div>
    </div>
  );
}

export function NamespaceEditor({ settings, canUpdate }: { settings: SettingDto[]; canUpdate: boolean }) {
  if (settings.length === 0) return <Card><EmptyState title="No settings in this section" /></Card>;
  return <Card className="px-5">{settings.map((s) => <SettingRow key={s.key} s={s} canUpdate={canUpdate} />)}</Card>;
}
