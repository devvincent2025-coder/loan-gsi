import { MockPaymentProvider, mockNameForAccount } from './payment-providers';
import { namesMatch, nameSimilarity } from './name-match';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('name enquiry is deterministic for the same account number', async () => {
    const a = await provider.nameEnquiry('0123456789', '044');
    const b = await provider.nameEnquiry('0123456789', '058');
    expect(a.accountName).toBe(b.accountName);
    expect(a.accountName).toBe(mockNameForAccount('0123456789'));
  });

  it('rejects an account number ending in 9999 (simulated NIP "not found")', async () => {
    await expect(provider.nameEnquiry('0000009999', '044')).rejects.toThrow();
  });

  it('initiateTransfer is deterministic per idempotency key (same key -> same outcome every time)', async () => {
    const args = { idempotencyKey: 'disb:fixed-key', amountKobo: 100_000, accountNumber: '0123456789', bankCode: '044', narration: 'test' };
    const r1 = await provider.initiateTransfer(args);
    const r2 = await provider.initiateTransfer(args);
    expect(r1.status).toBe(r2.status);
  });
});

describe('name-match', () => {
  it('matches names regardless of word order and case', () => {
    expect(namesMatch('Chinedu Okafor', 'OKAFOR CHINEDU')).toBe(true);
  });
  it('matches with a middle name present on only one side', () => {
    expect(namesMatch('Chinedu Emeka Okafor', 'Chinedu Okafor')).toBe(true);
  });
  it('does not match unrelated names', () => {
    expect(namesMatch('Chinedu Okafor', 'Fatima Mohammed')).toBe(false);
    expect(nameSimilarity('Chinedu Okafor', 'Fatima Mohammed')).toBe(0);
  });
});
