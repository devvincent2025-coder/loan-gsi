import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MaskedField } from './masked-field';

const setup = (props: Partial<React.ComponentProps<typeof MaskedField>> = {}) =>
  render(
    <TooltipProvider>
      <MaskedField label="BVN" masked="•••••••4821" canReveal onReveal={async () => '22212344821'} {...props} />
    </TooltipProvider>,
  );

describe('MaskedField', () => {
  it('shows the masked value by default', () => {
    setup();
    expect(screen.getByTestId('masked-value')).toHaveTextContent('•••••••4821');
    expect(screen.queryByText('22212344821')).not.toBeInTheDocument();
  });

  it('disables reveal without permission', () => {
    setup({ canReveal: false });
    expect(screen.getByRole('button', { name: /reveal bvn/i })).toBeDisabled();
  });

  it('requires a reason of at least 5 characters', async () => {
    const onReveal = vi.fn(async () => 'clear');
    const user = userEvent.setup();
    setup({ onReveal });
    await user.click(screen.getByRole('button', { name: /reveal bvn/i }));
    expect(screen.getByText(/revealing is logged/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/reason for revealing/i), 'abc');
    await user.click(screen.getByRole('button', { name: /reveal for/i }));
    expect(onReveal).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 5/i);
  });

  it('reveals with a reason then re-masks automatically', async () => {
    const onReveal = vi.fn(async () => '22212344821');
    const user = userEvent.setup();
    setup({ onReveal, revealMs: 80 });
    await user.click(screen.getByRole('button', { name: /reveal bvn/i }));
    await user.type(screen.getByLabelText(/reason for revealing/i), 'KYC check');
    await user.click(screen.getByRole('button', { name: /reveal for/i }));
    await waitFor(() => expect(screen.getByTestId('masked-value')).toHaveTextContent('22212344821'));
    expect(onReveal).toHaveBeenCalledWith('KYC check');
    await waitFor(() => expect(screen.getByTestId('masked-value')).toHaveTextContent('•••••••4821'), { timeout: 1500 });
    await act(async () => {});
  });
});
