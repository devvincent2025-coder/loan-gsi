import { Injectable, NotFoundException } from '@nestjs/common';
import type { FraudSignal } from '@prisma/client';
import type { FraudSignalDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import type { FraudPort } from '../contracts/ports';
import { loadScopedCustomer } from '../kyc/customer-access';
import { fraudDto } from '../kyc/mappers';
import { getSetting } from '../kyc/setting.util';
import { PrismaService } from '../prisma/prisma.service';

type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
const RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export const DEFAULT_VELOCITY = { registrationsPerDevice24h: 3, applicationsPerCustomer24h: 3, registrationsPerIp1h: 5 };

@Injectable()
export class FraudService implements FraudPort {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * Raise a signal. De-duplicated: an OPEN signal with the same customer + type + related customer is reused
   * (and its severity is raised if the new one is worse), so retries never spam the review queue.
   */
  async raise(
    customerId: string, type: FraudSignalDto['type'], severity: Severity, detail: string,
    opts: { relatedCustomerId?: string | null; applicationId?: string | null } = {},
  ): Promise<FraudSignal> {
    const related = opts.relatedCustomerId ?? null;
    const open = await this.prisma.fraudSignal.findFirst({ where: { customerId, type, relatedCustomerId: related, resolvedAt: null } });
    if (open) {
      if (RANK[severity] > RANK[open.severity as Severity]) {
        return this.prisma.fraudSignal.update({ where: { id: open.id }, data: { severity, detail } });
      }
      return open;
    }
    const s = await this.prisma.fraudSignal.create({ data: { customerId, type, severity, detail, relatedCustomerId: related, applicationId: opts.applicationId ?? null } });
    await this.audit.record({ action: 'fraud.signal_raised', resourceType: 'FraudSignal', resourceId: s.id, after: { customerId, type, severity, relatedCustomerId: related } });
    return s;
  }

  async unresolvedCounts(customerId: string): Promise<{ high: number; medium: number; low: number }> {
    const rows = await this.prisma.fraudSignal.groupBy({ by: ['severity'], where: { customerId, resolvedAt: null }, _count: { _all: true } });
    const n = (s: string) => rows.find((r) => r.severity === s)?._count._all ?? 0;
    return { high: n('HIGH'), medium: n('MEDIUM'), low: n('LOW') };
  }

  async list(customerId: string): Promise<FraudSignalDto[]> {
    const rows = await this.prisma.fraudSignal.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    return rows.map(fraudDto);
  }

  async listFor(user: AuthUser, customerId: string): Promise<FraudSignalDto[]> {
    await loadScopedCustomer(this.prisma, user, customerId);
    return this.list(customerId);
  }

  async resolve(user: AuthUser, id: string, note: string): Promise<FraudSignalDto> {
    const s = await this.prisma.fraudSignal.findUnique({ where: { id }, include: { customer: true } });
    if (!s) throw new NotFoundException('Signal not found');
    await loadScopedCustomer(this.prisma, user, s.customerId);
    const r = await this.prisma.fraudSignal.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: user.id, resolutionNote: note } });
    await this.audit.record({
      action: 'fraud.signal_resolved', resourceType: 'FraudSignal', resourceId: id, branchId: s.customer.branchId,
      before: { resolved: false }, after: { resolved: true, note }, metadata: { customerId: s.customerId, type: s.type },
    });
    return fraudDto(r);
  }

  /** Duplicate identity checks, all by blind index / hash (no decryption). Safe to run repeatedly. */
  async scanDuplicates(customerId: string): Promise<void> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c) return;
    const others = async (where: object) => this.prisma.customer.findMany({ where: { ...where, id: { not: customerId }, erasedAt: null }, select: { id: true }, take: 5 });
    if (c.bvnHash) for (const o of await others({ bvnHash: c.bvnHash })) await this.both(c.id, o.id, 'DUPLICATE_BVN', 'HIGH', 'The same BVN is registered to another customer');
    if (c.ninHash) for (const o of await others({ ninHash: c.ninHash })) await this.both(c.id, o.id, 'DUPLICATE_NIN', 'HIGH', 'The same NIN is registered to another customer');
    for (const o of await others({ phoneHash: c.phoneHash })) await this.both(c.id, o.id, 'DUPLICATE_PHONE', 'MEDIUM', 'The same phone number is registered to another customer');
    if (c.bvnPhotoHash) {
      // same BVN photo under two different BVNs = one face, several identities
      for (const o of await others({ bvnPhotoHash: c.bvnPhotoHash })) await this.both(c.id, o.id, 'DUPLICATE_FACE', 'HIGH', 'The BVN photo matches another customer with a different BVN');
    }
    await this.checkSharedDevice(customerId);
  }

  private async both(a: string, b: string, type: FraudSignalDto['type'], sev: Severity, detail: string): Promise<void> {
    await this.raise(a, type, sev, detail, { relatedCustomerId: b });
    await this.raise(b, type, sev, detail, { relatedCustomerId: a });
  }

  /** Public so the BVN/NIN steps can raise the pair the moment a clash is detected. */
  raisePair(a: string, b: string, type: FraudSignalDto['type'], sev: Severity, detail: string): Promise<void> { return this.both(a, b, type, sev, detail); }

  async checkSharedDevice(customerId: string): Promise<void> {
    const devices = await this.prisma.deviceFingerprint.findMany({ where: { customerId }, select: { fingerprint: true } });
    for (const d of devices) {
      const others = await this.prisma.deviceFingerprint.findMany({ where: { fingerprint: d.fingerprint, customerId: { not: customerId } }, select: { customerId: true }, distinct: ['customerId'], take: 10 });
      if (others.length >= 2) {
        await this.raise(customerId, 'SHARED_DEVICE', others.length >= 4 ? 'HIGH' : 'MEDIUM', `This device has also been used by ${others.length} other customers`, { relatedCustomerId: others[0].customerId });
      }
    }
  }

  /** Record the device seen at login and run device + registration velocity checks. */
  async recordDevice(customerId: string, fingerprint: string | null | undefined, ip: string | null, userAgent: string | null): Promise<void> {
    if (fingerprint) {
      await this.prisma.deviceFingerprint.upsert({
        where: { customerId_fingerprint: { customerId, fingerprint } },
        create: { customerId, fingerprint, ip, userAgent }, update: { lastSeenAt: new Date(), ip, userAgent },
      });
      await this.checkSharedDevice(customerId);
    }
    await this.checkRegistrationVelocity(customerId, fingerprint ?? null, ip);
  }

  async checkRegistrationVelocity(customerId: string, fingerprint: string | null, ip: string | null): Promise<void> {
    const v = { ...DEFAULT_VELOCITY, ...(await getSetting<Partial<typeof DEFAULT_VELOCITY>>(this.prisma, 'fraud.velocity', DEFAULT_VELOCITY)) };
    if (fingerprint) {
      const since = new Date(Date.now() - 24 * 3600_000);
      const n = (await this.prisma.deviceFingerprint.findMany({ where: { fingerprint, firstSeenAt: { gte: since } }, select: { customerId: true }, distinct: ['customerId'] })).length;
      if (n > v.registrationsPerDevice24h) await this.raise(customerId, 'VELOCITY_REGISTRATION', 'MEDIUM', `${n} accounts were registered from this device in 24 hours`);
    }
    if (ip) {
      const since = new Date(Date.now() - 3600_000);
      const n = (await this.prisma.otpChallenge.findMany({ where: { purpose: { startsWith: 'REGISTER' }, ip, createdAt: { gte: since }, customerId: { not: null } }, select: { customerId: true }, distinct: ['customerId'] })).length;
      if (n > v.registrationsPerIp1h) await this.raise(customerId, 'VELOCITY_REGISTRATION', 'MEDIUM', `${n} accounts were registered from this network in one hour`);
    }
  }

  /** FraudPort: velocity + duplicate checks when an application is submitted. */
  async onApplicationSubmitted(customerId: string, applicationId: string): Promise<void> {
    const v = { ...DEFAULT_VELOCITY, ...(await getSetting<Partial<typeof DEFAULT_VELOCITY>>(this.prisma, 'fraud.velocity', DEFAULT_VELOCITY)) };
    const n = await this.prisma.loanApplication.count({ where: { customerId, submittedAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    if (n > v.applicationsPerCustomer24h) await this.raise(customerId, 'VELOCITY_APPLICATION', 'MEDIUM', `${n} applications were submitted in 24 hours`, { applicationId });
    await this.scanDuplicates(customerId);
  }

  /** Staff-triggered re-scan. */
  async scan(user: AuthUser, customerId: string): Promise<FraudSignalDto[]> {
    const c = await loadScopedCustomer(this.prisma, user, customerId);
    await this.scanDuplicates(customerId);
    await this.audit.record({ action: 'fraud.scan_run', resourceType: 'Customer', resourceId: customerId, branchId: c.branchId });
    return this.list(customerId);
  }
}
