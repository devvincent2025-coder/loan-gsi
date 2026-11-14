import { BadRequestException } from '@nestjs/common';
import { UnderwritingService } from './underwriting.service';

const app = { id: 'app1', reference: 'APP-2026-000001', customerId: 'cust1', branchId: 'br1', status: 'UNDER_REVIEW', requestedAmountKobo: 500_000_00n, tenorMonths: 6 };

function build() {
  const notes: Record<string, unknown>[] = [];
  const prisma = {
    underwritingNote: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `n${notes.length + 1}`, createdAt: new Date(), ...data }; notes.push(row); return row; }),
      findMany: jest.fn(async () => notes),
    },
    loanApplication: { findUnique: jest.fn(async () => null), update: jest.fn(async () => undefined) },
    customer: { findUnique: jest.fn(async () => ({ phoneEnc: 'enc', phoneVerifiedAt: new Date() })) },
    staffUser: { findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, fullName: `Staff ${id}` }))) },
    inAppNotification: { createMany: jest.fn(async () => undefined) },
  };
  const audit = { record: jest.fn(async () => undefined) };
  const transitions = { apply: jest.fn(async () => undefined) };
  const registry = { register: jest.fn(), get: jest.fn() };
  const approvals = { submit: jest.fn(async () => ({ id: 'appr1' })) };
  const apps = { getForStaff: jest.fn(async () => app), detail: jest.fn(async () => ({ id: app.id })) };
  const notifications = { send: jest.fn(async () => ({})) };
  const cipher = { decrypt: jest.fn(() => '08030000000') };
  const offers = { createOffer: jest.fn(async () => ({ id: 'off1', offerNumber: 'OFR-1' })) };

  const user = { id: 'staff1', fullName: 'Officer One', permissions: new Set(['underwriting:decide']), branchId: 'br1' } as never;
  const svc = new UnderwritingService(prisma as never, audit as never, transitions as never, registry as never, approvals as never, apps as never, notifications as never, cipher as never, offers as never);
  return { svc, prisma, audit, transitions, registry, approvals, apps, notifications, cipher, offers, user, notes };
}

describe('UnderwritingService', () => {
  it('registers the real LOAN_APPROVAL handler on module init, with the documented submit permission', () => {
    const { svc, registry } = build();
    svc.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(expect.objectContaining({ type: 'LOAN_APPROVAL', submitPermission: 'underwriting:decide' }));
  });

  it('APPROVE submits a LOAN_APPROVAL approval request and records a DECISION note, without transitioning directly', async () => {
    const { svc, approvals, transitions, user, notes } = build();
    await svc.decide(user, 'app1', { action: 'APPROVE', reason: 'Looks good' });
    expect(approvals.submit).toHaveBeenCalledWith(user, expect.objectContaining({
      type: 'LOAN_APPROVAL', amountKobo: 500_000_00, payload: { applicationId: 'app1', amountKobo: 500_000_00, tenorMonths: 6 },
    }));
    expect(transitions.apply).not.toHaveBeenCalled();
    expect(notes.some((n) => n.kind === 'DECISION')).toBe(true);
  });

  it('APPROVE honours a staff-overridden amount/tenor', async () => {
    const { svc, approvals, user } = build();
    await svc.decide(user, 'app1', { action: 'APPROVE', amountKobo: 300_000_00, tenorMonths: 3 });
    expect(approvals.submit).toHaveBeenCalledWith(user, expect.objectContaining({ amountKobo: 300_000_00, payload: { applicationId: 'app1', amountKobo: 300_000_00, tenorMonths: 3 } }));
  });

  it('REJECT requires a reason', async () => {
    const { svc, user } = build();
    await expect(svc.decide(user, 'app1', { action: 'REJECT' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECT transitions the application directly (no maker-checker) and records a DECISION note', async () => {
    const { svc, transitions, approvals, notes, user } = build();
    await svc.decide(user, 'app1', { action: 'REJECT', reason: 'Fails policy' });
    expect(transitions.apply).toHaveBeenCalledWith('app1', 'REJECTED', expect.objectContaining({ type: 'STAFF', id: 'staff1' }), { reason: 'Fails policy' });
    expect(approvals.submit).not.toHaveBeenCalled();
    expect(notes.some((n) => n.kind === 'DECISION' && (n.body as string).includes('Fails policy'))).toBe(true);
  });

  it('REFER requires at least one assignee', async () => {
    const { svc, user } = build();
    await expect(svc.decide(user, 'app1', { action: 'REFER', reason: 'Needs a second look' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REFER assigns the application to the first staff member, notifies every assignee, and logs a NOTE naming them all', async () => {
    const { svc, transitions, approvals, offers, notes, prisma, user } = build();
    await svc.decide(user, 'app1', { action: 'REFER', reason: 'Needs a second look', assigneeIds: ['staff2', 'staff3'] });
    expect(transitions.apply).not.toHaveBeenCalled();
    expect(approvals.submit).not.toHaveBeenCalled();
    expect(offers.createOffer).not.toHaveBeenCalled();
    expect(prisma.loanApplication.update).toHaveBeenCalledWith({ where: { id: 'app1' }, data: { assignedToId: 'staff2' } });
    expect(prisma.inAppNotification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'staff2', href: '/applications/app1' }),
        expect.objectContaining({ userId: 'staff3', href: '/applications/app1' }),
      ],
    });
    expect(notes.some((n) => n.kind === 'NOTE' && (n.body as string).includes('Staff staff2') && (n.body as string).includes('Staff staff3'))).toBe(true);
  });

  it('REQUEST_INFO logs a REQUEST_INFO note and texts the customer\'s verified phone', async () => {
    const { svc, notifications, notes, user } = build();
    await svc.decide(user, 'app1', { action: 'REQUEST_INFO', reason: 'Please upload a payslip' });
    expect(notes.some((n) => n.kind === 'REQUEST_INFO')).toBe(true);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'SMS' }));
  });

  it('COUNTER_OFFER requires amountKobo and tenorMonths', async () => {
    const { svc, user } = build();
    await expect(svc.decide(user, 'app1', { action: 'COUNTER_OFFER' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('COUNTER_OFFER creates a new offer via OffersService and logs a NOTE, without touching the application status', async () => {
    const { svc, offers, transitions, notes, user } = build();
    await svc.decide(user, 'app1', { action: 'COUNTER_OFFER', amountKobo: 400_000_00, tenorMonths: 9, note: 'Reduced amount' });
    expect(offers.createOffer).toHaveBeenCalledWith(user, 'app1', expect.objectContaining({ principalKobo: 400_000_00, tenorMonths: 9, isCounterOffer: true }));
    expect(transitions.apply).not.toHaveBeenCalled();
    expect(notes.some((n) => n.kind === 'NOTE' && (n.body as string).includes('OFR-1'))).toBe(true);
  });
});
