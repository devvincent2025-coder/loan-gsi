import { Controller, Global, HttpCode, Inject, Injectable, Module, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { ScreeningDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { APP_ENV, AppEnv } from '../config/config.module';
import { CustomerPii } from '../kyc/customer-pii';
import { loadScopedCustomer } from '../kyc/customer-access';
import { screeningDto } from '../kyc/mappers';
import { getSetting } from '../kyc/setting.util';
import { PrismaService } from '../prisma/prisma.service';

export const SCREENING_PROVIDER = Symbol('SCREENING_PROVIDER');

export interface ScreeningSubject { firstName: string; lastName: string; dateOfBirth?: string | null; bvn?: string | null }
export interface ScreeningOutcome {
  type: 'SANCTIONS' | 'PEP';
  status: 'CLEAR' | 'MATCH' | 'REVIEW';
  matchCount: number;
  reference: string;
  /** non-PII: which list matched */
  details?: Record<string, unknown>;
}
export interface ScreeningProvider {
  readonly name: string;
  screen(subject: ScreeningSubject): Promise<ScreeningOutcome[]>;
}

export class ScreeningNotConfiguredError extends Error {
  constructor() { super('Screening is not configured (missing API keys)'); this.name = 'ScreeningNotConfiguredError'; }
}
export class ScreeningProviderError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = 'ScreeningProviderError'; }
}

type Json = Record<string, unknown>;

/**
 * Dojah AML v2 screening (https://docs.dojah.io/api-reference/aml-background/aml-screening), confirmed against the
 * public docs on 2026-10-11. Covers PEP + sanctions lists (UN/OFAC/etc — whichever Dojah's "all watchlists" default
 * covers; not independently confirmed which specific lists are included). One call screens both PEP and sanctions;
 * adverse-media is deliberately left off since our `ScreeningOutcome` model has no slot for it and we don't want to
 * silently drop a signal that should have somewhere to live.
 *
 * `POST /api/v1/aml/v2/screening` -> entity.{match_status, results: [{source_type: 'PEP'|'Sanctions'|'Warning', match}]}.
 * TODO(dojah): the docs don't give a per-type confidence/partial-match signal at this endpoint (only the overall
 * `match_status` and a boolean `match` per result) — REVIEW is inferred from the overall match_status rather than a
 * documented per-type score. Confirm against `GET /api/v2/aml/screening/info?profile_id=` (per-result `match_score`)
 * once sandbox access is available, and tighten this if a better signal turns out to exist.
 */
export class DojahScreeningProvider implements ScreeningProvider {
  readonly name = 'dojah';
  constructor(private env: AppEnv) {}

  private get base(): string { return this.env.DOJAH_BASE_URL.replace(/\/$/, ''); }
  private get headers(): Record<string, string> {
    if (!this.env.DOJAH_SECRET_KEY || !this.env.DOJAH_APP_ID) throw new ScreeningNotConfiguredError();
    return { Authorization: this.env.DOJAH_SECRET_KEY, AppId: this.env.DOJAH_APP_ID, 'Content-Type': 'application/json' };
  }

  async screen(s: ScreeningSubject): Promise<ScreeningOutcome[]> {
    const headers = this.headers;
    const body = {
      schema: 'individual',
      properties: { names: `${s.firstName} ${s.lastName}`.trim(), ...(s.dateOfBirth ? { date_of_birth: s.dateOfBirth } : {}) },
      screening_options: { pep_check: true, sanction: true, adverse_media_check: false },
    };
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/v1/aml/v2/screening`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new ScreeningProviderError(`Dojah screening request failed: ${(e as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as Json;
    if (res.status >= 500 || res.status === 401 || res.status === 403 || res.status === 429) throw new ScreeningProviderError(`Dojah screening responded ${res.status}`, res.status);
    if (!res.ok) throw new ScreeningProviderError(`Dojah screening returned ${res.status}`);
    return this.mapOutcomes(json);
  }

  private mapOutcomes(json: Json): ScreeningOutcome[] {
    const entity = (json.entity ?? {}) as Json;
    const reference = String(entity.entity_id ?? `dojah_scr_${Date.now().toString(36)}`);
    const results = Array.isArray(entity.results) ? (entity.results as Json[]) : [];
    const overallStatus = String(entity.match_status ?? '').toLowerCase();
    const ambiguous = /partial|potential/.test(overallStatus);

    const outcomeFor = (type: ScreeningOutcome['type'], sourceTypes: string[]): ScreeningOutcome => {
      const matches = results.filter((r) => sourceTypes.includes(String(r.source_type)));
      const hits = matches.filter((r) => r.match === true);
      const status: ScreeningOutcome['status'] = hits.length > 0 ? 'MATCH' : ambiguous && matches.length > 0 ? 'REVIEW' : 'CLEAR';
      return { type, status, matchCount: hits.length, reference, details: { lists: [...new Set(matches.map((r) => String(r.source_type)))] } };
    };
    return [outcomeFor('SANCTIONS', ['Sanctions', 'Warning']), outcomeFor('PEP', ['PEP'])];
  }
}

@Injectable()
export class ScreeningService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private pii: CustomerPii,
    @Inject(SCREENING_PROVIDER) private provider: ScreeningProvider,
  ) {}

  /** Runs when setting screening.enabled is true (after BVN verification). Failures never block onboarding: they are audited. */
  async runIfEnabled(customerId: string): Promise<void> {
    if (!(await getSetting(this.prisma, 'screening.enabled', true))) return;
    try { await this.run(customerId); } catch (e) {
      await this.audit.record({ action: 'screening.failed', resourceType: 'Customer', resourceId: customerId, outcome: 'FAILURE', metadata: { error: (e as Error).message.slice(0, 200) } });
    }
  }

  async run(customerId: string): Promise<ScreeningDto[]> {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const subject: ScreeningSubject = { firstName: c.firstName, lastName: c.lastName, dateOfBirth: this.pii.dec(c.id, 'dob', c.dobEnc), bvn: this.pii.dec(c.id, 'bvn', c.bvnEnc) };
    let outcomes: ScreeningOutcome[];
    try {
      outcomes = await this.provider.screen(subject);
    } catch (e) {
      if (e instanceof ScreeningNotConfiguredError) throw new ServiceUnavailableException({ message: 'Screening is not available right now', code: 'NOT_CONFIGURED' });
      if (e instanceof ScreeningProviderError) throw new ServiceUnavailableException({ message: 'Our screening partner is busy. Please try again shortly', code: 'SCREENING_UNAVAILABLE' });
      throw e;
    }
    const rows = [];
    for (const o of outcomes) {
      rows.push(await this.prisma.screeningResult.create({
        data: { customerId, type: o.type, provider: this.provider.name, status: o.status, matchCount: o.matchCount, reference: o.reference, details: (o.details ?? {}) as object },
      }));
      if (o.status !== 'CLEAR') await this.flag(customerId, o);
    }
    await this.audit.record({
      action: 'screening.run', resourceType: 'Customer', resourceId: customerId, branchId: c.branchId,
      metadata: { results: outcomes.map((o) => `${o.type}:${o.status}`) },
    });
    return rows.map(screeningDto);
  }

  /** FraudSignalDto has no sanctions/PEP type, so hits become CustomerRiskFlag(FRAUD_WATCHLIST, INTERNAL): HIGH for sanctions, MEDIUM for PEP. */
  private async flag(customerId: string, o: ScreeningOutcome): Promise<void> {
    const detail = o.type === 'SANCTIONS' ? 'Sanctions list match (needs compliance review)' : 'Politically exposed person match (enhanced due diligence)';
    const exists = await this.prisma.customerRiskFlag.findFirst({ where: { customerId, type: 'FRAUD_WATCHLIST', source: 'INTERNAL', detail, active: true } });
    if (!exists) await this.prisma.customerRiskFlag.create({ data: { customerId, type: 'FRAUD_WATCHLIST', source: 'INTERNAL', severity: o.type === 'SANCTIONS' ? 'HIGH' : 'MEDIUM', detail } });
  }

  async runFor(user: AuthUser, customerId: string): Promise<ScreeningDto[]> {
    await loadScopedCustomer(this.prisma, user, customerId);
    return this.run(customerId);
  }
}

@Controller()
class ScreeningController {
  constructor(private svc: ScreeningService) {}
  @Post('customers/:id/screening/run') @HttpCode(200) @RequirePermission('screening:run')
  run(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.runFor(u, id); }
}

@Global()
@Module({
  controllers: [ScreeningController],
  providers: [
    { provide: SCREENING_PROVIDER, inject: [APP_ENV], useFactory: (env: AppEnv): ScreeningProvider => new DojahScreeningProvider(env) },
    ScreeningService,
  ],
  exports: [ScreeningService],
})
export class ScreeningModule {}
