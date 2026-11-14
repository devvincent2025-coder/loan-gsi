import { Prisma } from '@prisma/client';
import { DebitEngineService } from './debit-engine.service';

/** Minimal in-memory stand-in for PrismaService, covering only what DebitEngineService.attemptDebit touches. */
class FakePrisma {
  loans = new Map<string, any>();
  installments = new Map<string, any>();
  customers = new Map<string, any>();
  linkedAccounts: any[] = [];
  mandates: any[] = [];
  debitAttempts: any[] = [];
  repayments: any[] = [];
  private nextId = 1;

  loan = {
    findUnique: async ({ where: { id } }: any) => this.loans.get(id) ?? null,
    update: async ({ where: { id }, data }: any) => {
      const row = this.loans.get(id);
      if (data.outstandingPrincipalKobo?.decrement !== undefined) row.outstandingPrincipalKobo -= data.outstandingPrincipalKobo.decrement;
      if (data.dpd !== undefined) row.dpd = data.dpd;
      return row;
    },
  };

  loanInstallment = {
    findUnique: async ({ where: { id } }: any) => this.installments.get(id) ?? null,
    update: async ({ where: { id }, data }: any) => {
      const row = this.installments.get(id);
      if (data.paidKobo?.increment !== undefined) row.paidKobo += data.paidKobo.increment;
      if (data.penaltyAccruedKobo?.decrement !== undefined) row.penaltyAccruedKobo -= data.penaltyAccruedKobo.decrement;
      if (data.status) row.status = data.status;
      if (data.paidAt) row.paidAt = data.paidAt;
      return row;
    },
  };

  customer = { findUnique: async ({ where: { id } }: any) => this.customers.get(id) ?? null };
  linkedAccount = { findMany: async ({ where }: any) => this.linkedAccounts.filter((a) => a.customerId === where.customerId && (!where.status || a.status === where.status)).sort((a, b) => a.priority - b.priority) };
  mandate = {
    findFirst: async ({ where }: any) => this.mandates.filter((m) => m.customerId === where.customerId && m.status === where.status && where.type.in.includes(m.type)).sort((a, b) => a.priority - b.priority)[0] ?? null,
  };

  debitAttempt = {
    findUnique: async ({ where }: any) => {
      if (where.idempotencyKey) return this.debitAttempts.find((d) => d.idempotencyKey === where.idempotencyKey) ?? null;
      if (where.id) return this.debitAttempts.find((d) => d.id === where.id) ?? null;
      return null;
    },
    count: async ({ where }: any) => this.debitAttempts.filter((d) => d.loanId === where.loanId && d.installmentId === where.installmentId).length,
    create: async ({ data }: any) => {
      if (this.debitAttempts.some((d) => d.idempotencyKey === data.idempotencyKey)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on idempotencyKey', { code: 'P2002', clientVersion: '6.0.0' });
      }
      const row = { id: `da${this.nextId++}`, ...data };
      this.debitAttempts.push(row);
      return row;
    },
    update: async ({ where: { id }, data }: any) => {
      const row = this.debitAttempts.find((d) => d.id === id);
      Object.assign(row, data);
      return row;
    },
  };

  repayment = {
    findFirst: async () => null,
    create: async ({ data }: any) => {
      const row = { id: `rp${this.nextId++}`, ...data };
      this.repayments.push(row);
      return row;
    },
    update: async ({ where: { id }, data }: any) => {
      const row = this.repayments.find((r) => r.id === id);
      Object.assign(row, data);
      return row;
    },
  };

  async $transaction(cb: (tx: this) => Promise<unknown>) { return cb(this); }
}

function buildEngine(fake: FakePrisma, mandatePort: { debit: jest.Mock }) {
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const cipher = { decrypt: (v: string) => v, encrypt: (v: string) => v };
  const queue = { register: jest.fn(), schedule: jest.fn(), enqueue: jest.fn() };
  const env = { AUTODEBIT_RETRY_LADDER: 'DUE_AM,DUE_PM,DAY_PLUS_1,DAY_PLUS_3,DAY_PLUS_7_GSI' };
  const ledgerPort = { post: jest.fn().mockResolvedValue({ id: 'je1', reference: 'JE-1' }) };
  const gsiPort = { trigger: jest.fn() };
  return new DebitEngineService(fake as any, queue as any, notifications as any, cipher as any, env as any, mandatePort as any, gsiPort as any, ledgerPort as any);
}

describe('DebitEngineService.attemptDebit idempotency', () => {
  it('processes a (loanId, installmentId, retryStage) exactly once even if called twice', async () => {
    const fake = new FakePrisma();
    fake.loans.set('loan1', { id: 'loan1', customerId: 'cust1', reference: 'LN-1', outstandingPrincipalKobo: 100_000n, dpd: 0, customer: { id: 'cust1', phoneEnc: null, phoneVerifiedAt: null } });
    fake.installments.set('inst1', { id: 'inst1', loanId: 'loan1', feeKobo: 0n, interestKobo: 0n, principalKobo: 5000n, totalKobo: 5000n, paidKobo: 0n, penaltyAccruedKobo: 0n, status: 'PENDING' });
    fake.mandates.push({ id: 'mand1', customerId: 'cust1', type: 'NIBSS_EMANDATE', status: 'ACTIVE', providerRef: 'NIBSS-REF-1', priority: 0, linkedAccountId: null });

    const debit = jest.fn().mockResolvedValue({ status: 'SUCCESS', collectedKobo: 5000 });
    const engine = buildEngine(fake, { debit });

    const job = { loanId: 'loan1', installmentId: 'inst1', retryStage: 'DUE_AM' };
    const first = await engine.attemptDebit(job);
    const second = await engine.attemptDebit(job);

    expect(first?.status).toBe('SUCCESS');
    expect(second).toEqual(first);
    expect(debit).toHaveBeenCalledTimes(1); // the second call short-circuited on the existing DebitAttempt, no re-charge
    expect(fake.debitAttempts).toHaveLength(1);
    expect(fake.installments.get('inst1').status).toBe('PAID');
    expect(fake.installments.get('inst1').paidKobo).toBe(5000n);
    expect(fake.loans.get('loan1').outstandingPrincipalKobo).toBe(95_000n);
    expect(fake.repayments).toHaveLength(1);
    expect(fake.repayments[0].method).toBe('AUTODEBIT_MANDATE');
  });

  it('a concurrent creator that wins the unique-constraint race is treated as "already processed", not an error', async () => {
    const fake = new FakePrisma();
    fake.loans.set('loan1', { id: 'loan1', customerId: 'cust1', reference: 'LN-1', outstandingPrincipalKobo: 100_000n, dpd: 0, customer: { id: 'cust1', phoneEnc: null, phoneVerifiedAt: null } });
    fake.installments.set('inst1', { id: 'inst1', loanId: 'loan1', feeKobo: 0n, interestKobo: 0n, principalKobo: 5000n, totalKobo: 5000n, paidKobo: 0n, penaltyAccruedKobo: 0n, status: 'PENDING' });
    fake.mandates.push({ id: 'mand1', customerId: 'cust1', type: 'NIBSS_EMANDATE', status: 'ACTIVE', providerRef: 'NIBSS-REF-1', priority: 0, linkedAccountId: null });
    const debit = jest.fn().mockResolvedValue({ status: 'SUCCESS', collectedKobo: 5000 });
    const engine = buildEngine(fake, { debit });
    const job = { loanId: 'loan1', installmentId: 'inst1', retryStage: 'DUE_AM' };
    const idempotencyKey = `debit:${job.loanId}:${job.installmentId}:${job.retryStage}`;

    // Simulate another worker having already written the row concurrently: the pre-check (first findUnique call)
    // still sees nothing, but create() hits the real unique constraint because the row exists by the time it runs.
    const originalFindUnique = fake.debitAttempt.findUnique.bind(fake.debitAttempt);
    let findCalls = 0;
    fake.debitAttempt.findUnique = (async (args: any) => {
      findCalls++;
      if (findCalls === 1) return null;
      return originalFindUnique(args);
    }) as any;
    fake.debitAttempts.push({ id: 'da-concurrent', loanId: job.loanId, installmentId: job.installmentId, idempotencyKey, status: 'SUCCESS', collectedKobo: 5000n, amountKobo: 5000n });

    const result = await engine.attemptDebit(job);
    expect(result).toEqual({ id: 'da-concurrent', status: 'SUCCESS' });
    expect(debit).toHaveBeenCalledTimes(1); // it still computed a debit attempt before discovering the race, but never double-applies a collection
    expect(fake.repayments).toHaveLength(0); // the losing attempt's result was discarded, not applied
    expect(fake.debitAttempts).toHaveLength(1);
  });

  it('records a FAILED attempt (no repayment, no ledger post) when there is no active mandate', async () => {
    const fake = new FakePrisma();
    fake.loans.set('loan1', { id: 'loan1', customerId: 'cust1', reference: 'LN-1', outstandingPrincipalKobo: 100_000n, dpd: 0, customer: { id: 'cust1', phoneEnc: null, phoneVerifiedAt: null } });
    fake.installments.set('inst1', { id: 'inst1', loanId: 'loan1', feeKobo: 0n, interestKobo: 0n, principalKobo: 5000n, totalKobo: 5000n, paidKobo: 0n, penaltyAccruedKobo: 0n, status: 'PENDING' });
    const debit = jest.fn();
    const engine = buildEngine(fake, { debit });
    const result = await engine.attemptDebit({ loanId: 'loan1', installmentId: 'inst1', retryStage: 'DUE_AM' });
    expect(result?.status).toBe('FAILED');
    expect(debit).not.toHaveBeenCalled();
    expect(fake.repayments).toHaveLength(0);
    expect(fake.installments.get('inst1').status).toBe('PENDING');
  });
});
