/** Timestamps are stored/transported in UTC; displayed in Africa/Lagos (WAT, UTC+1). */
export const DISPLAY_TZ = 'Africa/Lagos';

type DateInput = Date | string | number;

export function formatLagos(
  input: DateInput | null | undefined,
  style: 'datetime' | 'date' | 'time' | 'short' = 'datetime',
): string {
  if (input === null || input === undefined) return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = { timeZone: DISPLAY_TZ };
  if (style === 'date') Object.assign(opts, { day: '2-digit', month: 'short', year: 'numeric' });
  else if (style === 'time') Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false });
  else if (style === 'short') Object.assign(opts, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  else
    Object.assign(opts, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  return new Intl.DateTimeFormat('en-NG', opts).format(d);
}

export function relativeTime(input: DateInput, now: Date = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return formatLagos(d, 'date');
}
