import { render, screen } from '@testing-library/react';
import { KpiCard } from './kpi-card';

describe('KpiCard', () => {
  it('renders value and a green delta for a good increase', () => {
    render(<KpiCard label="Disbursed" value="₦1.2M" delta={4.2} sparkline={[1, 2, 3]} />);
    expect(screen.getByTestId('kpi-value')).toHaveTextContent('₦1.2M');
    expect(screen.getByTestId('kpi-delta')).toHaveAttribute('data-good', 'good');
    expect(screen.getByTestId('kpi-delta')).toHaveTextContent('4.2%');
  });
  it('inverts colouring when invertDelta is set', () => {
    render(<KpiCard label="PAR30" value="6%" delta={2} invertDelta />);
    expect(screen.getByTestId('kpi-delta')).toHaveAttribute('data-good', 'bad');
  });
  it('shows a skeleton while loading', () => {
    render(<KpiCard loading label="x" value="y" />);
    expect(screen.getByTestId('kpi-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-value')).not.toBeInTheDocument();
  });
});
