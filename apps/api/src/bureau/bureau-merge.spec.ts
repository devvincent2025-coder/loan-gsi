import { BureauName } from '@damez/shared';
import { bandFor, buildMergedReport, mergeFacilities, normalizeLender, normalizeScore } from './bureau-merge';
import { PerBureauOutcome, RawFacility } from './bureau.types';

const NOW = new Date(Date.UTC(2026, 9, 9));

const fac = (o: Partial<RawFacility> = {}): RawFacility => ({
  lender: 'Access Bank', productType: 'Personal loan', amountGrantedKobo: 100_000_000, outstandingKobo: 50_000_000, status: 'PERFORMING', tenorMonths: 12, monthlyPaymentKobo: 9_000_000,
  openedAt: new Date(Date.UTC(2026, 0, 10)), closedAt: null, lastPaymentAt: new Date(Date.UTC(2026, 8, 5)), legalAction: false, soldToCollections: false, isGuarantor: false,
  history: [{ month: '2026-08', dpd: 0 }, { month: '2026-09', dpd: 0 }], worstDpd: 0, ...o,
});

describe('merge', () => {
  it('normalises lender names across bureaus', () => {
    expect(normalizeLender('GTBank')).toBe(normalizeLender('Guaranty Trust Bank'));
    expect(normalizeLender('Zenith Bank Plc')).toBe(normalizeLender('Zenith Bank'));
    expect(normalizeLender('Kuda MFB')).toBe(normalizeLender('Kuda Microfinance Bank'));
    expect(normalizeLender('FairMoney MFB')).toBe(normalizeLender('FairMoney'));
    expect(normalizeLender('Access Bank')).not.toBe(normalizeLender('Fidelity Bank'));
  });
  it('dedupes the same facility, keeps every source and reconciles to the most severe status', () => {
    const items: { bureau: BureauName; facility: RawFacility }[] = [
      { bureau: 'CRC', facility: fac({ status: 'DEFAULTED', worstDpd: 120, history: [{ month: '2026-08', dpd: 90 }, { month: '2026-09', dpd: 120 }] }) },
      { bureau: 'FIRSTCENTRAL', facility: fac({ lender: 'Access Bank Plc', status: 'Unpaid', outstandingKobo: 51_000_000, history: [{ month: '2026-08', dpd: 60 }, { month: '2026-09', dpd: 80 }], worstDpd: 80 }) },
      { bureau: 'CREDITREGISTRY', facility: fac({ status: 'PERFORMING' }) },
    ];
    const m = mergeFacilities(items, 'c1');
    expect(m).toHaveLength(1);
    expect(m[0].sources).toEqual(['CRC', 'FIRSTCENTRAL', 'CREDITREGISTRY']);
    expect(m[0].status).toBe('DEFAULTED');
    expect(m[0].conflict).toBe(true);
    expect(m[0].history).toEqual([{ month: '2026-08', dpd: 90 }, { month: '2026-09', dpd: 120 }]);
    expect(m[0].worstDpd).toBe(120);
    expect(m[0].outstandingKobo).toBe(51_000_000);
    expect(m[0].isActive).toBe(true);
  });
  it('does not flag a conflict when bureaus agree, and keeps distinct facilities apart', () => {
    const m = mergeFacilities([
      { bureau: 'CRC', facility: fac() }, { bureau: 'CREDITREGISTRY', facility: fac() },
      { bureau: 'CRC', facility: fac({ amountGrantedKobo: 900_000_000 }) },
    ], 'c1');
    expect(m).toHaveLength(2);
    expect(m.find((f) => f.sources.length === 2)?.conflict).toBe(false);
  });
  it('severity order: WRITTEN_OFF > DEFAULTED > Unpaid > PERFORMING > CLOSED', () => {
    const order = ['CLOSED', 'PERFORMING', 'Unpaid', 'DEFAULTED', 'WRITTEN_OFF'] as const;
    for (let i = 1; i < order.length; i++) {
      const m = mergeFacilities([{ bureau: 'CRC', facility: fac({ status: order[i - 1] }) }, { bureau: 'CREDITREGISTRY', facility: fac({ status: order[i] }) }], 'c');
      expect(m[0].status).toBe(order[i]);
    }
  });
  it('per-bureau score range normalisation and bands', () => {
    expect(normalizeScore(550, 200, 900)).toBe(Math.round(300 + (350 / 700) * 550));
    expect(normalizeScore(850, 300, 850)).toBe(850);
    expect(bandFor(499)).toBe('POOR'); expect(bandFor(500)).toBe('FAIR'); expect(bandFor(580)).toBe('GOOD'); expect(bandFor(670)).toBe('VERY_GOOD'); expect(bandFor(740)).toBe('EXCELLENT');
  });
  it('guarantor facilities count toward guarantor exposure, not own obligations', () => {
    const o: PerBureauOutcome[] = [{
      bureau: 'CRC', status: 'SUCCESS', attempts: 1, durationMs: 1,
      result: { bureau: 'CRC', notFound: false, score: 600, minScore: 300, maxScore: 850, thinFile: false, enquiries: [], flags: [], facilities: [fac({ isGuarantor: true }), fac({ lender: 'UBA', openedAt: new Date(Date.UTC(2025, 5, 1)) })] },
    }];
    const s = buildMergedReport(o, 'c', NOW).summary;
    expect(s.guarantorExposureKobo).toBe(50_000_000);
    expect(s.activeFacilityCount).toBe(1);
  });
  it('dedupes enquiries and flags across bureaus', () => {
    const enq = { lender: 'Carbon', date: new Date(Date.UTC(2026, 9, 1)), purpose: 'Loan application' };
    const flag = { type: 'FRAUD' as const, detail: 'x', date: new Date(Date.UTC(2026, 8, 1)) };
    const mk = (b: BureauName): PerBureauOutcome => ({ bureau: b, status: 'SUCCESS', attempts: 1, durationMs: 1, result: { bureau: b, notFound: false, score: 500, minScore: 300, maxScore: 850, thinFile: false, facilities: [], enquiries: [enq], flags: [flag] } });
    const m = buildMergedReport([mk('CRC'), mk('FIRSTCENTRAL')], 'c', NOW);
    expect(m.enquiries).toHaveLength(1);
    expect(m.enquiries[0].sources).toEqual(['CRC', 'FIRSTCENTRAL']);
    expect(m.flags).toHaveLength(1);
    expect(m.summary.fraudFlag).toBe(true);
    expect(m.summary.enquiries30d).toBe(1);
  });
});
