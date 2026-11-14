import { Injectable } from '@nestjs/common';
import type { FacilityStatus } from '@damez/shared';
import type { LoanPortfolioPort, PerformanceRecord } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { buildQuote, readPricing } from './mappers';
import { BOOKED } from './state-machine';

const aad = (id: string, f: string) => `customer:${id}:${f}`;

/**
 * Phase-2 implementation of LOAN_PORTFOLIO_PORT: no ledger exists yet (prompt 3), so booked loans are derived from
 * applications in booked states + the frozen pricing snapshot + the amortization schedule. Prompt 3 replaces this
 * provider with the ledger-backed one without touching the consumers (bureau furnishing/monitoring, eligibility).
 */
@Injectable()
export class ApplicationLoanPortfolio implements LoanPortfolioPort {
  constructor(private prisma: PrismaService, private cipher: FieldCipher) {}

  async listActiveBorrowerIds(): Promise<string[]> {
    const rows = await this.prisma.loanApplication.findMany({ where: { status: { in: BOOKED } }, select: { customerId: true }, distinct: ['customerId'] });
    return rows.map((r) => r.customerId);
  }

  async listPerformance(period: string): Promise<PerformanceRecord[]> {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) throw new Error('period must be yyyy-mm');
    const periodEnd = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0, 23, 59, 59));
    const apps = await this.prisma.loanApplication.findMany({
      where: { status: { in: [...BOOKED, 'CLOSED', 'WRITTEN_OFF'] } }, include: { customer: true, product: true }, orderBy: { createdAt: 'asc' },
    });
    const out: PerformanceRecord[] = [];
    for (const a of apps) {
      const c = a.customer;
      if (!c.bvnEnc) continue; // cannot be furnished without a BVN
      const openedAt = a.decidedAt ?? a.submittedAt ?? a.createdAt;
      if (openedAt > periodEnd) continue;
      const pricing = readPricing(a.pricing);
      const principal = Number(a.requestedAmountKobo);
      const { schedule, cost } = buildQuote(pricing, principal, a.tenorMonths, openedAt);
      const elapsed = Math.max(0, Math.min(a.tenorMonths, (periodEnd.getUTCFullYear() - openedAt.getUTCFullYear()) * 12 + periodEnd.getUTCMonth() - openedAt.getUTCMonth()));
      let outstanding = elapsed === 0 ? principal : schedule[elapsed - 1].balanceKobo;
      // status changes only count once they happened by the period end
      const changedBy = a.updatedAt <= periodEnd;
      let dpd = 0;
      let status: FacilityStatus = 'PERFORMING';
      let closedAt: Date | null = null;
      let writtenOffAt: Date | null = null;
      if (a.status === 'CLOSED' && changedBy) { status = 'CLOSED'; outstanding = 0; closedAt = a.updatedAt; }
      else if (a.status === 'WRITTEN_OFF' && changedBy) { status = 'WRITTEN_OFF'; dpd = 120; writtenOffAt = a.updatedAt; }
      else if (a.status === 'Unpaid' && changedBy) { dpd = pricing.simulatedDpd ?? 35; status = dpd >= 90 ? 'DEFAULTED' : 'Unpaid'; }
      else if (elapsed >= a.tenorMonths) outstanding = 0;
      out.push({
        customerId: c.id, bvn: this.cipher.decrypt(c.bvnEnc, aad(c.id, 'bvn')), fullName: `${c.firstName} ${c.lastName}`,
        phone: this.cipher.decrypt(c.phoneEnc, aad(c.id, 'phone')), facilityRef: a.reference, productType: a.product.name, openedAt,
        amountGrantedKobo: principal, outstandingKobo: outstanding, monthlyPaymentKobo: cost.monthlyInstalmentKobo, tenorMonths: a.tenorMonths, dpd, status,
        lastPaymentAt: elapsed > 0 ? new Date(`${schedule[elapsed - 1].dueDate}T00:00:00Z`) : null, closedAt, writtenOffAt,
      });
    }
    return out;
  }

  async internalHistory(customerId: string) {
    const apps = await this.prisma.loanApplication.findMany({ where: { customerId, status: { in: [...BOOKED, 'CLOSED', 'WRITTEN_OFF'] } }, select: { status: true, pricing: true } });
    const Unpaid = apps.filter((a) => a.status === 'Unpaid');
    return {
      completedLoans: apps.filter((a) => a.status === 'CLOSED').length,
      lateInstalments: Unpaid.reduce((s, a) => s + (readPricing(a.pricing).simulatedLateInstalments ?? 2), 0),
      activeLoan: apps.some((a) => (BOOKED as string[]).includes(a.status)),
      writtenOff: apps.some((a) => a.status === 'WRITTEN_OFF'),
    };
  }
}
