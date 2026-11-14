import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FaceKyc, stripImageData, type DojahConnectConfig, type DojahConnectInstance } from './face-kyc';

vi.mock('@/lib/portal-auth', () => ({ usePortalMe: () => ({ firstName: 'Ada', lastName: 'Obi' }) }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const WIDGET_SESSION = {
  referenceId: 'ref-1', mode: 'dojah',
  widget: { appId: 'app', publicKey: 'pub', widgetId: 'widget-1', scriptUrl: 'https://widget.dojah.io/widget.js', environment: 'sandbox' },
};

describe('FaceKyc (Dojah widget)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let lastConfig: DojahConnectConfig | undefined;

  beforeEach(() => {
    lastConfig = undefined;
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/kyc/face/session')) return json(WIDGET_SESSION);
      if (url.endsWith('/kyc/face/complete')) return json({ status: 'FAILED', message: 'Liveness check failed', kycTier: 1, retryAllowed: true, verification: { id: 'v1', status: 'FAILED' } });
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    // The widget script isn't actually fetched in jsdom; stub document.head.appendChild to resolve the script-load promise immediately.
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as unknown as HTMLScriptElement;
      queueMicrotask(() => script.onload?.(new Event('load')));
      return node;
    });
    window.Connect = vi.fn().mockImplementation((cfg: DojahConnectConfig): DojahConnectInstance => {
      lastConfig = cfg;
      return { setup: vi.fn(), open: vi.fn() };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.Connect;
  });

  it('launches the widget with our reference id and posts only the stripped callback payload (no image data)', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<FaceKyc onResult={onResult} />);
    await user.click(screen.getByRole('button', { name: 'Start face check' }));
    await waitFor(() => expect(lastConfig).toBeDefined());

    expect(lastConfig?.metadata).toEqual({ reference_id: 'ref-1' });
    expect(lastConfig?.user_data).toEqual({ first_name: 'Ada', last_name: 'Obi' });

    lastConfig?.onSuccess?.({ event: 'success', selfie: 'x', blob: 'data:image/png;base64,AAA', ok: true });
    await screen.findByTestId('face-result');

    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/kyc/face/complete'))!;
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.referenceId).toBe('ref-1');
    expect(JSON.stringify(body)).not.toMatch(/data:image/);
    expect(screen.getByTestId('face-result')).toHaveAttribute('data-status', 'FAILED');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });

  it('shows an error if the widget reports one', async () => {
    const user = userEvent.setup();
    render(<FaceKyc />);
    await user.click(screen.getByRole('button', { name: 'Start face check' }));
    await waitFor(() => expect(lastConfig).toBeDefined());
    lastConfig?.onError?.({ message: 'Camera permission denied' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera permission denied');
  });
});

describe('stripImageData', () => {
  it('removes image-like keys and data URIs', () => {
    expect(stripImageData({ event: 'success', data: { selfie: 'x', status: true, nested: { image: 'y', ok: 1, blob: 'data:image/png;base64,AAA' } } })).toEqual({ event: 'success', data: { status: true, nested: { ok: 1 } } });
  });
});
