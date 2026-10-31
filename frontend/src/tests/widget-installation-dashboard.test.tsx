import { fireEvent, render, screen } from '@testing-library/react';
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
const response = (payload: unknown, contentType: string) => ({
  ok: true, status: 200,
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
    expect(snippet).not.toMatch(/accessToken|clientSecret|api[_-]?key/i);
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
