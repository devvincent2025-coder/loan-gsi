import { render, screen, within } from '@testing-library/react';
import type { OnboardingState } from '@damez/shared';
import { OnboardingStepper, progressSummary } from './stepper';

const state: OnboardingState = {
  currentStep: 'BVN',
  kycTier: 0,
  maxLoanKobo: 0,
  completed: false,
  tiers: [],
  steps: [
    { key: 'ACCOUNT', label: 'Account', description: '', status: 'DONE', required: true, detail: null },
    { key: 'EMAIL', label: 'Verify email', description: 'Confirm your email', status: 'DONE', required: true, detail: 'Email verified' },
    { key: 'PROFILE', label: 'Your details', description: 'Tell us about you', status: 'DONE', required: true, detail: null },
    { key: 'BVN', label: 'Verify BVN', description: 'Check your BVN', status: 'CURRENT', required: true, detail: null },
    { key: 'FACE', label: 'Selfie check', description: 'Face match', status: 'LOCKED', required: true, detail: 'Needs BVN first' },
    { key: 'ADDRESS', label: 'Home address', description: 'Unlocks Tier 3', status: 'OPTIONAL', required: false, detail: null },
  ],
};

describe('OnboardingStepper', () => {
  it('renders the vertical list from the state, hides ACCOUNT and marks the active step', () => {
    render(<OnboardingStepper state={state} active="BVN" />);
    const list = screen.getByTestId('stepper-vertical');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(within(list).queryByText('Account')).toBeNull();
    expect(items[2]).toContainElement(within(list).getByRole('button', { name: /Verify BVN/ }));
    expect(within(list).getByRole('button', { name: /Verify BVN/ })).toHaveAttribute('aria-current', 'step');
    expect(items[3]).toHaveAttribute('data-status', 'LOCKED');
    expect(within(list).getByRole('button', { name: /Home address/ })).toHaveTextContent('Optional');
  });
  it('renders the compact mobile progress with the step title', () => {
    render(<OnboardingStepper state={state} active="BVN" />);
    const compact = screen.getByTestId('stepper-compact');
    expect(within(compact).getByText('Verify BVN')).toBeInTheDocument();
    expect(within(compact).getByText('Step 3 of 5')).toBeInTheDocument();
    expect(within(compact).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  });
  it('summarises required progress', () => {
    expect(progressSummary(state)).toEqual({ done: 2, total: 4, pct: 50 });
  });
});
