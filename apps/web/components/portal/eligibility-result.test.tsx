import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EligibilityCustomerDto } from '@damez/shared';
import { EligibilityResultView } from './eligibility-result';

const base = { id: 'e1', requested: { productId: 'p1', amountKobo: 50_000_000, tenorMonths: 6 }, maxAmountKobo: 12_000_000, alternatives: [] };

const eligible: EligibilityCustomerDto = {
  ...base, outcome: 'ELIGIBLE', headline: 'Good news, you qualify', summary: 'You can borrow what you asked for.',
  reasons: [{ message: 'Clean repayment history', severity: 'POSITIVE' }], suggestions: [],
};
const conditional: EligibilityCustomerDto = {
  ...base, outcome: 'CONDITIONAL', headline: 'We can offer less', summary: 'A smaller amount fits your income.',
  reasons: [{ message: 'Repayment would be a large part of your income', severity: 'WARNING' }, { message: 'Too many recent enquiries', severity: 'BLOCKER' }],
  suggestions: [
    { type: 'REDUCE_AMOUNT', customerMessage: 'Borrow less', amountKobo: 12_000_000, tenorMonths: 6 },
    { type: 'LONGER_TENOR', customerMessage: 'Spread it out', tenorMonths: 9 },
    { type: 'UPGRADE_KYC', customerMessage: 'Verify more to raise your limit' },
  ],
  alternatives: [{ productId: 'p2', productName: 'Quick Cash', amountKobo: 5_000_000, tenorMonths: 3, monthlyRepaymentKobo: 1_900_000, monthlyRateBps: 500, note: 'Smaller and faster' }],
};
const ineligible: EligibilityCustomerDto = {
  ...base, outcome: 'INELIGIBLE', headline: 'Not this time', summary: 'We cannot offer a loan right now.', maxAmountKobo: 0,
  reasons: [{ message: 'An existing loan is overdue', severity: 'BLOCKER' }],
  suggestions: [{ type: 'REAPPLY_LATER', customerMessage: 'Try again later', reapplyDate: '2027-03-14' }],
};

describe('EligibilityResultView', () => {
  it('ELIGIBLE shows headline and positive reason', () => {
    render(<EligibilityResultView result={eligible} />);
    expect(screen.getByTestId('eligibility-result')).toHaveAttribute('data-outcome', 'ELIGIBLE');
    expect(screen.getByText('Good news, you qualify')).toBeInTheDocument();
    expect(screen.getByText('Clean repayment history')).toBeInTheDocument();
    expect(screen.queryByText('What you can do')).toBeNull();
  });

  it('CONDITIONAL ranks blockers first and offers actionable suggestions and alternatives', async () => {
    const onSuggestion = vi.fn();
    const onAlt = vi.fn();
    render(<EligibilityResultView result={conditional} onApplySuggestion={onSuggestion} onApplyAlternative={onAlt} />);
    const reasons = screen.getAllByText(/enquiries|large part/);
    expect(reasons[0]).toHaveTextContent('Too many recent enquiries');
    await userEvent.click(screen.getByRole('button', { name: /Borrow ₦120,000 instead/ }));
    expect(onSuggestion).toHaveBeenCalledWith({ amountKobo: 12_000_000, tenorMonths: 6 });
    await userEvent.click(screen.getByRole('button', { name: 'Choose 9 months' }));
    expect(onSuggestion).toHaveBeenLastCalledWith({ tenorMonths: 9, amountKobo: undefined });
    expect(screen.getByRole('link', { name: /Upgrade your KYC/ })).toHaveAttribute('href', '/portal/onboarding');
    await userEvent.click(screen.getByRole('button', { name: 'Apply for this' }));
    expect(onAlt).toHaveBeenCalledWith(conditional.alternatives[0]);
  });

  it('INELIGIBLE shows the blocker and the reapply date', () => {
    render(<EligibilityResultView result={ineligible} />);
    expect(screen.getByTestId('eligibility-result')).toHaveAttribute('data-outcome', 'INELIGIBLE');
    expect(screen.getByText('An existing loan is overdue')).toBeInTheDocument();
    expect(screen.getByText(/Reapply on 14 Mar 2027/)).toBeInTheDocument();
  });
});
