import { cn } from '@/lib/utils';
import { BAND_COLOR, BAND_LABEL, BAND_ORDER, bandForScore, scoreFraction } from './bureau-utils';
import type { ScoreBand } from '@damez/shared';

const CX = 100, CY = 96, R = 78;
/** frac 0 = left end of the semicircle, 1 = right end */
const point = (frac: number, r = R) => {
  const a = Math.PI * (1 - frac);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
};
const arc = (f0: number, f1: number) => {
  const [x0, y0] = point(f0), [x1, y1] = point(f1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

export interface ScoreGaugeProps {
  score: number | null | undefined;
  min?: number;
  max?: number;
  /** override the derived band */
  band?: ScoreBand | null;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Semicircular gauge with five Poor→Excellent colour bands and a needle at the score. */
export function ScoreGauge({ score, min = 300, max = 850, band, label, size = 'md', className }: ScoreGaugeProps) {
  const has = typeof score === 'number';
  const b = has ? (band ?? bandForScore(score, min, max)) : null;
  const f = has ? scoreFraction(score, min, max) : 0;
  const [nx, ny] = point(f, R - 2);
  const dim = { sm: 'w-32', md: 'w-52', lg: 'w-72' }[size];
  return (
    <figure className={cn('inline-flex flex-col items-center', className)} data-testid="score-gauge" data-band={b ?? 'NONE'} data-score={has ? score : ''}>
      <svg viewBox="0 0 200 118" className={cn(dim)} role="img" aria-label={has ? `${label ?? 'Score'} ${score} out of ${max}, ${BAND_LABEL[b!]}` : `${label ?? 'Score'} unavailable`}>
        {BAND_ORDER.map((bn, i) => (
          <path key={bn} d={arc(i / 5 + 0.004, (i + 1) / 5 - 0.004)} fill="none" stroke={BAND_COLOR[bn]} strokeWidth={size === 'sm' ? 16 : 13} opacity={has && bn !== b ? 0.35 : 1} />
        ))}
        {has && (
          <>
            <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="hsl(var(--foreground))" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={CX} cy={CY} r="5" fill="hsl(var(--foreground))" />
          </>
        )}
        <text x={CX - R} y={CY + 14} textAnchor="middle" className="fill-muted-foreground" fontSize="9">{min}</text>
        <text x={CX + R} y={CY + 14} textAnchor="middle" className="fill-muted-foreground" fontSize="9">{max}</text>
      </svg>
      <figcaption className="-mt-1 text-center">
        <p className={cn('tabular font-semibold leading-none', size === 'sm' ? 'text-lg' : size === 'md' ? 'text-3xl' : 'text-4xl')} data-testid="score-gauge-value">{has ? score : '—'}</p>
        <p className="mt-1 text-xs font-medium" style={{ color: b ? BAND_COLOR[b] : undefined }} data-testid="score-gauge-band">{b ? BAND_LABEL[b] : 'No score'}</p>
        {label && <p className="text-[11px] text-muted-foreground">{label}</p>}
      </figcaption>
    </figure>
  );
}
