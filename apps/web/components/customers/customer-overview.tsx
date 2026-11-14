'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, ShieldQuestion } from 'lucide-react';
import { formatLagos, type CustomerDetailDto, type ScreeningDto } from '@damez/shared';
import { DateTime } from '@/components/date-time';
import { MaskedField } from '@/components/masked-field';
import { MoneyText } from '@/components/money';
import { KeyValue, SectionCard } from '@/components/staff/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/auth';
import { errorMessage, post } from '@/lib/api';
import { revealCustomerField } from '@/lib/staff-api-extra';
import { titleCase } from '@/lib/utils';
import { FraudSignalsPanel } from './fraud-panel';
import { LivenessIcon, VerificationIcon } from './customer-ui';

const SCREEN_VARIANT = { CLEAR: 'success', MATCH: 'destructive', REVIEW: 'warning' } as const;
const CONSENT_VARIANT = { GRANTED: 'success', REVOKED: 'destructive', EXPIRED: 'secondary' } as const;

export function CustomerOverview({ customer, onChanged }: { customer: CustomerDetailDto; onChanged: () => void }) {
  const canReveal = useCan('pii:reveal');
  const canScreen = useCan('screening:run');
  const screening = useMutation({
    mutationFn: () => post<ScreeningDto[]>(`/customers/${customer.id}/screening/run`),
    onSuccess: (r) => { toast.success(`Screening complete: ${r.map((x) => `${x.type} ${x.status.toLowerCase()}`).join(', ') || 'no results'}`); onChanged(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reveal = (field: 'bvn' | 'phone' | 'email') => async (reason: string) => revealCustomerField(customer.id, field, reason);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Identity & contact">
          <dl className="grid gap-4 sm:grid-cols-2">
            <KeyValue label="Full name"><span data-testid="customer-name">{customer.fullName}</span></KeyValue>
            <KeyValue label="BVN">{customer.bvn ? <MaskedField label="BVN" masked={customer.bvn} canReveal={canReveal} onReveal={reveal('bvn')} /> : <span className="text-muted-foreground">Not provided</span>}</KeyValue>
            <KeyValue label="Phone">
              <span className="inline-flex flex-wrap items-center gap-2"><MaskedField label="phone" masked={customer.phone} canReveal={canReveal} onReveal={reveal('phone')} />{customer.phoneVerified && <Badge variant="success"><BadgeCheck className="size-3" aria-hidden />Verified</Badge>}</span>
            </KeyValue>
            <KeyValue label="Email">
              {customer.email ? <span className="inline-flex flex-wrap items-center gap-2"><MaskedField label="email" masked={customer.email} canReveal={canReveal} onReveal={reveal('email')} />{customer.emailVerified && <Badge variant="success"><BadgeCheck className="size-3" aria-hidden />Verified</Badge>}</span> : <span className="text-muted-foreground">Not provided</span>}
            </KeyValue>
            <KeyValue label="State">{customer.state ?? '—'}</KeyValue>
            <KeyValue label="Branch">{customer.branch?.name ?? '—'}</KeyValue>
            <KeyValue label="Customer since"><DateTime value={customer.createdAt} style="date" /></KeyValue>
            <KeyValue label="Channel">{customer.portalRegistered ? 'Self-registered (portal)' : 'Branch created'}</KeyValue>
          </dl>
        </SectionCard>
        <SectionCard title="Employment & income">
          <dl className="grid gap-4 sm:grid-cols-2">
            <KeyValue label="Employment status">{customer.employmentStatus ? titleCase(customer.employmentStatus) : '—'}</KeyValue>
            <KeyValue label="Employer">{customer.employer ?? '—'}</KeyValue>
            <KeyValue label="Declared monthly income">{customer.monthlyIncomeKobo === null ? '—' : <MoneyText kobo={customer.monthlyIncomeKobo} />}</KeyValue>
            <KeyValue label="Salary day">{customer.salaryDay ? `Day ${customer.salaryDay}` : '—'}</KeyValue>
            <KeyValue label="KYC tier / max loan"><span>Tier {customer.kycTier} · <MoneyText kobo={customer.maxLoanKobo} /></span></KeyValue>
          </dl>
        </SectionCard>
      </div>

      <SectionCard title="KYC verifications" description="Latest first. Provider references are not shown.">
        {customer.verifications.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No verifications attempted yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l pl-6" data-testid="kyc-timeline">
            {[...customer.verifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((v) => (
              <li key={v.id} className="relative">
                <span className="absolute -left-[33px] top-0 flex size-5 items-center justify-center rounded-full bg-card"><VerificationIcon status={v.status} /></span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{titleCase(v.type)}</span>
                  <Badge variant={v.status === 'PASSED' ? 'success' : v.status === 'FAILED' ? 'destructive' : v.status === 'REVIEW' ? 'warning' : 'secondary'}>{titleCase(v.status)}</Badge>
                  <span className="text-xs text-muted-foreground">{v.provider}</span>
                  {v.matchConfidence !== null && <span className="tabular text-xs text-muted-foreground">Match {v.matchConfidence}%</span>}
                  <LivenessIcon passed={v.livenessPassed} />
                  <span className="ml-auto text-xs text-muted-foreground">{formatLagos(v.completedAt ?? v.createdAt, 'short')}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{v.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard id="consents" title="Consents" description="Consents given by the customer (NDPA).">
          {customer.consents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No consents recorded.</p>
          ) : (
            <ul className="divide-y" data-testid="consents-list">
              {customer.consents.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="font-medium">{titleCase(c.purpose)}</span>
                  <Badge variant={CONSENT_VARIANT[c.status]}>{titleCase(c.status)}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{c.textVersion}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{c.revokedAt ? `Revoked ${formatLagos(c.revokedAt, 'date')}` : `Granted ${formatLagos(c.grantedAt, 'date')}`}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard
          title="Sanctions & PEP screening"
          actions={canScreen && <Button size="sm" variant="outline" loading={screening.isPending} onClick={() => screening.mutate()}><ShieldQuestion /> Run screening</Button>}
        >
          {customer.screening.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Not screened yet.</p>
          ) : (
            <ul className="divide-y" data-testid="screening-list">
              {customer.screening.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="font-medium">{s.type === 'PEP' ? 'PEP' : 'Sanctions'}</span>
                  <Badge variant={SCREEN_VARIANT[s.status]}>{titleCase(s.status)}</Badge>
                  {s.matchCount > 0 && <span className="text-xs text-destructive">{s.matchCount} match(es)</span>}
                  <span className="text-xs text-muted-foreground">{s.provider}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatLagos(s.createdAt, 'short')}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <FraudSignalsPanel customerId={customer.id} signals={customer.fraudSignals} onChanged={onChanged} />

      <SectionCard title="Risk flags" description="Raised by bureau monitoring and internal checks.">
        {customer.riskFlags.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No risk flags.</p>
        ) : (
          <ul className="space-y-2" data-testid="risk-flags">
            {customer.riskFlags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                <Badge variant={f.severity === 'HIGH' ? 'destructive' : f.severity === 'MEDIUM' ? 'warning' : 'secondary'}>{titleCase(f.severity)}</Badge>
                <span className="font-medium">{titleCase(f.type)}</span>
                {!f.active && <Badge variant="secondary">Inactive</Badge>}
                <span className="text-muted-foreground">{f.detail}</span>
                <span className="ml-auto text-xs text-muted-foreground">{titleCase(f.source)} · {formatLagos(f.createdAt, 'date')}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
