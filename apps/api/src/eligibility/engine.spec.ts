import { DEFAULT_SCORECARD_V1, EligibilityFacts, maxPrincipalForInstalment, monthlyInstalment, ScorecardDefinition } from '@damez/shared';
import { computeScore, EngineInput, EngineProduct, factorPoints, ruleMatches, runEligibilityEngine, scoreBand } from './engine';

const NOW = new Date('2026-10-09T10:00:00Z');
const k = (naira: number) => naira * 100;

const clean = (o: Partial<EligibilityFacts> = {}): EligibilityFacts => ({
  age: 35, employmentStatus: 'EMPLOYED', declaredMonthlyIncomeKobo: k(300_000), accountAgeDays: 200, kycTier: 2,
  bureauScore: 720, bureauThinFile: false, bureauWorstDpdEver: 0, bureauDpd90In12m: false, bureauWriteOff24m: false, bureauWriteOffAgeMonths: null,
  bureauDefaultCount: 0, bureauActiveLoans: 0, bureauMonthlyObligationKobo: 0, bureauEnquiries30d: 0, bureauEnquiries90d: 0, bureauEnquiries180d: 1,
  bureauFraudFlag: false, bureauElsewhereDefault: false, bureauLegalAction: false,
  bankStatementMonths: 6, avgMonthlyInflowKobo: k(300_000), inflowStability: 90, avgBalanceKobo: k(150_000), gamblingFlag: false, overdraftFlag: false, salaryDetected: true,
  internalCompletedLoans: 0, internalLateInstalments: 0, internalActiveLoan: false, internalWrittenOff: false, fraudHighSignals: 0, fraudMediumSignals: 0,
  ...o,
});

const product = (o: Partial<EngineProduct> = {}): EngineProduct => ({
  id: 'p1', name: 'Salary Advance', monthlyRateBps: 450, interestMethod: 'FLAT', minAmountKobo: k(50_000), maxAmountKobo: k(1_000_000),
  minTenorMonths: 1, maxTenorMonths: 12, minKycTier: 1, minAge: 18, maxAge: 65, allowGuarantor: true, allowCollateral: false, isActive: true, eligibilityOverrides: {}, ...o,
});

const run = (o: Partial<EngineInput> & { facts?: EligibilityFacts }) => runEligibilityEngine({
  facts: clean(), definition: DEFAULT_SCORECARD_V1, scorecard: { id: 's1', key: 'default', version: 1, name: 'Default' }, product: product(),
  requested: { amountKobo: k(200_000), tenorMonths: 6 }, kycCapKobo: k(1_000_000), otherProducts: [], now: NOW, ...o,
});
const types = (r: ReturnType<typeof run>) => r.suggestions.map((s) => s.type);
const codes = (r: ReturnType<typeof run>) => r.reasons.map((x) => x.code);

describe('score primitives', () => {
  it('maps score bands at the boundaries', () => {
    expect([499, 500, 579, 580, 669, 670, 739, 740].map(scoreBand)).toEqual(['POOR', 'FAIR', 'FAIR', 'GOOD', 'GOOD', 'VERY_GOOD', 'VERY_GOOD', 'EXCELLENT']);
  });
  it('bins: gte inclusive, lt exclusive, eq exact, null -> defaultPoints', () => {
    const f = DEFAULT_SCORECARD_V1.factors.find((x) => x.key === 'bureau_score')!;
    expect(factorPoints(f, 600)).toBe(40);
    expect(factorPoints(f, 599)).toBe(0);
    expect(factorPoints(f, 700)).toBe(80);
    expect(factorPoints(f, null)).toBe(0);
    const s = DEFAULT_SCORECARD_V1.factors.find((x) => x.key === 'inflow_stability')!;
    expect(factorPoints(s, null)).toBe(-10);
    const e = DEFAULT_SCORECARD_V1.factors.find((x) => x.key === 'employment')!;
    expect(factorPoints(e, 'STUDENT')).toBe(-25);
    expect(factorPoints(e, 'UNKNOWN')).toBe(0);
  });
  it('clamps the score to min..max and reports per-factor contributions', () => {
    const lo = computeScore(clean({ bureauScore: 100, bureauWorstDpdEver: 120, bureauEnquiries90d: 9, employmentStatus: 'UNEMPLOYED', gamblingFlag: true, overdraftFlag: true, salaryDetected: false, inflowStability: 10, avgBalanceKobo: 0, bureauThinFile: true, internalLateInstalments: 9 }), DEFAULT_SCORECARD_V1);
    expect(lo.score).toBeGreaterThanOrEqual(300);
    const def: ScorecardDefinition = { ...DEFAULT_SCORECARD_V1, maxScore: 600 };
    const hi = computeScore(clean(), def);
    expect(hi.score).toBe(600);
    expect(hi.factors).toHaveLength(DEFAULT_SCORECARD_V1.factors.length);
    expect(hi.factors.find((f) => f.key === 'salary')).toMatchObject({ points: 30, value: 'Yes' });
    expect(hi.factors.find((f) => f.key === 'avg_balance')!.value).toBe('₦150,000');
  });
});

describe('rule operator semantics', () => {
  const rule = (op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte', value: number | boolean | string, field = 'age') => ({ ...DEFAULT_SCORECARD_V1.policyRules[0], field, op, value });
  const f = clean({ age: 30 });
  it.each([
    ['eq', 30, true], ['eq', 31, false], ['neq', 31, true], ['neq', 30, false], ['gt', 29, true], ['gt', 30, false],
    ['gte', 30, true], ['gte', 31, false], ['lt', 31, true], ['lt', 30, false], ['lte', 30, true], ['lte', 29, false],
  ] as const)('age %s %s -> %s', (op, value, expected) => expect(ruleMatches(rule(op, value), f)).toBe(expected));
  it('null facts never match (even neq / lt)', () => {
    const nf = clean({ bureauScore: null });
    expect(ruleMatches(rule('neq', 5, 'bureauScore'), nf)).toBe(false);
    expect(ruleMatches(rule('lt', 5, 'bureauScore'), nf)).toBe(false);
    expect(ruleMatches(rule('eq', 5, 'bureauWriteOffAgeMonths'), clean())).toBe(false);
  });
  it('ordering operators on non-numbers do not match; strings/booleans compare by eq', () => {
    expect(ruleMatches(rule('gt', 1, 'employmentStatus'), f)).toBe(false);
    expect(ruleMatches(rule('eq', 'EMPLOYED', 'employmentStatus'), f)).toBe(true);
    expect(ruleMatches(rule('eq', true, 'salaryDetected'), f)).toBe(true);
  });
  it('unknown field never matches', () => expect(ruleMatches(rule('eq', 1, 'nope'), f)).toBe(false));
});

describe('profiles', () => {
  it('clean applicant is ELIGIBLE with positive reasons and no suggestions', () => {
    const r = run({});
    expect(r.outcome).toBe('ELIGIBLE');
    expect(r.score).toBe(765);
    expect(r.scoreBand).toBe('EXCELLENT');
    expect(r.maxAmountKobo).toBeGreaterThanOrEqual(k(200_000));
    expect(r.suggestions).toEqual([]);
    expect(r.alternatives).toEqual([]);
    expect(codes(r)).toEqual(expect.arrayContaining(['SALARY_DETECTED', 'STABLE_INFLOW', 'CLEAN_CREDIT_HISTORY']));
    expect(r.reasons[0].severity).not.toBe('BLOCKER');
    expect(r.requestedMonthlyRepaymentKobo).toBe(monthlyInstalment(k(200_000), 450, 6, 'FLAT'));
    expect(r.recognisedIncomeKobo).toBe(k(270_000));
    for (const x of r.reasons) { expect(x.customerMessage.length).toBeGreaterThan(5); expect(x.officerMessage.length).toBeGreaterThan(5); }
  });

  it('shows repayment history with us as a positive reason', () => {
    const r = run({ facts: clean({ internalCompletedLoans: 2 }) });
    expect(codes(r)).toContain('REPAYMENT_HISTORY_WITH_US');
  });

  it('thin file with no statement: conditional-or-better with LINK_ACCOUNTS, income recognised at 70% of declared', () => {
    const r = run({ facts: clean({ bureauScore: null, bureauThinFile: true, bankStatementMonths: 0, avgMonthlyInflowKobo: 0, inflowStability: 0, avgBalanceKobo: 0, salaryDetected: false, declaredMonthlyIncomeKobo: k(200_000) }), requested: { amountKobo: k(100_000), tenorMonths: 3 } });
    expect(r.recognisedIncomeKobo).toBe(k(140_000));
    expect(codes(r)).toEqual(expect.arrayContaining(['THIN_FILE', 'SHORT_STATEMENT', 'INCOME_NOT_VERIFIED']));
    expect(types(r)).toContain('LINK_ACCOUNTS');
    expect(types(r)).toContain('UPLOAD_DOCUMENT');
    expect(r.outcome).not.toBe('ELIGIBLE'); // score below approve cutoff
  });

  it('short statement (< minStatementMonths) falls back to declared income', () => {
    const r = run({ facts: clean({ bankStatementMonths: 2, declaredMonthlyIncomeKobo: k(100_000) }) });
    expect(r.recognisedIncomeKobo).toBe(k(70_000));
  });

  it('late payer scores into the CONDITIONAL band', () => {
    const r = run({ facts: clean({ bureauScore: 640, bureauWorstDpdEver: 45, bureauEnquiries90d: 3, inflowStability: 60, salaryDetected: false, internalLateInstalments: 2 }) });
    expect(r.score).toBeLessThan(600);
    expect(r.score).toBeGreaterThanOrEqual(520);
    expect(r.outcome).toBe('CONDITIONAL');
    expect(codes(r)).toContain('SCORE_REVIEW_BAND');
    expect(types(r)).not.toContain('ADD_GUARANTOR'); // 60 points short: outside the 40-point window
  });

  it('guarantor is only suggested within guarantorWithinPoints of the approve cutoff, and only when the product allows it', () => {
    const facts = clean({ bureauScore: 640, bureauWorstDpdEver: 45, bureauEnquiries90d: 3, inflowStability: 60, salaryDetected: true, internalLateInstalments: 2 });
    const base = run({ facts });
    expect(types(base)).toContain('ADD_GUARANTOR');
    const gap = DEFAULT_SCORECARD_V1.cutoffs.approve - base.score;
    expect(gap).toBeGreaterThan(0);
    const tight: ScorecardDefinition = { ...DEFAULT_SCORECARD_V1, affordability: { ...DEFAULT_SCORECARD_V1.affordability, guarantorWithinPoints: gap - 1 } };
    expect(types(run({ facts, definition: tight }))).not.toContain('ADD_GUARANTOR');
    expect(types(run({ facts, product: product({ allowGuarantor: false }) }))).not.toContain('ADD_GUARANTOR');
  });

  it('write-off 8 months ago: INELIGIBLE with reapply date at the end of the 24-month window', () => {
    const r = run({ facts: clean({ bureauWriteOff24m: true, bureauWriteOffAgeMonths: 8, bureauDefaultCount: 1 }) });
    expect(r.outcome).toBe('INELIGIBLE');
    expect(r.maxAmountKobo).toBe(0);
    expect(r.firedRules.map((x) => x.code)).toContain('BUREAU_WRITE_OFF_24M');
    const reapply = r.suggestions.find((s) => s.type === 'REAPPLY_LATER')!;
    expect(reapply.reapplyAfterDays).toBe((24 - 8) * 30);
    expect(reapply.reapplyDate).toBe('2028-02-01');
    expect(r.suggestions[0].type).toBe('REAPPLY_LATER');
    const reason = r.reasons.find((x) => x.code === 'BUREAU_WRITE_OFF_24M')!;
    expect(reason.severity).toBe('BLOCKER');
    expect(reason.officerMessage).toMatch(/8 months ago/);
    expect(r.reasons[0].severity).toBe('BLOCKER');
    expect(r.alternatives).toEqual([]);
  });

  it('DPD 90+ in 12 months declines and uses the rule reapply period', () => {
    const r = run({ facts: clean({ bureauDpd90In12m: true, bureauWorstDpdEver: 120 }) });
    expect(r.outcome).toBe('INELIGIBLE');
    expect(r.suggestions.find((s) => s.type === 'REAPPLY_LATER')!.reapplyAfterDays).toBe(180);
  });

  it('a decline rule without reapply period gives no reapply suggestion', () => {
    const r = run({ facts: clean({ bureauFraudFlag: true }) });
    expect(r.outcome).toBe('INELIGIBLE');
    expect(types(r)).not.toContain('REAPPLY_LATER');
    expect(r.suggestions.every((s) => s.type !== 'REDUCE_AMOUNT')).toBe(true);
  });

  it('too many enquiries is a REFER (conditional) and suggests waiting for them to age out', () => {
    const r = run({ facts: clean({ bureauEnquiries90d: 7, bureauEnquiries30d: 4 }) });
    expect(r.outcome).toBe('CONDITIONAL');
    expect(r.firedRules).toEqual([{ code: 'TOO_MANY_ENQUIRIES', action: 'REFER' }]);
    expect(r.suggestions.find((s) => s.type === 'REAPPLY_LATER')!.reapplyAfterDays).toBe(60);
  });

  it('score below the refer cutoff is INELIGIBLE', () => {
    const r = run({ facts: clean({ bureauScore: 350, bureauWorstDpdEver: 60, employmentStatus: 'UNEMPLOYED', gamblingFlag: true, overdraftFlag: true, salaryDetected: false, inflowStability: 20 }) });
    expect(r.score).toBeLessThan(520);
    expect(r.outcome).toBe('INELIGIBLE');
    expect(codes(r)).toEqual(expect.arrayContaining(['SCORE_BELOW_MINIMUM', 'GAMBLING_ACTIVITY', 'OVERDRAFT']));
    expect(r.reasons.find((x) => x.code === 'SCORE_BELOW_MINIMUM')!.customerMessage).not.toMatch(/\d{3}/);
  });

  it('gambling / overdraft flags appear as warnings', () => {
    const r = run({ facts: clean({ gamblingFlag: true, overdraftFlag: true }) });
    expect(r.reasons.filter((x) => ['GAMBLING_ACTIVITY', 'OVERDRAFT'].includes(x.code)).every((x) => x.severity === 'WARNING')).toBe(true);
  });

  it('underage fires the UNDERAGE rule and the product age bound', () => {
    const r = run({ facts: clean({ age: 17 }) });
    expect(r.outcome).toBe('INELIGIBLE');
    expect(codes(r)).toEqual(expect.arrayContaining(['UNDERAGE', 'AGE_OUT_OF_RANGE']));
    expect(run({ facts: clean({ age: 70 }) }).outcome).toBe('INELIGIBLE');
  });
});

describe('affordability', () => {
  const def150: ScorecardDefinition = { ...DEFAULT_SCORECARD_V1, affordability: { ...DEFAULT_SCORECARD_V1.affordability, maxDtiBps: 3000, inflowRecognitionBps: 10000 } };
  const f150 = () => clean({ avgMonthlyInflowKobo: k(150_000), declaredMonthlyIncomeKobo: k(150_000) });

  it('N150k inflow supports a N45k repayment; max amount math matches maxPrincipalForInstalment', () => {
    const r = run({ facts: f150(), definition: def150, requested: { amountKobo: k(500_000), tenorMonths: 6 } });
    expect(r.recognisedIncomeKobo).toBe(k(150_000));
    expect(r.maxMonthlyRepaymentKobo).toBe(k(45_000));
    const msg = r.reasons.find((x) => x.code === 'AFFORDABILITY_LIMIT')!;
    expect(msg.customerMessage).toBe('Monthly inflow of ₦150,000 supports a maximum repayment of ₦45,000 a month.');
    expect(msg.severity).toBe('BLOCKER');
    expect(msg.officerMessage).toContain('₦150,000');
    expect(r.maxAmountKobo).toBe(maxPrincipalForInstalment(k(45_000), 450, 6, 'FLAT'));
    expect(r.maxAmountKobo % 100_000).toBe(0);
    expect(r.outcome).toBe('CONDITIONAL');
    const red = r.suggestions.find((s) => s.type === 'REDUCE_AMOUNT')!;
    expect(red.amountKobo).toBe(r.maxAmountKobo);
    expect(red.monthlyRepaymentKobo).toBeLessThanOrEqual(k(45_000));
    expect(red.monthlyRepaymentKobo).toBe(monthlyInstalment(r.maxAmountKobo, 450, 6, 'FLAT'));
    expect(r.dtiBps).toBeGreaterThan(3000);
  });

  it('product eligibilityOverrides.maxDtiBps overrides the scorecard DTI', () => {
    const r = run({ facts: f150(), definition: def150, product: product({ eligibilityOverrides: { maxDtiBps: 2000 } }), requested: { amountKobo: k(100_000), tenorMonths: 6 } });
    expect(r.maxMonthlyRepaymentKobo).toBe(k(30_000));
  });

  it('external obligations reduce headroom (over-indebted): CLEAR_DEBT and a high-DTI reason', () => {
    const r = run({ facts: clean({ bureauMonthlyObligationKobo: k(90_000), bureauActiveLoans: 4 }), requested: { amountKobo: k(400_000), tenorMonths: 6 } });
    // recognised 270k × 40% = 108k − 90k = 18k headroom
    expect(r.maxMonthlyRepaymentKobo).toBe(k(18_000));
    expect(r.outcome).toBe('CONDITIONAL');
    expect(codes(r)).toContain('HIGH_DTI_EXISTING_LOANS');
    const cd = r.suggestions.find((s) => s.type === 'CLEAR_DEBT')!;
    expect(cd.monthlyRepaymentKobo).toBe(r.requestedMonthlyRepaymentKobo - k(18_000));
    expect(types(r)).toContain('REDUCE_AMOUNT');
    expect(r.dtiBps).toBe(Math.round(((r.requestedMonthlyRepaymentKobo + k(90_000)) * 10_000) / k(270_000)));
  });

  it('fully over-indebted (no headroom) and under product minimum → INELIGIBLE', () => {
    const r = run({ facts: clean({ bureauMonthlyObligationKobo: k(120_000) }) });
    expect(r.maxMonthlyRepaymentKobo).toBe(0);
    expect(r.outcome).toBe('INELIGIBLE');
    expect(r.maxAmountKobo).toBe(0);
    expect(codes(r)).toEqual(expect.arrayContaining(['AFFORDABILITY_INSUFFICIENT', 'HIGH_DTI_EXISTING_LOANS']));
    expect(types(r)).toContain('CLEAR_DEBT');
    expect(types(r)).not.toContain('REDUCE_AMOUNT');
  });

  it('no income at all is a blocker', () => {
    const r = run({ facts: clean({ bankStatementMonths: 0, avgMonthlyInflowKobo: 0, declaredMonthlyIncomeKobo: 0 }) });
    expect(r.outcome).toBe('INELIGIBLE');
    expect(codes(r)).toContain('NO_VERIFIABLE_INCOME');
    expect(r.dtiBps).toBe(99_999);
  });

  it('LONGER_TENOR suggests the shortest tenor whose instalment actually fits the requested amount', () => {
    const r = run({ facts: clean({ avgMonthlyInflowKobo: k(100_000) }), definition: def150, product: product({ maxTenorMonths: 24 }), requested: { amountKobo: k(300_000), tenorMonths: 3 } });
    const lt = r.suggestions.find((s) => s.type === 'LONGER_TENOR')!;
    expect(lt).toBeDefined();
    expect(lt.amountKobo).toBe(k(300_000));
    expect(lt.tenorMonths).toBeGreaterThan(3);
    expect(lt.monthlyRepaymentKobo!).toBeLessThanOrEqual(r.maxMonthlyRepaymentKobo);
    expect(monthlyInstalment(k(300_000), 450, lt.tenorMonths! - 1, 'FLAT')).toBeGreaterThan(r.maxMonthlyRepaymentKobo); // shortest
    expect(lt.monthlyRepaymentKobo).toBe(monthlyInstalment(k(300_000), 450, lt.tenorMonths!, 'FLAT'));
  });

  it('LONGER_TENOR is not offered when no tenor within the product maximum fits', () => {
    const r = run({ facts: clean({ avgMonthlyInflowKobo: k(20_000) }), definition: def150, product: product({ minAmountKobo: k(10_000) }), requested: { amountKobo: k(900_000), tenorMonths: 3 } });
    expect(types(r)).not.toContain('LONGER_TENOR');
  });

  it('reducing-balance product uses the annuity maths', () => {
    const p = product({ interestMethod: 'REDUCING_BALANCE', monthlyRateBps: 300 });
    const r = run({ facts: f150(), definition: def150, product: p, requested: { amountKobo: k(600_000), tenorMonths: 12 } });
    expect(r.requestedMonthlyRepaymentKobo).toBe(monthlyInstalment(k(600_000), 300, 12, 'REDUCING_BALANCE'));
    expect(r.maxAmountKobo).toBe(maxPrincipalForInstalment(k(45_000), 300, 12, 'REDUCING_BALANCE'));
  });

  it('collateral is suggested only when allowed and affordability blocks', () => {
    const facts = f150();
    const req = { amountKobo: k(500_000), tenorMonths: 6 };
    expect(types(run({ facts, definition: def150, requested: req }))).not.toContain('ADD_COLLATERAL');
    expect(types(run({ facts, definition: def150, requested: req, product: product({ allowCollateral: true }) }))).toContain('ADD_COLLATERAL');
  });
});

describe('KYC', () => {
  it('amount above the tier cap: CONDITIONAL, capped, UPGRADE_KYC naming the tier that unlocks it', () => {
    const r = run({ facts: clean({ kycTier: 1 }), kycCapKobo: k(100_000), requested: { amountKobo: k(300_000), tenorMonths: 6 } });
    expect(r.outcome).toBe('CONDITIONAL');
    expect(r.maxAmountKobo).toBe(k(100_000));
    const up = r.suggestions.find((s) => s.type === 'UPGRADE_KYC')!;
    expect(up.customerMessage).toMatch(/Tier 2/);
    expect(codes(r)).toContain('KYC_CAP_EXCEEDED');
    expect(types(r)).toContain('REDUCE_AMOUNT');
  });
  it('tier below the product requirement is INELIGIBLE with UPGRADE_KYC and still shows alternatives the tier allows', () => {
    const other = product({ id: 'p2', name: 'Starter', minKycTier: 1, maxAmountKobo: k(100_000), minAmountKobo: k(10_000), maxTenorMonths: 3 });
    const r = run({ facts: clean({ kycTier: 1 }), kycCapKobo: k(100_000), product: product({ minKycTier: 2 }), requested: { amountKobo: k(80_000), tenorMonths: 3 }, otherProducts: [other] });
    expect(r.outcome).toBe('INELIGIBLE');
    expect(r.maxAmountKobo).toBe(0);
    expect(r.suggestions.find((s) => s.type === 'UPGRADE_KYC')!.customerMessage).toMatch(/Tier 2/);
    expect(r.alternatives.map((a) => a.productId)).toEqual(['p2']);
  });
});

describe('product bounds', () => {
  it('amount below product minimum / tenor outside range are blockers', () => {
    expect(codes(run({ requested: { amountKobo: k(10_000), tenorMonths: 6 } }))).toContain('AMOUNT_BELOW_MINIMUM');
    const t = run({ requested: { amountKobo: k(100_000), tenorMonths: 24 } });
    expect(t.outcome).toBe('INELIGIBLE');
    expect(codes(t)).toContain('TENOR_OUT_OF_RANGE');
  });
  it('amount above product maximum is capped (conditional) with a reduce suggestion', () => {
    const r = run({ product: product({ maxAmountKobo: k(150_000) }), requested: { amountKobo: k(200_000), tenorMonths: 6 } });
    expect(r.outcome).toBe('CONDITIONAL');
    expect(r.maxAmountKobo).toBe(k(150_000));
    expect(types(r)).toContain('REDUCE_AMOUNT');
  });
  it('maximum is rounded down to N1,000 steps', () => {
    const r = run({ product: product({ maxAmountKobo: 15_050_000 }), requested: { amountKobo: k(200_000), tenorMonths: 6 } });
    expect(r.maxAmountKobo).toBe(15_000_000);
  });
});

describe('alternatives', () => {
  const others = [
    product({ id: 'a', name: 'Quick Cash', monthlyRateBps: 600, minAmountKobo: k(10_000), maxAmountKobo: k(300_000), maxTenorMonths: 3 }),
    product({ id: 'b', name: 'Flex Plus', monthlyRateBps: 350, minAmountKobo: k(20_000), maxAmountKobo: k(2_000_000), minTenorMonths: 3, maxTenorMonths: 24, interestMethod: 'REDUCING_BALANCE' }),
    product({ id: 'c', name: 'Dormant', isActive: false }),
    product({ id: 'd', name: 'Premium', minKycTier: 3, maxAmountKobo: k(5_000_000) }),
    product({ id: 'e', name: 'Elders', minAge: 60, maxAge: 80 }),
  ];
  const def: ScorecardDefinition = { ...DEFAULT_SCORECARD_V1, affordability: { ...DEFAULT_SCORECARD_V1.affordability, maxDtiBps: 3000, inflowRecognitionBps: 10000 } };

  it('re-runs affordability across other active, eligible products and keeps instalments inside the headroom', () => {
    const r = run({ facts: clean({ avgMonthlyInflowKobo: k(150_000) }), definition: def, requested: { amountKobo: k(800_000), tenorMonths: 6 }, otherProducts: others });
    expect(r.outcome).toBe('CONDITIONAL');
    const ids = r.alternatives.map((a) => a.productId);
    expect(ids).not.toContain('c'); // inactive
    expect(ids).not.toContain('d'); // KYC tier 3 required
    expect(ids).not.toContain('e'); // age
    expect(ids).toContain('b');
    expect(r.alternatives.length).toBeLessThanOrEqual(3);
    for (const a of r.alternatives) {
      expect(a.monthlyRepaymentKobo).toBeLessThanOrEqual(r.maxMonthlyRepaymentKobo);
      expect(a.note.length).toBeGreaterThan(10);
    }
    const b = r.alternatives.find((a) => a.productId === 'b')!;
    expect(b.monthlyRepaymentKobo).toBe(monthlyInstalment(b.amountKobo, 350, b.tenorMonths, 'REDUCING_BALANCE'));
    // best fit first: the larger affordable amount
    const gaps = r.alternatives.map((a) => Math.abs(k(800_000) - a.amountKobo));
    expect([...gaps].sort((x, y) => x - y)).toEqual(gaps);
  });
  it('limits to three offers', () => {
    const many = Array.from({ length: 6 }, (_, i) => product({ id: `m${i}`, name: `M${i}`, monthlyRateBps: 300 + i * 10 }));
    const r = run({ facts: clean({ avgMonthlyInflowKobo: k(150_000) }), definition: def, requested: { amountKobo: k(800_000), tenorMonths: 6 }, otherProducts: many });
    expect(r.alternatives).toHaveLength(3);
  });
});

describe('determinism & hygiene', () => {
  it('same input gives byte-identical output', () => {
    const input: Partial<EngineInput> = { facts: clean({ bureauEnquiries90d: 7, bureauMonthlyObligationKobo: k(60_000) }), requested: { amountKobo: k(400_000), tenorMonths: 6 }, otherProducts: [product({ id: 'z', name: 'Z' })] };
    expect(JSON.stringify(run(input))).toBe(JSON.stringify(run(input)));
  });
  it('does not mutate its inputs', () => {
    const facts = clean({ bureauWriteOff24m: true, bureauWriteOffAgeMonths: 3 });
    const before = JSON.stringify([facts, DEFAULT_SCORECARD_V1]);
    run({ facts });
    expect(JSON.stringify([facts, DEFAULT_SCORECARD_V1])).toBe(before);
  });
  it('orders reasons by severity and never leaks scorecard internals in customer wording', () => {
    const r = run({ facts: clean({ bureauWriteOff24m: true, bureauWriteOffAgeMonths: 3, gamblingFlag: true }) });
    const rank = { BLOCKER: 0, WARNING: 1, INFO: 2, POSITIVE: 3 } as const;
    const ranks = r.reasons.map((x) => rank[x.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    for (const x of r.reasons) expect(x.customerMessage).not.toMatch(/scorecard|cutoff|rule |CRC|FirstCentral|CreditRegistry|bps/i);
  });
  it('a REFER rule fixes outcome at CONDITIONAL even with a great score', () => {
    const r = run({ facts: clean({ bureauLegalAction: true }) });
    expect(r.score).toBeGreaterThanOrEqual(600);
    expect(r.outcome).toBe('CONDITIONAL');
  });
  it('DECLINE beats REFER', () => {
    expect(run({ facts: clean({ bureauLegalAction: true, bureauFraudFlag: true }) }).outcome).toBe('INELIGIBLE');
  });
});
