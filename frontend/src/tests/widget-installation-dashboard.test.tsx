import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pages from '../dashboard-source/pages';
import { listAssistants } from '../services/api/assistants';
import { getWidgetConfig } from '../services/api/widget';

vi.mock('../services/api/assistants', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api/assistants')>();
  return { ...actual, listAssistants: vi.fn() };
});
vi.mock('../services/api/widget', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api/widget')>();
  return { ...actual, getWidgetConfig: vi.fn(), saveWidgetConfig: vi.fn() };
});

const widget = {
  assistantId: 'assistant-current', publicId: 'widget_public_id_current', enabled: true,
  allowedDomains: ['shop.example.test'],
  appearance: {
    name: 'Current assistant', welcomeMessage: 'Welcome', color: '#3157d5', userBubbleColor: '#3157d5',
    position: 'right' as const, fontFamily: 'system' as const, desktopSize: 'medium' as const,
    width: 380, height: 590, mobileWidth: 420, mobileHeight: 720, cornerRadius: 20,
    launcherSize: 58, avatarUrl: null, suggestions: [],
  },
};
const response = (payload: unknown, contentType: string, ok = true, status = 200) => ({
  ok, status,
  headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
  json: async () => payload,
});

describe('active dashboard widget installation flow', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAssistants).mockResolvedValue({ assistants: [{ id: widget.assistantId, name: 'Current assistant', status: 'active' }] as never, page: 1, pageSize: 100, total: 1 });
    vi.mocked(getWidgetConfig).mockResolvedValue(widget);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes('/widget.js') ? response('', 'application/javascript') : response({ status: 'ready' }, 'application/json');
    }));
  });

  it('generates an async, public-ID-only snippet for the selected active assistant and approved host', async () => {
    const { container } = render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
    expect(await screen.findByText(/data-widget-id="widget_public_id_current"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy installation code' })).toBeEnabled();
    expect(document.body.textContent).toContain('shop.example.test');
    expect(screen.getByText(/Shopify uses direct manual theme-code insertion here, not its ScriptTag API/i)).toBeInTheDocument();
    const snippet = container.querySelector('pre code')?.textContent ?? '';
    expect(snippet).toMatch(/^<script async src="https?:\/\/.+\/widget\.js" data-widget-id="widget_public_id_current"/);
    expect(snippet).toContain(`src="${window.location.origin}/widget.js"`);
    expect(snippet).not.toMatch(/accessToken|clientSecret|api[_-]?key/i);
  });

  it('copies the generated snippet and resolves the same saved public ID after reload', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const first = render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
      const code = await screen.findByText(/data-widget-id="widget_public_id_current"/);
      const snippet = code.textContent;
      fireEvent.click(screen.getByRole('button', { name: 'Copy installation code' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(snippet));
      first.unmount();
      render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
      expect(await screen.findByText(/data-widget-id="widget_public_id_current"/)).toBeInTheDocument();
      expect(getWidgetConfig).toHaveBeenLastCalledWith('workspace-current', widget.assistantId, expect.any(AbortSignal));
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('reports a missing public asset without showing it as available', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/widget.js')
      ? response('', 'text/html', false, 404)
      : response({ status: 'ready' }, 'application/json')));
    render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy installation code' })).toBeDisabled();
    expect(screen.queryByText(/data-widget-id=/)).not.toBeInTheDocument();
  });

  it('withholds installation code for an invalid saved hostname', async () => {
    vi.mocked(getWidgetConfig).mockResolvedValue({ ...widget, allowedDomains: ['https://shop.example.test/path'] });
    render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
    expect(await screen.findByRole('button', { name: 'Copy installation code' })).toBeDisabled();
    expect(screen.queryByText(/data-widget-id=/)).not.toBeInTheDocument();
  });

  it('withholds installation code for a malformed public widget ID', async () => {
    vi.mocked(getWidgetConfig).mockResolvedValue({ ...widget, publicId: 'invalid' });
    render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
    expect(await screen.findByRole('button', { name: 'Copy installation code' })).toBeDisabled();
    expect(screen.queryByText(/data-widget-id=/)).not.toBeInTheDocument();
  });

  it('keeps the valid snippet available when a browser CORS restriction prevents probing the public asset', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/widget.js')) throw new TypeError('Failed to fetch');
      return response({ status: 'ready' }, 'application/json');
    }));
    const { container } = render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
    expect(await screen.findByText(/data-widget-id="widget_public_id_current"/)).toBeInTheDocument();
    expect(await screen.findByText('Could not verify')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy installation code' })).toBeEnabled();
    expect(container.querySelector('pre code')?.textContent).toContain('/widget.js');
  });

  it('withholds the installation snippet when the saved widget is disabled', async () => {
    vi.mocked(getWidgetConfig).mockResolvedValue({ ...widget, enabled: false });
    render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
    expect(await screen.findByRole('button', { name: 'Copy installation code' })).toBeDisabled();
    expect(screen.getByText(/Enable the widget before installation/i)).toBeInTheDocument();
  });

  it('does not report an unsaved enablement as configured or generate a snippet', async () => {
    vi.mocked(getWidgetConfig).mockResolvedValue({ ...widget, enabled: false });
    render(<Pages page="install" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-current"/>);
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable this website widget' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy installation code' })).toBeDisabled();
  });
});
