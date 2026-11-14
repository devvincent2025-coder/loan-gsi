import { computeRetryStage, daysPastDue, isGsiStage, parseRetryLadder, parseStageOffset } from './retry-ladder';

const LADDER = parseRetryLadder('DUE_AM,DUE_PM,DAY_PLUS_1,DAY_PLUS_3,DAY_PLUS_7_GSI');

describe('parseRetryLadder / parseStageOffset / isGsiStage', () => {
  it('parses the comma-separated env spec', () => {
    expect(LADDER).toEqual(['DUE_AM', 'DUE_PM', 'DAY_PLUS_1', 'DAY_PLUS_3', 'DAY_PLUS_7_GSI']);
  });
  it('offsets: due-date stages are 0, DAY_PLUS_n stages are n', () => {
    expect(parseStageOffset('DUE_AM')).toBe(0);
    expect(parseStageOffset('DUE_PM')).toBe(0);
    expect(parseStageOffset('DAY_PLUS_1')).toBe(1);
    expect(parseStageOffset('DAY_PLUS_7_GSI')).toBe(7);
  });
  it('only the GSI-named stage is flagged as a GSI fallback', () => {
    expect(isGsiStage('DAY_PLUS_7_GSI')).toBe(true);
    expect(isGsiStage('DAY_PLUS_3')).toBe(false);
  });
});

describe('daysPastDue', () => {
  it('is 0 on the due date, positive after, negative before (calendar dates only)', () => {
    const due = new Date('2026-03-10T23:00:00Z');
    expect(daysPastDue(due, new Date('2026-03-10T01:00:00Z'))).toBe(0);
    expect(daysPastDue(due, new Date('2026-03-13T00:00:00Z'))).toBe(3);
    expect(daysPastDue(due, new Date('2026-03-09T00:00:00Z'))).toBe(-1);
  });
});

describe('computeRetryStage', () => {
  it('on the due date, picks the AM stage before noon and the PM stage after', () => {
    expect(computeRetryStage(0, LADDER, 7)).toBe('DUE_AM');
    expect(computeRetryStage(0, LADDER, 15)).toBe('DUE_PM');
  });
  it('exact-offset days past due map to their ladder stage', () => {
    expect(computeRetryStage(1, LADDER, 9)).toBe('DAY_PLUS_1');
    expect(computeRetryStage(3, LADDER, 9)).toBe('DAY_PLUS_3');
    expect(computeRetryStage(7, LADDER, 9)).toBe('DAY_PLUS_7_GSI');
  });
  it('days with no matching ladder stage are not due (e.g. day 2, between DAY_PLUS_1 and DAY_PLUS_3)', () => {
    expect(computeRetryStage(2, LADDER, 9)).toBeNull();
  });
  it('once dpd exceeds the last (GSI) stage offset, it keeps firing every subsequent day', () => {
    expect(computeRetryStage(8, LADDER, 9)).toBe('DAY_PLUS_7_GSI');
    expect(computeRetryStage(30, LADDER, 9)).toBe('DAY_PLUS_7_GSI');
  });
  it('not due yet before the instalment date, or with an empty ladder', () => {
    expect(computeRetryStage(-1, LADDER, 9)).toBeNull();
    expect(computeRetryStage(1, [], 9)).toBeNull();
  });
});
