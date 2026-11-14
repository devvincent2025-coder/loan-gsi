import { DisbursementService } from './disbursement.service';

/** Minimal in-memory fake: only the Prisma delegates/methods completeDisbursement() touches. */
function setup() {
  const dr = {
    id: 'dr1', loanId: 'loan1', linkedAccountId: 'la1', amountKobo: 500_000_00n, provider: 'mock', method: 'AUTOMATED' as const,
    status: 'PROCESSING' as string, idempotencyKey: 'disb:app1', providerRef: null as string | null, failureReason: null as string | null,
    retryCount: 0, completedAt: null as Date | null,
    loan: { id: 'loan1', reference: 'LN-2026-000001', applicationId: 'app1' },
  };
  const postings: { sourceType: string; loanId: string | null; postings: { accountCode: string; side: string; amountKobo: number }[] }[] = [];
  const auditRecords: Record<string, unknown>[] = [];

  const disbursementRequest = {
    findUnique: jest.fn(async () => ({ ...dr })),
    findFirst: jest.fn(async () => ({ ...dr })),
    updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: { not: string } }; data: Record<string, unknown> }) => {
      if (dr.status === where.status.not) return { count: 0 };
      Object.assign(dr, data);
      return { count: 1 };
    }),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(dr, data); return { ...dr }; }),
    findUniqueOrThrow: jest.fn(async () => ({ ...dr })),
  };
  const loan = { update: jest.fn(async () => ({ id: 'loan1', status: 'ACTIVE' })) };
  const prisma: { disbursementRequest: typeof disbursementRequest; loan: typeof loan; $transaction: jest.Mock } = {
    disbursementRequest,
    loan,
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  const audit = { record: jest.fn(async (entry: Record<string, unknown>) => { auditRecords.push(entry); }) };
  const ledger = {
    post: jest.fn(async (input: { sourceType: string; loanId?: string | null; postings: { accountCode: string; side: string; amountKobo: number }[] }) => {
      postings.push({ sourceType: input.sourceType, loanId: input.loanId ?? null, postings: input.postings });
      return { id: 'je1', reference: 'JE-000001' };
    }),
    reverse: jest.fn(), accountBalance: jest.fn(), loanOutstanding: jest.fn(),
  };
  const transitions = { apply: jest.fn(async () => undefined) };

  const svc = new DisbursementService(
    prisma as never, audit as never, {} as never, {} as never, transitions as never, {} as never,
    { register: jest.fn(), get: jest.fn() } as never, {} as never, { register: jest.fn(), schedule: jest.fn() } as never,
    { DISBURSEMENT_MAX_RETRIES: 3 } as never, { ensureFreshForDisbursement: jest.fn() } as never, ledger as never,
  );
  return { svc, dr, postings, auditRecords, transitions, ledger };
}

describe('DisbursementService.completeDisbursement', () => {
  it('posts a balanced DISBURSEMENT journal entry and marks the request SUCCESS', async () => {
    const { svc, dr, postings } = setup();
    const result = await svc.completeDisbursement('dr1', 'prov_ref_1');
    expect(result).toEqual({ loanId: 'loan1', alreadyDone: false });
    expect(dr.status).toBe('SUCCESS');
    expect(dr.providerRef).toBe('prov_ref_1');
    expect(postings).toHaveLength(1);
    expect(postings[0].sourceType).toBe('DISBURSEMENT');
    expect(postings[0].loanId).toBe('loan1');
    const debit = postings[0].postings.find((p) => p.side === 'DEBIT');
    const credit = postings[0].postings.find((p) => p.side === 'CREDIT');
    expect(debit?.accountCode).toBe('1100');
    expect(credit?.accountCode).toBe('1000');
    expect(debit?.amountKobo).toBe(credit?.amountKobo); // balanced entry
    expect(debit?.amountKobo).toBe(50_000_000);
  });

  it('advances the application DISBURSED then ACTIVE exactly once', async () => {
    const { svc, transitions } = setup();
    await svc.completeDisbursement('dr1', 'prov_ref_1');
    expect(transitions.apply).toHaveBeenNthCalledWith(1, 'app1', 'DISBURSED', expect.objectContaining({ type: 'SYSTEM' }));
    expect(transitions.apply).toHaveBeenNthCalledWith(2, 'app1', 'ACTIVE', expect.objectContaining({ type: 'SYSTEM' }));
  });

  it('is idempotent: a second call (webhook replay / retry race) is a no-op', async () => {
    const { svc, postings, transitions } = setup();
    await svc.completeDisbursement('dr1', 'prov_ref_1');
    const second = await svc.completeDisbursement('dr1', 'prov_ref_1');
    expect(second).toEqual({ loanId: 'loan1', alreadyDone: true });
    expect(postings).toHaveLength(1); // ledger entry posted only once
    expect(transitions.apply).toHaveBeenCalledTimes(2); // not re-called on the second, idempotent pass
  });
});

describe('DisbursementService.handleWebhook', () => {
  it('ignores a terminal (SUCCESS) disbursement on a replayed webhook', async () => {
    const { svc, dr } = setup();
    dr.status = 'SUCCESS';
    const provider = { verifyWebhookSignature: () => true };
    (svc as unknown as { providers: { forName: () => typeof provider } }).providers = { forName: () => provider };
    const res = await svc.handleWebhook('paystack', Buffer.from(JSON.stringify({ event: 'transfer.success', data: { transfer_code: 'x', reference: 'disb:app1' } })), 'sig');
    expect(res).toEqual({ received: true });
  });
});
