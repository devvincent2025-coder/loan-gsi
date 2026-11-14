import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalObjectStorage } from './object-storage';

describe('LocalObjectStorage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'damez-store-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('puts, gets and deletes', async () => {
    const s = new LocalObjectStorage(dir);
    await s.put('kyc/c1/d1', Buffer.from('hello'));
    expect((await s.get('kyc/c1/d1')).toString()).toBe('hello');
    await s.delete('kyc/c1/d1');
    await expect(s.get('kyc/c1/d1')).rejects.toThrow();
  });
  it('refuses path traversal', async () => {
    const s = new LocalObjectStorage(dir);
    await expect(s.put('../escape', Buffer.from('x'))).rejects.toThrow('Invalid storage key');
  });
});
