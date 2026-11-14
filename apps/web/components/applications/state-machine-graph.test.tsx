import { render, screen } from '@testing-library/react';
import { APPLICATION_STATUSES, type ApplicationStatus, type StateMachineDto } from '@damez/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { nodeState, StateMachineGraph } from './state-machine-graph';

const PHASE: Record<ApplicationStatus, StateMachineDto['states'][number]['phase']> = {
  DRAFT: 'ORIGINATION', SUBMITTED: 'ORIGINATION', KYC_PENDING: 'ORIGINATION', BUREAU_CHECK: 'ORIGINATION', UNDER_REVIEW: 'DECISION', APPROVED: 'DECISION',
  OFFER_SENT: 'DECISION', OFFER_ACCEPTED: 'DECISION', DISBURSED: 'BOOKED', ACTIVE: 'BOOKED', Unpaid: 'RECOVERY', RESTRUCTURED: 'RECOVERY',
  CLOSED: 'END', WRITTEN_OFF: 'END', REJECTED: 'END', CANCELLED: 'END',
};
const IMPLEMENTED = new Set<ApplicationStatus>(['DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED']);
const machine: StateMachineDto = {
  states: APPLICATION_STATUSES.map((key) => ({ key, label: key.replace(/_/g, ' '), phase: PHASE[key], terminal: ['CLOSED', 'WRITTEN_OFF', 'REJECTED', 'CANCELLED'].includes(key), implemented: IMPLEMENTED.has(key) })),
  transitions: [{ from: 'UNDER_REVIEW', to: 'APPROVED', actor: 'STAFF', permission: 'application:update', label: 'Approve', implemented: true }, { from: 'APPROVED', to: 'OFFER_SENT', actor: 'STAFF', permission: null, label: 'Send offer', implemented: false }],
};
const node = (label: string) => screen.getAllByTestId('sm-node').find((n) => n.textContent === label)!;
const stateOf = (label: string) => node(label).getAttribute('data-state');

describe('StateMachineGraph', () => {
  const setup = () => render(<TooltipProvider><StateMachineGraph machine={machine} current="UNDER_REVIEW" visited={['DRAFT', 'SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'UNDER_REVIEW']} /></TooltipProvider>);
  it('renders all 16 states', () => {
    setup();
    expect(screen.getAllByTestId('sm-node')).toHaveLength(16);
  });
  it('highlights the current state, ticks past states and dims unimplemented ones', () => {
    setup();
    expect(stateOf('UNDER REVIEW')).toBe('current');
    expect(node('UNDER REVIEW')).toHaveAttribute('aria-current', 'step');
    expect(stateOf('DRAFT')).toBe('past');
    expect(stateOf('BUREAU CHECK')).toBe('past');
    expect(stateOf('APPROVED')).toBe('future');
    expect(stateOf('DISBURSED')).toBe('dimmed');
    expect(stateOf('OFFER SENT')).toBe('dimmed');
    expect(screen.getAllByLabelText('completed')).toHaveLength(4);
  });
  it('draws rejected, cancelled and written off on the red exit branch', () => {
    setup();
    const exits = screen.getAllByTestId('sm-node').filter((n) => n.getAttribute('data-exit') === 'true').map((n) => n.textContent);
    expect(exits.sort()).toEqual(['CANCELLED', 'REJECTED', 'WRITTEN OFF'].sort());
    expect(stateOf('WRITTEN OFF')).toBe('dimmed');
  });
  it('computes node state precedence', () => {
    expect(nodeState('DRAFT', false, 'DRAFT', ['DRAFT'])).toBe('current');
    expect(nodeState('DRAFT', false, 'SUBMITTED', ['DRAFT'])).toBe('past');
    expect(nodeState('ACTIVE', false, 'SUBMITTED', [])).toBe('dimmed');
    expect(nodeState('ACTIVE', true, 'SUBMITTED', [])).toBe('future');
  });
});
