import { formatLagos, relativeTime } from '@damez/shared';

export function DateTime({
  value,
  style = 'datetime',
  relative,
}: {
  value: string | Date | null | undefined;
  style?: 'datetime' | 'date' | 'time' | 'short';
  relative?: boolean;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={new Date(value).toISOString()} title={`${formatLagos(value)} (WAT)`} className="tabular whitespace-nowrap">
      {relative ? relativeTime(value) : formatLagos(value, style)}
    </time>
  );
}
