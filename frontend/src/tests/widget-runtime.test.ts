// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Read the shipped script from disk; Vite rewrites static asset URL expressions
// to browser URLs, which are not accepted by Node's fileURLToPath.
const runtime = readFileSync(resolve(process.cwd(), 'public/widget.js'), 'utf8');
const publicId = 'widget_public_id_123456';
const appearance = {
  name: 'Store assistant', welcomeMessage: 'Welcome to our store', color: '#102a43', userBubbleColor: '#245c8a',
  position: 'right', fontFamily: 'system', desktopSize: 'medium', width: 380, height: 590,
  mobileWidth: 420, mobileHeight: 720, cornerRadius: 20, launcherSize: 58, avatarUrl: null, suggestions: [],
};
const jsonResponse = (payload: unknown) => ({
  ok: true, status: 200,
  headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
  json: async () => payload,
});
async function waitForWidget(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Widget runtime did not reach the expected state');
}
function installScript() {
  const script = document.createElement('script');
  script.src = 'https://widget-host.example/widget.js?v=old-compatible-version';
  script.dataset.widgetId = publicId;
  document.body.append(script);
  return script;
}

describe('public widget runtime appearance and avatar lifecycle', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as any).__carteioWidgetInstances;
    delete (window as any).__carteioWidgetOwners;
    Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: () => 'request-id' });
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ assistant: appearance }));
    Object.defineProperty(window, 'fetch', { configurable: true, value: fetchMock });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('keeps the host hidden until saved appearance is applied and shows the built-in icon without an avatar URL', async () => {
    let release!: (value: ReturnType<typeof jsonResponse>) => void;
    fetchMock.mockReturnValueOnce(new Promise<ReturnType<typeof jsonResponse>>((resolve) => { release = resolve; }));
    installScript();
    window.eval(runtime);
    const host = document.querySelector<HTMLElement>('[data-carteio-widget-host]')!;
    const shadow = host.shadowRoot!;
    expect(host.style.visibility).toBe('hidden');
    expect(shadow.querySelector('.launcher')?.hasAttribute('hidden')).toBe(true);
    expect(shadow.querySelector('.panel')?.hasAttribute('hidden')).toBe(true);
    release(jsonResponse({ assistant: appearance }));
    await waitForWidget(() => host.style.visibility === 'visible');
    expect(shadow.querySelector('.identity strong')?.textContent).toBe('Store assistant');
    expect(shadow.querySelector('.panel')?.getAttribute('style')).toContain('--brand: #102a43');
    expect(shadow.querySelector('.avatar svg')).not.toBeNull();
    expect(shadow.querySelector('.avatar img')).toBeNull();
  });

  it('uses the customer avatar after it loads and falls back to the icon when it errors', async () => {
    const images: HTMLImageElement[] = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
      const element = createElement(tag, options);
      if (tag === 'img') images.push(element as HTMLImageElement);
      return element;
    }) as typeof document.createElement);

    fetchMock.mockResolvedValueOnce(jsonResponse({ assistant: { ...appearance, avatarUrl: 'https://images.example/avatar.png' } }));
    installScript();
    window.eval(runtime);
    const host = document.querySelector<HTMLElement>('[data-carteio-widget-host]')!;
    const avatar = host.shadowRoot!.querySelector('.avatar')!;
    await waitForWidget(() => images.length === 1);
    const image = images[0]!;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 64 });
    image.dispatchEvent(new window.Event('load'));
    await waitForWidget(() => host.style.visibility === 'visible');
    expect(avatar.querySelector('img')?.src).toBe('https://images.example/avatar.png');
    expect(avatar.querySelector('svg')).toBeNull();

    document.body.innerHTML = '';
    delete (window as any).__carteioWidgetInstances;
    delete (window as any).__carteioWidgetOwners;
    fetchMock.mockResolvedValueOnce(jsonResponse({ assistant: { ...appearance, avatarUrl: 'https://images.example/broken.png' } }));
    installScript();
    window.eval(runtime);
    const brokenHost = document.querySelector<HTMLElement>('[data-carteio-widget-host]')!;
    const brokenAvatar = brokenHost.shadowRoot!.querySelector('.avatar')!;
    await waitForWidget(() => images.length === 2);
    images[1]!.dispatchEvent(new window.Event('error'));
    await waitForWidget(() => brokenHost.style.visibility === 'visible');
    expect(brokenAvatar.querySelector('img')).toBeNull();
    expect(brokenAvatar.querySelector('svg')).not.toBeNull();
  });

  it('removes the widget when appearance is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html' : null },
      json: async () => { throw new Error('HTML must not be parsed as configuration'); },
    });
    installScript();
    window.eval(runtime);
    const host = document.querySelector<HTMLElement>('[data-carteio-widget-host]')!;
    await waitForWidget(() => !host.isConnected);
    const shadow = host.shadowRoot!;
    expect(document.querySelector('[data-carteio-widget-host]')).toBeNull();
    expect(shadow.querySelector('.launcher')?.hasAttribute('hidden')).toBe(true);
    expect(shadow.querySelector('.panel')?.hasAttribute('hidden')).toBe(true);
    expect(shadow.querySelector('.identity strong')?.textContent).toBe('');
  });

  it('marks the widget connected only after bootstrap returns valid signed-session credentials', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/widgets/configuration')) return jsonResponse({ assistant: appearance });
      if (path.endsWith('/widgets/bootstrap')) return jsonResponse({ accessToken: `${'a'.repeat(64)}.${'b'.repeat(43)}`, resumeToken: 'r'.repeat(43), expiresIn: 900 });
      if (path.endsWith('/widgets/session/history')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      if (path.endsWith('/widgets/session/deliveries')) return jsonResponse({ items: [], nextCursor: null });
      throw new Error(`Unexpected widget request: ${path}`);
    });
    installScript();
    window.eval(runtime);
    const host = document.querySelector<HTMLElement>('[data-carteio-widget-host]')!;
    await waitForWidget(() => host.style.visibility === 'visible');
    const shadow = host.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>('.launcher')!.click();
    await waitForWidget(() => shadow.querySelector('.connection-status span')?.textContent === 'Connected');
    expect(shadow.querySelector('.panel')?.hasAttribute('hidden')).toBe(false);
    shadow.querySelector<HTMLButtonElement>('.close')!.click();
  });

  it('does not claim connected for a malformed bootstrap response and keeps the saved design usable', async () => {
    fetchMock.mockImplementation(async (input: string) => new URL(input).pathname.endsWith('/widgets/configuration')
      ? jsonResponse({ assistant: appearance })
      : jsonResponse({ accessToken: '', resumeToken: '', expiresIn: 0 }));
    installScript();
    window.eval(runtime);
    const host = document.querySelector<HTMLElement>('[data-carteio-widget-host]')!;
    await waitForWidget(() => host.style.visibility === 'visible');
    const shadow = host.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>('.launcher')!.click();
    await waitForWidget(() => shadow.querySelector('.error-state')?.hasAttribute('hidden') === false);
    expect(shadow.querySelector('.connection-status span')?.textContent).not.toBe('Connected');
    expect(shadow.querySelector('.identity strong')?.textContent).toBe('Store assistant');
    shadow.querySelector<HTMLButtonElement>('.close')!.click();
  });

  it('keeps one host for repeated execution of a compatible versioned embed', async () => {
    installScript();
    window.eval(runtime);
    await waitForWidget(() => Boolean(document.querySelector('[data-carteio-widget-host]')));
    window.eval(runtime);
    expect(document.querySelectorAll('[data-carteio-widget-host]').length).toBe(1);
  });

  it('routes the explicit raise-ticket shortcut through the existing AI conversation endpoint', async () => {
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path.endsWith('/widgets/configuration')) return jsonResponse({ assistant: appearance });
      if (path.endsWith('/widgets/bootstrap')) return jsonResponse({ accessToken: `${'a'.repeat(64)}.${'b'.repeat(43)}`, resumeToken: 'r'.repeat(43), expiresIn: 900 });
      if (path.endsWith('/widgets/session/history')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      if (path.endsWith('/widgets/session/deliveries')) return jsonResponse({ items: [], nextCursor: null });
      if (path.endsWith('/widgets/session/messages')) {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({ message: { id: body.content === 'I would like to raise a support ticket.' ? 'ai-ticket-guidance' : 'ai-chat-reply', sender: 'assistant', content: body.content === 'I would like to raise a support ticket.' ? 'What happened?' : 'Here is the answer.', createdAt: new Date().toISOString(), ...(body.content === 'Where can I find the product catalog?' ? { sourceIndicator: { generationType: 'AI_GENERATED', evidenceSources: ['SHOPIFY', 'KNOWLEDGE_BASE'] } } : {}) }, sources: [] });
      }
      if (path.endsWith('/widgets/session/tickets/status')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ reference: 'TKT-0123456789' });
        expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
        return jsonResponse({ reference: 'TKT-0123456789', status: 'OPEN', title: 'Support request', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(), timeline: [] });
      }
      throw new Error(`Unexpected widget request: ${path}`);
    });
    installScript();
    window.eval(runtime);
    const host = document.querySelector<HTMLElement>('[data-carteio-widget-host]')!;
    await waitForWidget(() => host.style.visibility === 'visible');
    const shadow = host.shadowRoot!;
    const body = shadow.querySelector('.body')!;
    const footer = shadow.querySelector('.composer-footer')!;
    const styles = shadow.querySelector('style')!.textContent || '';
    expect(shadow.querySelector('.tools')).toBeNull();
    expect(body.querySelector('.raise-ticket')).toBeNull();
    expect(body.querySelector('.track-ticket')).toBeNull();
    expect(footer.querySelector('.raise-ticket')).not.toBeNull();
    expect(footer.querySelector('.track-ticket')).not.toBeNull();
    expect(footer.querySelector('.compose')).not.toBeNull();
    expect(styles).toMatch(/\.body\{[^}]*overflow:auto/);
    expect(styles).toMatch(/\.ticket-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    expect(styles).toContain('@media(max-width:600px)');
    expect(styles).toMatch(/\.ticket-actions button\{min-height:40px/);
    expect(styles).toMatch(/\.answer-source-indicator\{display:flex;flex-wrap:wrap/);
    shadow.querySelector<HTMLButtonElement>('.launcher')!.click();
    await waitForWidget(() => shadow.querySelector('.connection-status span')?.textContent === 'Connected');
    shadow.querySelector<HTMLButtonElement>('.raise-ticket')!.click();
    await waitForWidget(() => Boolean(shadow.querySelector('[data-mid="ai-ticket-guidance"]')));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/widgets/session/messages'))).toBe(true);
    shadow.querySelector<HTMLButtonElement>('.track-ticket')!.click();
    const lookup = shadow.querySelector('.ticket-lookup')!;
    lookup.querySelector<HTMLInputElement>('input')!.value = 'TKT-0123456789';
    lookup.querySelector<HTMLButtonElement>('button')!.click();
    await waitForWidget(() => Boolean(shadow.querySelector('.ticket-card')));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/widgets/session/tickets/status'))).toBe(true);
    const field = shadow.querySelector<HTMLInputElement>('.compose input')!;
    field.value = 'Where can I find the product catalog?';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    shadow.querySelector<HTMLFormElement>('.compose')!.requestSubmit();
    await waitForWidget(() => Boolean(shadow.querySelector('[data-mid="ai-chat-reply"]')));
    const indicator = shadow.querySelector('[data-mid="ai-chat-reply"] .answer-source-indicator')!;
    expect(indicator.textContent).toContain('AI generated');
    expect(indicator.textContent).toContain('Shopify data');
    expect(indicator.textContent).toContain('Knowledge Base');
    expect(shadow.querySelector('[data-mid="ai-chat-reply"] .stamp')!.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    shadow.querySelector<HTMLButtonElement>('.close')!.click();
  });
});
