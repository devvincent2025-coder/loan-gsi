import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, filterRows, rowsToCsv, sortRows, type DataColumn } from './data-table';

interface R { id: string; name: string; amount: number }
const data: R[] = [
  { id: '1', name: 'Bola', amount: 300 },
  { id: '2', name: 'Ada', amount: 100 },
  { id: '3', name: 'Chidi, "Jr"', amount: 200 },
];
const columns: DataColumn<R>[] = [
  { id: 'name', header: 'Name', sortable: true, accessor: (r) => r.name },
  { id: 'amount', header: 'Amount', sortable: true, accessor: (r) => r.amount },
];

describe('data-table helpers', () => {
  it('sorts asc/desc by accessor', () => {
    expect(sortRows(data, columns, { id: 'amount', desc: false }).map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(sortRows(data, columns, { id: 'name', desc: true }).map((r) => r.id)).toEqual(['3', '1', '2']);
  });
  it('filters by global text', () => {
    expect(filterRows(data, columns, 'ada').map((r) => r.id)).toEqual(['2']);
  });
  it('generates escaped CSV', () => {
    const csv = rowsToCsv(columns, data);
    expect(csv.split('\r\n')[0]).toBe('Name,Amount');
    expect(csv).toContain('"Chidi, ""Jr""",200');
  });
});

describe('<DataTable />', () => {
  it('renders rows, sorts on header click and filters via search', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} rowKey={(r) => r.id} />);
    const body = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(body()).toEqual(['Bola', 'Ada', 'Chidi, "Jr"']);
    await user.click(screen.getByRole('button', { name: /amount/i }));
    expect(body()).toEqual(['Ada', 'Chidi, "Jr"', 'Bola']);
    await user.type(screen.getByLabelText('Search table'), 'bola');
    expect(body()).toEqual(['Bola']);
  });
  it('shows skeleton rows and empty state', () => {
    const { rerender } = render(<DataTable columns={columns} data={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0);
    rerender(<DataTable columns={columns} data={[]} rowKey={(r) => r.id} emptyTitle="Nothing" />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });
});
