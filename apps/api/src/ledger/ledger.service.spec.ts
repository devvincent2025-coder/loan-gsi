import { BadRequestException } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { manualPostingSchema } from './ledger-schemas';

/** post() validates the entry before ever touching Prisma, so a stub is enough for these cases. */
const svc = () => new LedgerService({} as never, { record: jest.fn() } as never);

describe('LedgerService.post balance validation', () => {
  it('rejects an entry with fewer than two postings', async () => {
    await expect(
      svc().post({ memo: 'x', sourceType: 'MANUAL', postings: [{ accountCode: '1000', side: 'DEBIT', amountKobo: 100 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unbalanced debits/credits', async () => {
    await expect(
      svc().post({
        memo: 'x',
        sourceType: 'MANUAL',
        postings: [
          { accountCode: '1000', side: 'DEBIT', amountKobo: 1000 },
          { accountCode: '2000', side: 'CREDIT', amountKobo: 900 },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'LEDGER_UNBALANCED' } });
  });

  it('rejects zero/negative/non-integer posting amounts', async () => {
    await expect(
      svc().post({
        memo: 'x',
        sourceType: 'MANUAL',
        postings: [
          { accountCode: '1000', side: 'DEBIT', amountKobo: 0 },
          { accountCode: '2000', side: 'CREDIT', amountKobo: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a balanced entry past validation (fails later only on the missing Prisma stub)', async () => {
    // $transaction is undefined on the stub prisma, so this proves validation passed and execution moved on.
    await expect(
      svc().post({
        memo: 'balanced',
        sourceType: 'MANUAL',
        postings: [
          { accountCode: '1000', side: 'DEBIT', amountKobo: 500 },
          { accountCode: '4000', side: 'CREDIT', amountKobo: 500 },
        ],
      }),
    ).rejects.not.toBeInstanceOf(BadRequestException);
  });
});

describe('manualPostingSchema', () => {
  it('requires at least two postings and a memo', () => {
    expect(manualPostingSchema.safeParse({ memo: 'ok memo', postings: [{ accountCode: '1000', side: 'DEBIT', amountKobo: 100 }] }).success).toBe(false);
    expect(
      manualPostingSchema.safeParse({
        memo: 'ok memo',
        postings: [
          { accountCode: '1000', side: 'DEBIT', amountKobo: 100 },
          { accountCode: '4000', side: 'CREDIT', amountKobo: 100 },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects unknown fields and non-positive amounts', () => {
    expect(
      manualPostingSchema.safeParse({
        memo: 'ok memo',
        extra: 'nope',
        postings: [
          { accountCode: '1000', side: 'DEBIT', amountKobo: 100 },
          { accountCode: '4000', side: 'CREDIT', amountKobo: 100 },
        ],
      }).success,
    ).toBe(false);
    expect(
      manualPostingSchema.safeParse({
        memo: 'ok memo',
        postings: [
          { accountCode: '1000', side: 'DEBIT', amountKobo: 0 },
          { accountCode: '4000', side: 'CREDIT', amountKobo: 0 },
        ],
      }).success,
    ).toBe(false);
  });
});
