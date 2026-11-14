import { render, screen } from '@testing-library/react';
import { APPLICATION_STATUSES } from '@damez/shared';
import { APPLICATION_STATUS_META, StatusChip } from './status-chip';

describe('StatusChip', () => {
  it('maps every one of the 16 application statuses to friendly text', () => {
    expect(APPLICATION_STATUSES).toHaveLength(16);
    for (const s of APPLICATION_STATUSES) {
      const m = APPLICATION_STATUS_META[s];
      expect(m).toBeDefined();
      expect(m.label).not.toMatch(/_/);
      expect(m.hint.length).toBeGreaterThan(5);
    }
  });
  it('renders label and colour variant', () => {
    const { rerender } = render(<StatusChip status="UNDER_REVIEW" />);
    expect(screen.getByText('Under review')).toHaveClass('text-warning');
    rerender(<StatusChip status="REJECTED" />);
    expect(screen.getByText('Not approved')).toHaveClass('text-destructive');
    rerender(<StatusChip status="APPROVED" />);
    expect(screen.getByText('Approved')).toHaveClass('text-success');
  });
});
