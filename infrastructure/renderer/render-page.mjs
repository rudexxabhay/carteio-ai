// This module is only executed inside the inspected, network-disabled sandbox.
export function permittedResource(raw, hostname, method) {
  try {
    const url = new URL(raw);
    return method === 'GET' && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port && url.hostname === hostname;
  } catch { return false; }
}

/** Actual Playwright implementation; the only network path is the trusted stdio broker. */
export async function renderPage(chromium, input, broker, signal) {
  if (!permittedResource(input.url, input.hostname, 'GET')) throw new Error('BROWSER_NAVIGATION_FAILED');
  let browser;
  let context;
  let requests = 0;
  let resourceLimitExceeded = false;
  const abort = () => { void browser?.close().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    try {
      browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 5000,
        env: { HOME: '/tmp', PATH: '/usr/local/bin:/usr/bin:/bin', PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' } });
    } catch { throw new Error('BROWSER_SANDBOX_FAILED'); }
    signal.throwIfAborted();
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', permissions: [], ignoreHTTPSErrors: false,
      javaScriptEnabled: true, userAgent: 'CarteioKnowledgeBot/1.0 (+website-owner-authorized crawl)', viewport: { width: 1280, height: 900 } });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', async (route) => {
      const request = route.request();
      const redirects = (() => { let count = 0; let previous = request.redirectedFrom(); while (previous) { count++; previous = previous.redirectedFrom(); } return count; })();
      if (++requests > input.maxRequests || redirects > 5) resourceLimitExceeded = true;
      if (signal.aborted || resourceLimitExceeded || !permittedResource(request.url(), input.hostname, request.method())) {
        await route.abort('blockedbyclient'); return;
      }
      try {
        const response = await broker(request.url());
        if (response.blocked || signal.aborted) { await route.abort('blockedbyclient'); return; }
        await route.fulfill({ status: response.status, headers: response.headers, body: Buffer.from(response.body, 'base64') });
      } catch { await route.abort('failed').catch(() => undefined); }
    });
    const page = await context.newPage();
    context.on('page', (other) => { if (other !== page) void other.close(); });
    page.on('download', (download) => { void download.cancel(); });
    page.on('dialog', (dialog) => { void dialog.dismiss(); });
    page.setDefaultTimeout(input.timeoutMs);
    page.setDefaultNavigationTimeout(input.timeoutMs);
    try {
      const response = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: input.timeoutMs });
      if (!response || response.status() < 200 || response.status() >= 400) throw new Error('BROWSER_NAVIGATION_FAILED');
    }
    catch { if (signal.aborted) signal.throwIfAborted(); throw new Error('BROWSER_NAVIGATION_FAILED'); }
    // Hydration is measured by readable text, not by network-idle or a navigation event.
    try {
      await page.waitForFunction(() => {
        const root = document.querySelector('main,[role="main"],article') || document.body;
        if (!root) return false;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node; let count = 0; let text = '';
        while ((node = walker.nextNode())) {
          if (++count > 50_000) return false;
          const parent = node.parentElement;
          if (!parent || parent.closest('a,script,style,noscript,nav,header,footer,aside,form,button,template,iframe,svg,canvas,[hidden],[aria-hidden="true"],[role="navigation"]')) continue;
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || !parent.getClientRects().length || /cookie|consent|advertisement|tracking/i.test(`${parent.className} ${parent.id}`)) continue;
          text += node.textContent || '';
          if (text.length > 200_000) return false;
        }
        text = text.trim();
        return text.length >= 40 && (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 25
          && !(text.length < 160 && /^(loading\b|please wait\b|enable javascript\b|you need to enable javascript\b)/i.test(text));
      }, undefined, { timeout: Math.min(8000, input.timeoutMs), polling: 250 });
    } catch { throw new Error('BROWSER_CONTENT_INSUFFICIENT'); }
    signal.throwIfAborted();
    if (resourceLimitExceeded) throw new Error('BROWSER_RESOURCE_LIMIT');
    if (!permittedResource(page.url(), input.hostname, 'GET')) throw new Error('BROWSER_NAVIGATION_FAILED');
    const extracted = await page.evaluate(() => {
      const elements = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
      let count = 0;
      while (elements.nextNode()) if (++count > 50_000) throw new Error('BROWSER_RESOURCE_LIMIT');
      const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      const root = document.querySelector('main,[role="main"],article') || document.body;
      const pieces = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      let size = 0;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,noscript,nav,header,footer,aside,form,button,template,iframe,svg,canvas,[hidden],[aria-hidden="true"],[role="navigation"]')) continue;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || !parent.getClientRects().length || /cookie|consent|advertisement|tracking/i.test(`${parent.className} ${parent.id}`)) continue;
        const text = node.textContent || '';
        size += text.length;
        if (size > 200_000) throw new Error('BROWSER_RESOURCE_LIMIT');
        if (text.trim()) {
          const block = parent.closest('p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote') || root;
          const previous = pieces.at(-1);
          if (previous?.block === block) previous.text += text;
          else pieces.push({ block, text });
        }
      }
      const links = Array.from(document.querySelectorAll('a[href]')).filter((link) => link.getClientRects().length > 0).slice(0, 2000).map((link) => link.href).filter((url) => url.length <= 2048);
      const canonical = document.querySelector('link[rel="canonical"]')?.href;
      const title = document.title.slice(0, 500);
      const body = pieces.map((piece) => {
        const tag = /^H[1-6]$/.test(piece.block.tagName) ? piece.block.tagName.toLowerCase() : 'p';
        return `<${tag}>${escape(piece.text)}</${tag}>`;
      }).join('\n');
      const html = `<html><head><title>${escape(title)}</title>${canonical ? `<link rel="canonical" href="${escape(canonical)}">` : ''}</head><body><main>${body}</main></body></html>`;
      return { html, links };
    }).catch((error) => {
      // Playwright prefixes evaluation errors; only our bounded safe code is retained.
      if (error instanceof Error && error.message.includes('BROWSER_RESOURCE_LIMIT')) throw new Error('BROWSER_RESOURCE_LIMIT');
      throw new Error('BROWSER_RENDER_FAILED');
    });
    if (Buffer.byteLength(extracted.html) > 1_500_000) throw new Error('BROWSER_RESOURCE_LIMIT');
    if (resourceLimitExceeded) throw new Error('BROWSER_RESOURCE_LIMIT');
    return { ...extracted, url: page.url() };
  } finally {
    signal.removeEventListener('abort', abort);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
