import { render, screen } from '@testing-library/react';
import { bandForScore } from './bureau-utils';
import { ScoreGauge } from './score-gauge';

describe('ScoreGauge', () => {
  it('renders the score and derived band', () => {
    render(<ScoreGauge score={720} min={300} max={850} />);
    expect(screen.getByTestId('score-gauge-value')).toHaveTextContent('720');
    expect(screen.getByTestId('score-gauge-band')).toHaveTextContent('Very good');
    expect(screen.getByTestId('score-gauge')).toHaveAttribute('data-band', 'VERY_GOOD');
    expect(screen.getByRole('img')).toHaveAccessibleName(/720 out of 850, Very good/);
  });
  it('honours an explicit band and per-bureau ranges', () => {
    render(<ScoreGauge score={500} min={250} max={900} band="POOR" label="CRC" />);
    expect(screen.getByTestId('score-gauge-band')).toHaveTextContent('Poor');
    expect(screen.getByText('900')).toBeInTheDocument();
  });
  it('shows an empty state without a score', () => {
    render(<ScoreGauge score={null} />);
    expect(screen.getByTestId('score-gauge-value')).toHaveTextContent('—');
    expect(screen.getByTestId('score-gauge-band')).toHaveTextContent('No score');
  });
  it('splits any range into five even bands', () => {
    expect(bandForScore(300, 300, 850)).toBe('POOR');
    expect(bandForScore(850, 300, 850)).toBe('EXCELLENT');
    expect(bandForScore(5, 0, 10)).toBe('GOOD');
    expect(bandForScore(1000, 300, 850)).toBe('EXCELLENT');
  });
});
