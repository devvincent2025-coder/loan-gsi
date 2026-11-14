import { APPLICATION_STATUSES, type ApplicationStatus } from '@damez/shared';
import {
  Actor, allowedStaffTransitions, canTransition, CANCELLABLE, findTransition, isTerminal, resolveTransition, STATES, stateMachineDto, TRANSITIONS,
} from './state-machine';

const ACTORS: Actor[] = ['CUSTOMER', 'STAFF', 'SYSTEM'];
const status = (fn: () => unknown): number | undefined => { try { fn(); return undefined; } catch (e) { return (e as { getStatus(): number }).getStatus(); } };

describe('state machine table', () => {
  it('defines all 16 states exactly once', () => {
    expect(STATES.map((s) => s.key).sort()).toEqual([...APPLICATION_STATUSES].sort());
  });
  it('has no dangling states in transitions', () => {
    const keys = new Set<string>(STATES.map((s) => s.key));
    for (const t of TRANSITIONS) { expect(keys.has(t.from)).toBe(true); expect(keys.has(t.to)).toBe(true); }
  });
  it('every non-initial state is reachable and every non-terminal state can move on', () => {
    for (const s of STATES) {
      if (s.key !== 'DRAFT') expect(TRANSITIONS.some((t) => t.to === s.key)).toBe(true);
      if (!s.terminal) expect(TRANSITIONS.some((t) => t.from === s.key)).toBe(true);
    }
  });
  it('terminal states have no outgoing transitions', () => {
    for (const s of STATES.filter((x) => x.terminal)) expect(TRANSITIONS.filter((t) => t.from === s.key)).toHaveLength(0);
    expect(['CLOSED', 'WRITTEN_OFF', 'REJECTED', 'CANCELLED'].every((k) => isTerminal(k as ApplicationStatus))).toBe(true);
    expect(isTerminal('UNDER_REVIEW')).toBe(false);
  });
  it('has no duplicate (from,to) rows and staff transitions name a permission', () => {
    const seen = new Set<string>();
    for (const t of TRANSITIONS) { const k = `${t.from}>${t.to}`; expect(seen.has(k)).toBe(false); seen.add(k); }
    for (const t of TRANSITIONS.filter((x) => x.actors.includes('STAFF'))) expect(t.permission).toBeTruthy();
  });
  it('state implemented flags agree with transitions', () => {
    for (const s of STATES.filter((x) => !x.implemented)) {
      expect(TRANSITIONS.filter((t) => t.to === s.key).every((t) => !t.implemented)).toBe(true);
    }
  });
  it('dto expands one row per actor', () => {
    const dto = stateMachineDto();
    expect(dto.states).toHaveLength(16);
    expect(dto.transitions.length).toBe(TRANSITIONS.reduce((n, t) => n + t.actors.length, 0));
    expect(dto.transitions.filter((t) => t.actor !== 'STAFF').every((t) => t.permission === null)).toBe(true);
  });
});

describe('implemented transitions', () => {
  const implemented = TRANSITIONS.filter((t) => t.implemented);
  it('are legal for their actors and illegal (409) for all others', () => {
    for (const t of implemented) {
      for (const a of ACTORS) {
        if (t.actors.includes(a)) expect(resolveTransition(t.from, t.to, a, 'because')).toBe(t);
        else expect(status(() => resolveTransition(t.from, t.to, a, 'because'))).toBe(409);
      }
    }
  });
  it('covers the required flow', () => {
    expect(canTransition('DRAFT', 'SUBMITTED', 'CUSTOMER')).toBe(true);
    expect(canTransition('DRAFT', 'SUBMITTED', 'STAFF')).toBe(true);
    expect(canTransition('DRAFT', 'SUBMITTED', 'SYSTEM')).toBe(false);
    expect(canTransition('SUBMITTED', 'KYC_PENDING', 'SYSTEM')).toBe(true);
    expect(canTransition('SUBMITTED', 'BUREAU_CHECK', 'SYSTEM')).toBe(true);
    expect(canTransition('KYC_PENDING', 'BUREAU_CHECK', 'SYSTEM')).toBe(true);
    expect(canTransition('BUREAU_CHECK', 'UNDER_REVIEW', 'SYSTEM')).toBe(true);
    expect(canTransition('BUREAU_CHECK', 'REJECTED', 'SYSTEM')).toBe(true);
    expect(canTransition('UNDER_REVIEW', 'REJECTED', 'STAFF')).toBe(true);
    expect(canTransition('UNDER_REVIEW', 'REJECTED', 'CUSTOMER')).toBe(false);
    expect(findTransition('UNDER_REVIEW', 'REJECTED', 'STAFF')?.permission).toBe('loan:reject');
  });
  it('cancellation is allowed from the pre-booking states for customer and staff, and nowhere else', () => {
    for (const s of STATES) {
      const ok = CANCELLABLE.includes(s.key);
      expect(canTransition(s.key, 'CANCELLED', 'CUSTOMER')).toBe(ok);
      expect(canTransition(s.key, 'CANCELLED', 'STAFF')).toBe(ok);
      expect(canTransition(s.key, 'CANCELLED', 'SYSTEM')).toBe(false);
    }
    expect(findTransition('UNDER_REVIEW', 'CANCELLED', 'STAFF')?.permission).toBe('application:update');
  });
  it('requires a reason for reject and cancel (400)', () => {
    expect(status(() => resolveTransition('UNDER_REVIEW', 'REJECTED', 'STAFF', ''))).toBe(400);
    expect(status(() => resolveTransition('UNDER_REVIEW', 'REJECTED', 'STAFF', '   '))).toBe(400);
    expect(status(() => resolveTransition('DRAFT', 'CANCELLED', 'CUSTOMER'))).toBe(400);
    expect(resolveTransition('DRAFT', 'SUBMITTED', 'CUSTOMER').to).toBe('SUBMITTED');
  });
  it('never allows leaving a terminal state', () => {
    for (const from of ['CLOSED', 'WRITTEN_OFF', 'REJECTED', 'CANCELLED'] as ApplicationStatus[]) {
      for (const to of APPLICATION_STATUSES) for (const a of ACTORS) expect(status(() => resolveTransition(from, to, a, 'x'))).toBe(409);
    }
  });
});

describe('post-approval lifecycle (prompt 3: implemented, guards enforced by the calling service)', () => {
  it('approval needs loan:approve and is maker-checker gated', () => {
    const t = findTransition('UNDER_REVIEW', 'APPROVED', 'STAFF')!;
    expect(t.permission).toBe('loan:approve');
    expect(t.implemented).toBe(true);
    expect(t.guards).toContain('makerChecker:LOAN_APPROVAL');
    expect(status(() => resolveTransition('UNDER_REVIEW', 'APPROVED', 'CUSTOMER'))).toBe(409);
  });
  it('covers the full post-approval lifecycle', () => {
    for (const [f, to] of [['APPROVED', 'OFFER_SENT'], ['OFFER_SENT', 'OFFER_ACCEPTED'], ['OFFER_ACCEPTED', 'DISBURSED'], ['DISBURSED', 'ACTIVE'], ['ACTIVE', 'Unpaid'], ['Unpaid', 'ACTIVE'],
      ['ACTIVE', 'RESTRUCTURED'], ['Unpaid', 'RESTRUCTURED'], ['ACTIVE', 'CLOSED'], ['Unpaid', 'WRITTEN_OFF']] as [ApplicationStatus, ApplicationStatus][]) {
      expect(TRANSITIONS.some((t) => t.from === f && t.to === to && t.implemented)).toBe(true);
    }
    expect(findTransition('OFFER_SENT', 'OFFER_ACCEPTED', 'CUSTOMER')).toBeTruthy();
  });
});

describe('allowedStaffTransitions', () => {
  it('filters by permission', () => {
    const reviewer = allowedStaffTransitions('UNDER_REVIEW', new Set(['loan:reject', 'application:update', 'loan:approve']));
    expect(reviewer.map((x) => x.to).sort()).toEqual(['APPROVED', 'CANCELLED', 'REJECTED']);
    expect(reviewer.find((x) => x.to === 'APPROVED')).toMatchObject({ implemented: true, permission: 'loan:approve' });
    expect(reviewer.find((x) => x.to === 'REJECTED')).toMatchObject({ requiresReason: true, implemented: true, permission: 'loan:reject' });
    expect(allowedStaffTransitions('UNDER_REVIEW', new Set(['application:read']))).toEqual([]);
    expect(allowedStaffTransitions('SUBMITTED', new Set(['loan:reject'])).map((x) => x.to)).toEqual([]);
    expect(allowedStaffTransitions('DRAFT', new Set(['application:update'])).map((x) => x.to).sort()).toEqual(['CANCELLED', 'SUBMITTED']);
  });
});
