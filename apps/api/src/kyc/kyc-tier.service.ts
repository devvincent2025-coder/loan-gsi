import { Injectable } from '@nestjs/common';
import { DEFAULT_TIER_LOAN_CAPS_KOBO, KycTier } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import type { KycTierPort } from '../contracts/ports';
import { PrismaService } from '../prisma/prisma.service';
import { getSetting } from './setting.util';

export interface TierFacts {
  phoneVerified: boolean;
  /** BVN verified AND names matched */
  bvnVerified: boolean;
  facePassed: boolean;
  ninVerified: boolean;
  govIdVerified: boolean;
  /** provider-verified address OR an approved proof-of-address document */
  addressVerified: boolean;
}

/** Cumulative CBN-style tiers (see packages/shared/src/kyc.ts). Pure so it is trivially testable. */
export function computeTier(f: TierFacts): KycTier {
  if (!(f.phoneVerified && f.bvnVerified)) return 0;
  if (!(f.facePassed && (f.ninVerified || f.govIdVerified))) return 1;
  return f.addressVerified ? 3 : 2;
}

@Injectable()
export class KycTierService implements KycTierPort {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async facts(customerId: string): Promise<TierFacts> {
    const [c, passed, poa] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
      this.prisma.kycVerification.findMany({ where: { customerId, status: 'PASSED' }, select: { type: true } }),
      this.prisma.kycDocument.count({ where: { customerId, kind: 'PROOF_OF_ADDRESS', reviewStatus: 'APPROVED', scanStatus: 'CLEAN', deletedAt: null } }),
    ]);
    const has = (t: string) => passed.some((p) => p.type === t);
    return {
      phoneVerified: !!c.phoneVerifiedAt,
      bvnVerified: !!c.bvnVerifiedAt && has('BVN'),
      facePassed: has('FACE'),
      ninVerified: !!c.ninVerifiedAt && has('NIN'),
      govIdVerified: has('GOV_ID'),
      addressVerified: has('ADDRESS') || poa > 0,
    };
  }

  /** Recompute from verifications, persist tier + kycStatus (VERIFIED at tier ≥1, REJECTED on a hard fail), return the tier. */
  async refreshTier(customerId: string): Promise<KycTier> {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const tier = computeTier(await this.facts(customerId));
    const [sanctionsHit, bvnFails, dupBvn] = await Promise.all([
      this.prisma.screeningResult.count({ where: { customerId, type: 'SANCTIONS', status: 'MATCH' } }),
      this.prisma.kycVerification.count({ where: { customerId, type: 'BVN', status: 'FAILED' } }),
      this.prisma.fraudSignal.count({ where: { customerId, type: 'DUPLICATE_BVN', resolvedAt: null } }),
    ]);
    const status = sanctionsHit > 0 ? 'REJECTED' : tier >= 1 ? 'VERIFIED' : bvnFails >= 3 || dupBvn > 0 ? 'REJECTED' : 'PENDING';
    if (tier !== c.kycTier || status !== c.kycStatus) {
      await this.prisma.customer.update({ where: { id: customerId }, data: { kycTier: tier, kycStatus: status } });
      await this.audit.record({
        action: 'kyc.tier_changed', resourceType: 'Customer', resourceId: customerId, branchId: c.branchId,
        before: { kycTier: c.kycTier, kycStatus: c.kycStatus }, after: { kycTier: tier, kycStatus: status },
      });
    }
    return tier;
  }

  /** Max loan (kobo) for a tier; setting kyc.tier_loan_caps, falling back to the shared defaults. Tier 0 may not borrow. */
  async maxLoanKobo(tier: number): Promise<number> {
    if (tier < 1) return 0;
    const caps = await getSetting<Record<string, number>>(this.prisma, 'kyc.tier_loan_caps', DEFAULT_TIER_LOAN_CAPS_KOBO);
    const v = Number(caps[String(Math.min(tier, 3))] ?? DEFAULT_TIER_LOAN_CAPS_KOBO[String(Math.min(tier, 3)) as '1' | '2' | '3']);
    return Number.isFinite(v) ? v : 0;
  }
}
