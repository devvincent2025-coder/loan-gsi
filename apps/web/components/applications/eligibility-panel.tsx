import { AlertTriangle, CheckCircle2, Info, Lightbulb, OctagonX, XCircle } from 'lucide-react';
import { DEFAULT_SCORECARD_V1, type EligibilityOutcome, type EligibilityResultDto, type ReasonSeverity } from '@damez/shared';
import { MoneyText } from '@/components/money';
import { ScoreGauge } from '@/components/bureau/score-gauge';
import { Callout, KeyValue, SectionCard } from '@/components/staff/ui-bits';
import { Badge } from '@/components/ui/badge';
import { titleCase } from '@/lib/utils';
import { OutcomeBadge } from './application-ui';

const SEVERITY_ORDER: ReasonSeverity[] = ['BLOCKER', 'WARNING', 'INFO', 'POSITIVE'];

/** Older assessments (computed before officer messages were rewritten in plain language) embedded a
 * raw "[rule CODE: field=value]" trace in the stored text. Strip it for display without touching the
 * stored assessment record. No-op on current records, which never include it. */
function stripRuleTag(message: string): string {
  return message.replace(/\s*\[rule\s+[^\]]*\]/gi, '').trim();
}
export function SeverityIcon({ severity }: { severity: ReasonSeverity }) {
  if (severity === 'BLOCKER') return <XCircle className="size-4 shrink-0 text-destructive" aria-label="Blocker" />;
  if (severity === 'WARNING') return <AlertTriangle className="size-4 shrink-0 text-warning" aria-label="Warning" />;
  if (severity === 'POSITIVE') return <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Positive" />;
  return <Info className="size-4 shrink-0 text-info" aria-label="Info" />;
}

const OUTCOME_COPY: Record<EligibilityOutcome, { tone: 'success' | 'warning' | 'danger'; title: string; text: string }> = {
  ELIGIBLE: { tone: 'success', title: 'Eligible', text: 'The customer qualifies for the requested loan under the active policy.' },
  CONDITIONAL: { tone: 'warning', title: 'Conditional: manual review', text: 'The request needs a credit officer decision or an adjustment (see suggestions).' },
  INELIGIBLE: { tone: 'danger', title: 'Ineligible', text: 'The request does not meet policy. See the reasons and alternatives below.' },
};

export function DtiBar({ dtiBps, limitBps }: { dtiBps: number; limitBps: number }) {
  const scaleMax = Math.max(limitBps * 1.5, dtiBps, 1);
  const over = dtiBps > limitBps;
  return (
    <div data-testid="dti-bar" data-over={over ? 'true' : 'false'}>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Debt to income" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(dtiBps / 100)}>
        <div className={`h-full rounded-full ${over ? 'bg-destructive' : 'bg-success'}`} style={{ width: `${Math.min(100, (dtiBps / scaleMax) * 100)}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(limitBps / scaleMax) * 100}%` }} title={`Limit ${limitBps / 100}%`} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>DTI <span className={`tabular font-medium ${over ? 'text-destructive' : 'text-foreground'}`}>{(dtiBps / 100).toFixed(1)}%</span></span><span>Limit {(limitBps / 100).toFixed(0)}%</span></div>
    </div>
  );
}

export function FactorBars({ factors }: { factors: EligibilityResultDto['factors'] }) {
  const max = Math.max(1, ...factors.map((f) => Math.abs(f.points)));
  return (
    <ul className="space-y-1.5" data-testid="factor-chart">
      {factors.map((f) => (
        <li key={f.key} className="grid grid-cols-[minmax(0,10rem),1fr,3rem] items-center gap-2 text-xs sm:grid-cols-[minmax(0,14rem),1fr,3rem]">
          <span className="truncate" title={`${f.label}: ${f.value}`}>{f.label} <span className="text-muted-foreground">({f.value})</span></span>
          <div className="relative h-4">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <div className={`absolute inset-y-0.5 rounded-sm ${f.points >= 0 ? 'left-1/2 bg-success/80' : 'right-1/2 bg-destructive/80'}`} style={{ width: `${(Math.abs(f.points) / max) * 50}%` }} />
          </div>
          <span className={`tabular text-right font-medium ${f.points > 0 ? 'text-success' : f.points < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{f.points > 0 ? '+' : ''}{f.points}</span>
        </li>
      ))}
    </ul>
  );
}

export function EligibilityPanel({ result, dtiLimitBps, minScore = 300, maxScore = 850, title = 'Eligibility assessment' }: {
  result: EligibilityResultDto; dtiLimitBps?: number; minScore?: number; maxScore?: number; title?: string;
}) {
  const copy = OUTCOME_COPY[result.outcome];
  const reasons = [...result.reasons].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const limit = dtiLimitBps ?? DEFAULT_SCORECARD_V1.affordability.maxDtiBps;
  const within = result.requestedMonthlyRepaymentKobo <= result.maxMonthlyRepaymentKobo;
  return (
    <div className="space-y-5" data-testid="eligibility-panel" data-outcome={result.outcome}>
      <SectionCard title={title} description={`${result.scorecard.name} v${result.scorecard.version}${result.simulated ? ' · simulation' : ''}`} actions={<OutcomeBadge outcome={result.outcome} />}>
        <Callout tone={copy.tone} title={copy.title} data-testid="outcome-banner" icon={result.outcome === 'INELIGIBLE' ? <OctagonX className="size-4" aria-hidden /> : result.outcome === 'ELIGIBLE' ? <CheckCircle2 className="size-4" aria-hidden /> : undefined}>{copy.text}</Callout>
        <div className="mt-5 grid gap-6 md:grid-cols-[auto,1fr] md:items-center">
          <div className="flex justify-center"><ScoreGauge score={result.score} band={result.scoreBand} min={minScore} max={maxScore} label="Scorecard score" /></div>
          <div className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <KeyValue label="Max eligible amount"><MoneyText kobo={result.maxAmountKobo} /></KeyValue>
              <KeyValue label="Requested"><MoneyText kobo={result.requested.amountKobo} /> · {result.requested.tenorMonths} mo</KeyValue>
              <KeyValue label="KYC tier / cap">Tier {result.kycTier} · <MoneyText kobo={result.kycCapKobo} compact /></KeyValue>
              <KeyValue label="Max monthly repayment"><MoneyText kobo={result.maxMonthlyRepaymentKobo} /></KeyValue>
              <KeyValue label="Requested repayment"><span className={within ? '' : 'text-destructive'}><MoneyText kobo={result.requestedMonthlyRepaymentKobo} /></span></KeyValue>
              <KeyValue label="Recognised income"><MoneyText kobo={result.recognisedIncomeKobo} /></KeyValue>
              <KeyValue label="External obligations"><MoneyText kobo={result.externalObligationsKobo} /></KeyValue>
            </dl>
            <DtiBar dtiBps={result.dtiBps} limitBps={limit} />
          </div>
        </div>
        {/* {result.firedRules.length > 0 && (
          <div className="mt-5">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Policy rules that fired</p>
            <div className="flex flex-wrap gap-1.5" data-testid="fired-rules">
              {result.firedRules.map((r) => <Badge key={r.code} variant={r.action === 'DECLINE' ? 'destructive' : 'warning'} className="font-mono text-[11px]">{r.code} · {r.action}</Badge>)}
            </div>
          </div>
        )} */}
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Reasons" description=".">
          {reasons.length === 0 ? <p className="text-sm text-muted-foreground">No reasons recorded.</p> : (
            <ul className="space-y-2.5" data-testid="reasons">
              {reasons.map((r, i) => (
                <li key={`${r.code}-${i}`} className="flex gap-2.5 text-sm" data-severity={r.severity}>
                  <SeverityIcon severity={r.severity} />
                  <div><p>{stripRuleTag(r.officerMessage)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Suggestions">
          {result.suggestions.length === 0 ? <p className="text-sm text-muted-foreground">No suggestions.</p> : (
            <ul className="space-y-2.5" data-testid="suggestions">
              {result.suggestions.map((s, i) => (
                <li key={`${s.type}-${i}`} className="flex gap-2.5 text-sm">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div>
                    <p><span className="font-medium">{titleCase(s.type)}.</span> {s.officerMessage}</p>
                    {(s.amountKobo !== undefined || s.tenorMonths !== undefined) && (
                      <p className="text-xs text-muted-foreground">
                        {s.amountKobo !== undefined && <><MoneyText kobo={s.amountKobo} /> </>}{s.tenorMonths !== undefined && `over ${s.tenorMonths} mo `}{s.monthlyRepaymentKobo !== undefined && <>· <MoneyText kobo={s.monthlyRepaymentKobo} />/mo</>}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {result.alternatives.length > 0 && (
        <SectionCard title="Alternative offers">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="alternatives">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 pr-3 font-medium">Product</th><th className="pr-3 text-right font-medium">Amount</th><th className="pr-3 text-right font-medium">Tenor</th><th className="pr-3 text-right font-medium">Monthly</th><th className="pr-3 text-right font-medium">Rate</th><th className="font-medium">Note</th></tr></thead>
              <tbody>
                {result.alternatives.map((a, i) => (
                  <tr key={`${a.productId}-${i}`} className="border-t">
                    <td className="py-2 pr-3 font-medium">{a.productName}</td>
                    <td className="pr-3 text-right"><MoneyText kobo={a.amountKobo} /></td>
                    <td className="tabular pr-3 text-right">{a.tenorMonths} mo</td>
                    <td className="pr-3 text-right"><MoneyText kobo={a.monthlyRepaymentKobo} /></td>
                    <td className="tabular pr-3 text-right">{(a.monthlyRateBps / 100).toFixed(2)}%</td>
                    <td className="text-muted-foreground">{a.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Factor contributions" description={``}>
        {result.factors.length === 0 ? <p className="text-sm text-muted-foreground">No factors evaluated.</p> : <FactorBars factors={result.factors} />}
      </SectionCard>
    </div>
  );
}
