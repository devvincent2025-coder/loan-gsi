import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiClientError } from '@/lib/api';
import { BureauEmptyState, BureauReport, BureauReportView } from './bureau-report';
import { report } from './fixtures';

const mocks = vi.hoisted(() => ({ get: vi.fn(), api: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), get: mocks.get, api: mocks.api }));
vi.mock('@/lib/auth', () => ({ useCan: () => true }));

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>);
};

describe('BureauEmptyState', () => {
  it('offers a Pull report button', async () => {
    const onPull = vi.fn();
    render(<BureauEmptyState canPull onPull={onPull} />);
    expect(screen.getByText(/no credit bureau report yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pull report' }));
    expect(onPull).toHaveBeenCalled();
  });
  it('explains a missing permission instead of the button', () => {
    render(<BureauEmptyState canPull={false} onPull={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Pull report' })).not.toBeInTheDocument();
    expect(screen.getByText(/bureau:pull/)).toBeInTheDocument();
  });
  it('shows the consent-required notice with a link to the consents', () => {
    render(<BureauEmptyState canPull onPull={() => undefined} consentRequired consentsHref="/customers/c1?tab=overview#consents" />);
    expect(screen.getByTestId('consent-required')).toHaveTextContent(/consent is missing/i);
    expect(screen.getByRole('link', { name: /view consents/i })).toHaveAttribute('href', '/customers/c1?tab=overview#consents');
  });
});

describe('BureauReport container', () => {
  beforeEach(() => { mocks.get.mockReset(); mocks.api.mockReset(); });
  it('renders the empty state when no report exists, then handles 403 CONSENT_REQUIRED', async () => {
    mocks.get.mockResolvedValue(null);
    mocks.api.mockRejectedValue(new ApiClientError({ statusCode: 403, code: 'CONSENT_REQUIRED', message: 'Consent required' }));
    wrap(<BureauReport customerId="c1" customerHref="/customers/c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pull report' }));
    expect(await screen.findByTestId('consent-required')).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith('/customers/c1/bureau/pull', expect.objectContaining({ method: 'POST', silent: true }));
  });
  it('renders the report header with a stale badge and force refresh', async () => {
    mocks.get.mockImplementation(async (path: string) => (path.endsWith('/bureau') ? report({ stale: true, ageDays: 45 }) : []));
    wrap(<BureauReport customerId="c1" customerHref="/customers/c1" />);
    expect(await screen.findByTestId('stale-badge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh \(force\)/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/45 day\(s\) old/)).toBeInTheDocument());
  });
});

describe('BureauReportView banners', () => {
  it('shows the red Elsewhere default banner and other policy banners', () => {
    const r = report();
    r.summary = { ...r.summary, elsewhereDefault: true, fraudFlag: true, hasWriteOff24m: true, hasDpd90In12m: true, lastWriteOffMonthsAgo: 6 };
    wrap(<BureauReportView report={r} />);
    expect(screen.getByTestId('elsewhere-default-banner')).toHaveTextContent(/elsewhere default/i);
    expect(screen.getByTestId('fraud-banner')).toBeInTheDocument();
    expect(screen.getByTestId('writeoff-banner')).toBeInTheDocument();
    expect(screen.getByTestId('dpd90-banner')).toBeInTheDocument();
  });
  it('shows no banners for a clean report', () => {
    wrap(<BureauReportView report={report()} />);
    expect(screen.queryByTestId('elsewhere-default-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('bureau-kpis')).toHaveTextContent('Total monthly obligations');
  });
});
