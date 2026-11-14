import { render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { dpdStyle, isRedFacility } from './bureau-utils';
import { FacilityTable } from './facility-table';
import { heatmapMonths, RepaymentHeatmap } from './repayment-heatmap';
import { facility } from './fixtures';

describe('repayment heatmap colour mapping', () => {
  it.each([
    [0, 'current', 'bg-emerald-500'], [1, 'dpd1', 'bg-yellow-400'], [29, 'dpd1', 'bg-yellow-400'], [30, 'dpd30', 'bg-orange-400'],
    [59, 'dpd30', 'bg-orange-400'], [60, 'dpd60', 'bg-orange-600'], [89, 'dpd60', 'bg-orange-600'], [90, 'dpd90', 'bg-red-600'], [180, 'dpd90', 'bg-red-600'],
  ])('maps %i DPD to %s', (dpd, bucket, cls) => {
    expect(dpdStyle(dpd)).toMatchObject({ bucket, className: cls });
  });
  it('uses grey when there is no data', () => {
    expect(dpdStyle(undefined)).toMatchObject({ bucket: 'none', className: 'bg-muted' });
    expect(dpdStyle(null).bucket).toBe('none');
  });
  it('renders one cell per facility x month, oldest to newest, with no-data cells', () => {
    const fs = [facility({ id: 'a', history: [{ month: '2026-08', dpd: 0 }, { month: '2026-09', dpd: 95 }] }), facility({ id: 'b', lender: 'Beta', history: [{ month: '2026-09', dpd: 31 }] })];
    expect(heatmapMonths(fs)).toEqual(['2026-08', '2026-09']);
    render(<TooltipProvider><RepaymentHeatmap facilities={fs} /></TooltipProvider>);
    const cells = screen.getAllByTestId('heat-cell');
    expect(cells.map((c) => c.getAttribute('data-bucket'))).toEqual(['current', 'dpd90', 'none', 'dpd30']);
    expect(screen.getByLabelText('Acme MFB 2026-09: 95 days past due')).toBeInTheDocument();
    expect(screen.getByLabelText('Beta 2026-08: no data')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Legend' })).toBeInTheDocument();
  });
  it('caps the grid at the latest 36 months', () => {
    const history = Array.from({ length: 40 }, (_, i) => ({ month: `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, dpd: 0 }));
    expect(heatmapMonths([{ history }])).toHaveLength(36);
  });
});

describe('red facility highlighting', () => {
  it('flags defaults, write-offs, collections and legal action', () => {
    expect(isRedFacility(facility({ status: 'DEFAULTED' }))).toBe(true);
    expect(isRedFacility(facility({ status: 'WRITTEN_OFF' }))).toBe(true);
    expect(isRedFacility(facility({ soldToCollections: true }))).toBe(true);
    expect(isRedFacility(facility({ legalAction: true }))).toBe(true);
    expect(isRedFacility(facility({ status: 'Unpaid', worstDpd: 45 }))).toBe(false);
    expect(isRedFacility(facility())).toBe(false);
  });
  it('paints only the risky rows red in the facility table and marks conflicts', () => {
    render(
      <TooltipProvider>
        <FacilityTable facilities={[facility({ id: '1', lender: 'Fine Bank' }), facility({ id: '2', lender: 'Bad Lender', status: 'DEFAULTED', conflict: true, sources: ['CRC', 'FIRSTCENTRAL'] }), facility({ id: '3', lender: 'Collector', soldToCollections: true })]} />
      </TooltipProvider>,
    );
    const row = (name: string) => screen.getByText(name).closest('tr')!;
    expect(row('Fine Bank').className).not.toMatch(/bg-destructive/);
    expect(row('Bad Lender').className).toMatch(/bg-destructive\/10/);
    expect(row('Collector').className).toMatch(/bg-destructive\/10/);
    expect(within(row('Bad Lender')).getByTestId('conflict-marker')).toBeInTheDocument();
    expect(within(row('Bad Lender')).getByText('CRC')).toBeInTheDocument();
    expect(within(row('Bad Lender')).getByText('FC')).toBeInTheDocument();
  });
});
