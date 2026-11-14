import { matchNames } from './name-match';

describe('matchNames', () => {
  const me = { firstName: 'Chinedu', lastName: 'Okafor' };
  it('passes exact, reordered, extra middle name and case/diacritic differences', () => {
    expect(matchNames(me, { firstName: 'CHINEDU', lastName: 'OKAFOR' }).status).toBe('PASS');
    expect(matchNames(me, { firstName: 'Okafor', lastName: 'Chinedu' }).status).toBe('PASS');
    expect(matchNames(me, { firstName: 'Chinedu', middleName: 'Emeka', lastName: 'Okafor' }).status).toBe('PASS');
    expect(matchNames({ firstName: 'Chinédu', lastName: "O'Kafor" }, { firstName: 'chinedu', lastName: 'okafor' }).status).toBe('PASS');
  });
  it('tolerates small typos but not different people', () => {
    expect(matchNames(me, { firstName: 'Chinedu', lastName: 'Okafo' }).status).toBe('PASS');
    expect(matchNames(me, { firstName: 'Tunde', lastName: 'Bello' }).status).toBe('FAIL');
  });
  it('sends partial matches to review and scores them', () => {
    const r = matchNames(me, { firstName: 'Chinedu', lastName: 'Bello' });
    expect(r.status).toBe('REVIEW');
    expect(r.score).toBeLessThan(80);
  });
  it('matches a bank account holder string (any order)', () => {
    expect(matchNames(me, { fullName: 'OKAFOR CHINEDU E' }).status).toBe('PASS');
  });
});
