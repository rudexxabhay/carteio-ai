// Focused Node runner avoids Jest discovery on the Windows-mounted dependency tree.
// TypeScript is transpiled in memory; no build artifacts, Prisma generation or servers.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const childProcess = require('node:child_process');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true,
  }, fileName: filename });
  module._compile(output.outputText, filename);
};
const crawler = require('../src/modules/workspaces/website-crawler.ts');
const rendering = require('../src/modules/workspaces/website-renderer.ts');
const sync = require('../src/modules/workspaces/website-sync.ts');
const context = (overrides = {}) => ({ authorized: true, hostname: 'business.com', pathAllowed: () => true,
  signal: new AbortController().signal, deadline: Date.now() + 5000, load: async () => { throw new Error('unexpected load'); }, ...overrides });
const url = new URL('https://business.com/');
const shell = '<html><head><title>Business</title></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const html = '<html><head><title>Company</title><link rel="canonical" href="/policies"></head><body><nav>Help Contact Home</nav><main><h1>Company policy</h1><p>Eligible requests may be submitted within 7 days of delivery. हमारी नीति में सात दिन हैं।</p></main><a href="/faq">FAQ</a></body></html>';
const available = { configured: true, code: null, message: 'fixture renderer' };

test('meaningful HTML succeeds without invoking the renderer', async () => {
  const result = await crawler.extractWebsitePage(html, url, 0, { availability: available, render: () => { throw new Error('renderer called'); } }, context());
  assert.equal(result.page.extractionMethod, 'HTML'); assert.equal(result.page.url, 'https://business.com/policies');
  assert(result.page.content.includes('7 days')); assert(result.page.content.includes('सात दिन'));
});
test('empty SPA shell automatically requests fallback and preserves actual rendered links/provenance', async () => {
  let calls = 0;
  const result = await crawler.extractWebsitePage(shell, url, 0, { availability: available, render: async (request) => {
    calls++; assert.equal(request.authorized, true); return { html, url: url.href, links: ['https://business.com/faq', 'https://business.com/privacy'] };
  } }, context());
  assert.equal(calls, 1); assert.equal(result.page.extractionMethod, 'BROWSER_RENDERED');
  assert.equal(result.page.url, 'https://business.com/policies'); assert.deepEqual(result.links, ['https://business.com/faq', 'https://business.com/privacy']);
});
test('navigation-only and loading placeholders cannot be indexed as meaningful content', () => {
  for (const body of ['<nav>' + 'Home FAQ Contact '.repeat(8) + '</nav>', '<div>' + '<a href="/">Navigation item</a>'.repeat(8) + '</div>', '<main>Loading your expense dashboard. Please wait while it loads...</main>']) {
    assert.equal(crawler.extractHtmlPage(`<html><head><title>${'Long title '.repeat(15)}</title></head><body>${body}</body></html>`, url, 0), null);
  }
});
test('disabled fallback produces a specific configuration error, not fake pages', async () => {
  const renderer = new rendering.IsolatedContainerRenderer('', {});
  await assert.rejects(crawler.extractWebsitePage(shell, url, 0, renderer, context()), { code: 'BROWSER_RENDERING_NOT_CONFIGURED' });
});
test('unauthorized sources never reach a renderer', async () => {
  await assert.rejects(crawler.extractWebsitePage(shell, url, 0, { availability: available, render: () => assert.fail('unverified render') }, context({ authorized: false })), { code: 'WEBSITE_CRAWL_NOT_AUTHORIZED' });
});
test('rendering a loading shell still fails; navigation completion is not content success', async () => {
  await assert.rejects(crawler.extractWebsitePage(shell, url, 0, { availability: available, render: async () => ({ html: shell, url: url.href, links: [] }) }, context()), { code: 'BROWSER_CONTENT_INSUFFICIENT' });
});
test('rendered URL cannot change to an unauthorized hostname or path', async () => {
  await assert.rejects(crawler.extractWebsitePage(shell, url, 0, { availability: available, render: async () => ({ html, url: 'https://other.business.com/', links: [] }) }, context()), { code: 'BROWSER_DESTINATION_BLOCKED' });
});
test('destination policy rejects private/metadata/file/socket/third-party hosts and out-of-scope paths', () => {
  for (const raw of ['http://127.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'file:///etc/passwd', 'ws://business.com/', 'https://cdn.business.com/app.js', 'https://business.com:8443/', 'https://user:pass@business.com/']) {
    assert.throws(() => rendering.assertRenderDestination(raw, context()), { code: 'BROWSER_DESTINATION_BLOCKED' });
  }
  assert.throws(() => rendering.assertRenderDestination('https://business.com/private', context({ pathAllowed: () => false })), { code: 'BROWSER_DESTINATION_BLOCKED' });
});
test('renderer is disabled by default and native Windows requires a Linux isolation worker', () => {
  assert.equal(rendering.rendererAvailability({}, 'linux').configured, false);
  assert.equal(rendering.rendererAvailability({ KNOWLEDGE_BROWSER_RENDERING_ENABLED: 'true' }, 'win32').code, 'BROWSER_ISOLATION_REQUIRED');
  assert.equal(rendering.rendererAvailability({ KNOWLEDGE_BROWSER_RENDERING_ENABLED: 'true', KNOWLEDGE_RENDERER_IMAGE: 'latest' }, 'linux').configured, false);
});
test('runtime preflight rejects a renamed runc or gVisor host networking', () => {
  for (const entry of [{ path: 'runc', runtimeArgs: ['--network=none'] }, { path: '/usr/bin/runsc', runtimeArgs: ['--network=host'] }]) {
    assert.throws(() => rendering.assertRendererRuntime({ 'carteio-renderer': entry }), { code: 'BROWSER_ISOLATION_REQUIRED' });
  }
  rendering.assertRendererRuntime({ 'carteio-renderer': { path: '/usr/bin/runsc', runtimeArgs: ['--network=none'] } });
});
test('container inspection enforces network/CPU/memory/user/capabilities and rejects host mounts', () => {
  const safe = { HostConfig: { NetworkMode: 'none', Runtime: 'carteio-renderer', Privileged: false, ReadonlyRootfs: true, IpcMode: 'private',
    CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges=true'], Memory: 536870912, MemorySwap: 536870912, NanoCpus: 1000000000, PidsLimit: 256, PortBindings: {} }, Config: { User: 'pwuser', Entrypoint: ['node'], Cmd: ['/app/worker.mjs'] }, Mounts: [] };
  rendering.assertContainerIsolation([safe]);
  for (const override of [{ NetworkMode: 'host' }, { Runtime: 'runc' }, { Privileged: true }, { ReadonlyRootfs: false }, { Memory: 0 }, { CapDrop: [] }, { PidsLimit: 0 }]) {
    assert.throws(() => rendering.assertContainerIsolation([{ ...safe, HostConfig: { ...safe.HostConfig, ...override } }]), { code: 'BROWSER_ISOLATION_REQUIRED' });
  }
  assert.throws(() => rendering.assertContainerIsolation([{ ...safe, Mounts: [{ Type: 'bind', Destination: '/app' }] }]), { code: 'BROWSER_ISOLATION_REQUIRED' });
});
test('deadline and cancellation fail before any Docker command or browser start', async () => {
  const renderer = new rendering.IsolatedContainerRenderer('sha256:' + 'a'.repeat(64), { KNOWLEDGE_BROWSER_RENDERING_ENABLED: 'true' });
  await assert.rejects(renderer.render({ ...context({ deadline: Date.now() - 1 }), url }), { code: 'BROWSER_RENDER_TIMEOUT' });
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(crawler.extractWebsitePage(shell, url, 0, renderer, context({ signal: controller.signal })), /cancelled/);
});

function transport(status = 200, headers = { 'content-type': 'text/html' }, body = html, inspect = () => {}) {
  return (_url, options, callback) => {
    inspect(options);
    const req = new EventEmitter(); req.destroy = (error) => { if (error) req.emit('error', error); return req; };
    req.end = () => { const response = new PassThrough(); response.statusCode = status; response.headers = headers;
      queueMicrotask(() => { callback(response); response.end(body); }); };
    return req;
  };
}
const coordinator = { $queryRaw: async () => [{ reservedAt: new Date(Date.now() - 1000) }] };
test('browser broker uses actual pinned fetch path; TLS stays enabled and DNS cannot re-resolve', async () => {
  let options;
  const response = await crawler.fetchPinned(url, 10000, Date.now() + 4000, 'business.com', 300, () => true, coordinator,
    { resolve: async () => [{ address: '8.8.8.8', family: 4 }], httpsRequest: transport(200, { 'content-type': 'text/html' }, html, (value) => { options = value; }) });
  options.lookup('business.com', { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]); });
  assert.equal(options.rejectUnauthorized, true); assert.equal(options.servername, 'business.com'); assert.equal(response.body.toString(), html);
});
test('private DNS answers for the same authorized hostname are blocked before request creation', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1']) {
    await assert.rejects(crawler.fetchPinned(url, 10000, Date.now() + 4000, 'business.com', 300, () => true, coordinator,
      { resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }], httpsRequest: () => assert.fail('unsafe request') }), /CRAWL_DESTINATION_BLOCKED/);
  }
});
test('redirects to metadata/private targets are blocked before browser fulfillment', async () => {
  await assert.rejects(crawler.fetchPinned(url, 10000, Date.now() + 4000, 'business.com', 300, () => true, coordinator,
    { resolve: async () => [{ address: '8.8.8.8', family: 4 }], httpsRequest: transport(302, { location: 'http://169.254.169.254/' }, '') }, undefined, false), /CRAWL_URL_BLOCKED/);
});
test('response size limit is enforced on the pinned broker path', async () => {
  await assert.rejects(crawler.fetchPinned(url, 20, Date.now() + 4000, 'business.com', 300, () => true, coordinator,
    { resolve: async () => [{ address: '8.8.8.8', family: 4 }], httpsRequest: transport() }), /CRAWL_PAGE_SIZE_LIMIT/);
});
test('retained rendered pages keep extraction method through sync and a changed method triggers replacement', () => {
  const page = { url: url.href, title: 'Company', content: 'original', contentHash: 'hash', depth: 0, extractionMethod: 'BROWSER_RENDERED' };
  assert.equal(sync.prepareWebsiteSyncPages([], [page], []).pages[0].extractionMethod, 'BROWSER_RENDERED');
  assert.equal(sync.prepareWebsiteSyncPages([{ ...page, extractionMethod: 'HTML' }], [page], []).changedPages, 1);
});

test('actual stdio broker refuses cross-origin resource requests and accepts only scoped public GET', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
  let loads = 0;
  const hook = mock.method(childProcess, 'spawn', () => child);
  child.stdin.on('data', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'render') queueMicrotask(() => child.stdout.write(JSON.stringify({ type: 'request', id: 1, method: 'GET', url: 'https://thirdparty.com/script.js' }) + '\n'));
    else { assert.equal(message.blocked, true); child.stdout.write(JSON.stringify({ type: 'result', html, url: url.href, links: [] }) + '\n'); }
  });
  try {
    const renderer = new rendering.IsolatedContainerRenderer('', {});
    const result = await renderer.exchange('fixture', { ...context({ load: async () => { loads++; } }), url }, new AbortController().signal, 3000);
    assert.equal(loads, 0); assert.equal(result.html, html);
  } finally { hook.mock.restore(); }
});
test('renderer worker blocks WebSockets/downloads, uses fresh contexts and requires Chromium sandbox', async () => {
  const { renderPage, permittedResource } = await import(path.resolve(__dirname, '../../infrastructure/renderer/render-page.mjs'));
  for (const raw of ['file:///etc/passwd', 'ws://business.com/', 'http://169.254.169.254/', 'https://cdn.business.com/app.js']) assert.equal(permittedResource(raw, 'business.com', 'GET'), false);
  assert.equal(permittedResource(url.href, 'business.com', 'POST'), false);
  const handlers = {}; let websocket; let options; let closed = false;
  const page = { on: (event, callback) => { handlers[event] = callback; }, setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {},
    goto: async () => ({ status: () => 200 }), waitForFunction: async () => {}, url: () => url.href, evaluate: async () => ({ html, links: ['https://business.com/faq'] }) };
  const ctx = { routeWebSocket: async (_pattern, callback) => { websocket = callback; }, route: async () => {}, newPage: async () => page, on: () => {}, close: async () => {} };
  const chromium = { launch: async (launch) => { assert.equal(launch.chromiumSandbox, true); assert.equal(launch.env.DATABASE_URL, undefined);
    return { newContext: async (value) => { options = value; return ctx; }, close: async () => { closed = true; } }; } };
  const result = await renderPage(chromium, { url: url.href, hostname: 'business.com', maxRequests: 60, timeoutMs: 3000 }, () => assert.fail('unexpected broker'), new AbortController().signal);
  assert.equal(options.acceptDownloads, false); assert.equal(options.serviceWorkers, 'block'); assert.equal(options.ignoreHTTPSErrors, false);
  assert.deepEqual(options.permissions, []); assert.equal(options.storageState, undefined);
  let blockedSocket = false; websocket({ close: () => { blockedSocket = true; } }); assert.equal(blockedSocket, true);
  let cancelledDownload = false; handlers.download({ cancel: async () => { cancelledDownload = true; } }); assert.equal(cancelledDownload, true);
  assert.equal(closed, true); assert.equal(result.links[0], 'https://business.com/faq');
});

test('new migration is additive and keeps previous IDs/provenance intact', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20261011170000_phase_08e_browser_extraction/migration.sql'), 'utf8');
  assert(sql.includes("DEFAULT 'HTML'")); assert(sql.includes('BROWSER_RENDERED')); assert(sql.includes('CHECK'));
  assert(!/DROP\s|DELETE\s|TRUNCATE\s/i.test(sql));
});

test('real crawler discovers rendered FAQ/privacy links while enforcing robots, host and private-path scope', async () => {
  const requests = []; const stages = [];
  const request = (target, options, callback) => {
    requests.push(target.pathname);
    const body = target.pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /blocked\n' : target.pathname === '/' ? shell : html.replace('href="/policies"', `href="${target.pathname}"`);
    return transport(target.pathname === '/sitemap.xml' ? 404 : 200, { 'content-type': target.pathname === '/robots.txt' ? 'text/plain' : 'text/html' }, body)(target, options, callback);
  };
  const coordinator = { $queryRaw: async () => [{ reservedAt: new Date() }], $executeRaw: async () => 0 };
  const renderer = { availability: available, render: async () => ({ html: html.replace('href="/policies"', 'href="/"'), url: url.href,
    links: ['/faq', '/privacy', '/blocked', '/login', 'https://other.business.com/secret'] }) };
  const engine = new crawler.WebsiteCrawler(coordinator, renderer, { resolve: async () => [{ address: '8.8.8.8', family: 4 }], httpsRequest: request });
  const result = await engine.crawl({ startUrl: url.href, sourceAuthorized: true, maxPages: 3, maxDepth: 1, onStage: async (stage) => stages.push(stage) });
  assert.equal(result.failed, 0); assert(stages.includes('BROWSER_RENDERING'));
  assert(requests.includes('/faq')); assert(requests.includes('/privacy'));
  assert(!requests.includes('/blocked')); assert(!requests.includes('/login'));
  assert.equal(result.pages[0].extractionMethod, 'BROWSER_RENDERED');
  assert.deepEqual(result.pages.map((page) => page.url), [url.href, 'https://business.com/faq', 'https://business.com/privacy']);
});
test('ordinary HTML crawling never invokes a browser and keeps HTML provenance', async () => {
  const engine = new crawler.WebsiteCrawler({ ...coordinator, $executeRaw: async () => 0 }, { availability: available, render: () => assert.fail('unnecessary renderer') },
    { resolve: async () => [{ address: '8.8.8.8', family: 4 }], httpsRequest: (target, options, callback) => transport(target.pathname.endsWith('.txt') || target.pathname.endsWith('.xml') ? 404 : 200, { 'content-type': 'text/html' }, html)(target, options, callback) });
  const result = await engine.crawl({ startUrl: url.href, sourceAuthorized: true, maxPages: 1 });
  assert.equal(result.pages.length, 1); assert.equal(result.pages[0].extractionMethod, 'HTML');
});
test('mixed DNS answers cannot bypass browser broker pinning', async () => {
  await assert.rejects(crawler.fetchPinned(url, 10000, Date.now() + 4000, 'business.com', 300, () => true, coordinator,
    { resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], httpsRequest: () => assert.fail('mixed DNS request') }), /CRAWL_DESTINATION_BLOCKED/);
});
test('broker rejects non-GET requests before calling any network loader', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
  const hook = mock.method(childProcess, 'spawn', () => child);
  child.stdin.once('data', () => queueMicrotask(() => child.stdout.write(JSON.stringify({ type: 'request', id: 1, method: 'POST', url: url.href }) + '\n')));
  try { await assert.rejects(new rendering.IsolatedContainerRenderer('', {}).exchange('fixture', { ...context({ load: () => assert.fail('POST load') }), url }, new AbortController().signal, 3000), { code: 'BROWSER_RESOURCE_LIMIT' }); }
  finally { hook.mock.restore(); }
});
test('actual browser route denies subdomains, file protocols and redirects, and fails on request budget', async () => {
  const { renderPage } = await import(path.resolve(__dirname, '../../infrastructure/renderer/render-page.mjs'));
  let routing; let brokerCalls = 0; let aborted = 0;
  const route = (raw, redirects = null) => ({ request: () => ({ url: () => raw, method: () => 'GET', redirectedFrom: () => redirects }), abort: async () => { aborted++; }, fulfill: () => assert.fail('unauthorized fulfillment') });
  const page = { on: () => {}, setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {},
    goto: async () => {
      await routing(route('https://cdn.business.com/app.js')); await routing(route('file:///etc/passwd'));
      await routing(route(url.href)); return { status: () => 200 };
    }, waitForFunction: async () => {}, url: () => url.href, evaluate: () => assert.fail('over-budget extraction') };
  const ctx = { routeWebSocket: async () => {}, route: async (_pattern, callback) => { routing = callback; }, newPage: async () => page, on: () => {}, close: async () => {} };
  const chromium = { launch: async () => ({ newContext: async () => ctx, close: async () => {} }) };
  await assert.rejects(renderPage(chromium, { url: url.href, hostname: 'business.com', maxRequests: 2, timeoutMs: 3000 }, async () => { brokerCalls++; }, new AbortController().signal), /BROWSER_RESOURCE_LIMIT/);
  assert.equal(aborted, 3); assert.equal(brokerCalls, 0);
});
test('rendered text uses unchanged Unicode paragraph chunking and public visibility policy', () => {
  const indexing = require('../src/modules/workspaces/knowledge-indexing.ts');
  const policy = require('../src/modules/workspaces/knowledge-retrieval-policy.ts');
  const page = crawler.extractHtmlPage(html, url, 0);
  const chunks = indexing.chunkKnowledgeText(page.content);
  assert.equal(chunks.length, 1); assert(chunks[0].includes('7 days')); assert(chunks[0].includes('सात दिन'));
  assert.deepEqual(policy.sourcesForAudience([{ id: 'a', visibility: 'INTERNAL_RESTRICTED' }, { id: 'b', visibility: 'PUBLIC_REFERENCE' }], 'PUBLIC_VISITOR').map((source) => source.id), ['b']);
});
test('real website processing writes rendered page-backed lexical chunks before generation publication', async () => {
  const { KnowledgeProcessingService } = require('../src/modules/workspaces/knowledge-processing.service.ts');
  const events = [];
  const source = { id: 'source-a', organizationId: 'org-a', sourceVersion: 1, activeIndexGeneration: null, type: 'WEBSITE', status: 'REGISTERED', sourceAuthorized: true, sourceUrl: url.href, crawlMaxPages: 3, syncPolicy: 'MANUAL' };
  const job = { id: 'job-a', sourceVersion: 1 };
  const db = {
    knowledgeSyncRun: { create: async () => ({ id: 'sync-a' }), update: async () => {} },
    knowledgeSource: { findFirst: async ({ where }) => { assert.equal(where.organizationId, 'org-a'); return source; }, update: async ({ data }) => { events.push(['publish', data]); } },
    knowledgeProcessingJob: { findFirst: async () => ({ id: job.id }), updateMany: async () => ({ count: 1 }) },
    knowledgePage: { findMany: async () => [], create: async ({ data }) => { events.push(['page', data]); return { id: 'page-a' }; }, deleteMany: async () => {} },
    knowledgeChunk: { deleteMany: async () => {} }, auditEvent: { create: async () => {} },
    $executeRaw: async (sql, ...parameters) => { events.push(['chunk', parameters]); },
    $transaction: async (callback) => callback(db),
  };
  const service = new KnowledgeProcessingService(db, {}, {});
  service.embeddings = null;
  const page = { ...crawler.extractHtmlPage(html, url, 0), extractionMethod: 'BROWSER_RENDERED' };
  service.crawler = { crawl: async (input) => { await input.assertAuthorized(); await input.onStage('BROWSER_RENDERING'); return { pages: [page], removedUrls: [], failed: 0, discovered: 1, unsupportedPages: 0 }; } };
  await service.processWebsite(job, source);
  assert.equal(events[0][0], 'page'); assert.equal(events[0][1].extractionMethod, 'BROWSER_RENDERED');
  assert.equal(events[0][1].organizationId, 'org-a'); assert.equal(events[1][0], 'chunk');
  assert(events[1][1].includes('https://business.com/policies')); assert(events[1][1].includes('postgres')); assert(events[1][1].includes(null));
  assert.equal(events[2][0], 'publish'); assert.equal(events[2][1].activeIndexGeneration, 1); assert.equal(events[2][1].semanticIndexStatus, 'NOT_CONFIGURED');
});
test('archiving/deleting a source during rendering revokes authority before publication', async () => {
  const { KnowledgeProcessingService } = require('../src/modules/workspaces/knowledge-processing.service.ts');
  const db = { knowledgeSyncRun: { create: async () => ({ id: 'sync' }) }, knowledgeSource: { findFirst: async () => null }, knowledgeProcessingJob: { findFirst: async () => ({ id: 'job' }) }, $transaction: () => assert.fail('revoked publication') };
  const service = new KnowledgeProcessingService(db, {}, {});
  service.crawler = { crawl: async (input) => { await input.assertAuthorized(); assert.fail('revoked crawl'); } };
  await assert.rejects(service.processWebsite({ id: 'job', sourceVersion: 1 }, { id: 'a', organizationId: 'org-a', sourceVersion: 1, sourceAuthorized: true, sourceUrl: url.href }), { code: 'CRAWL_CANCELLED' });
});

test('hydration wait excludes navigation and placeholders before accepting public text', async () => {
  const { renderPage } = await import(path.resolve(__dirname, '../../infrastructure/renderer/render-page.mjs'));
  const parent = { closest: () => true, getClientRects: () => [1], className: '', id: '' };
  const node = { parentElement: parent, textContent: 'Home FAQ Navigation '.repeat(5) };
  const root = {};
  const globals = ['document', 'NodeFilter', 'getComputedStyle'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  globalThis.document = { querySelector: () => root, createTreeWalker: () => { let used = false; return { nextNode: () => used ? null : (used = true, node) }; } };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  const page = { on: () => {}, setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {}, goto: async () => ({ status: () => 200 }), url: () => url.href,
    waitForFunction: async (predicate) => {
      assert.equal(predicate(), false); parent.closest = () => false;
      node.textContent = 'Loading your expense dashboard. Please wait while it loads...'; assert.equal(predicate(), false);
      node.textContent = 'Eligible requests may be submitted within 7 days. हमारी नीति सात दिन की है।'; assert.equal(predicate(), true);
    }, evaluate: async () => ({ html, links: [] }) };
  const ctx = { routeWebSocket: async () => {}, route: async () => {}, newPage: async () => page, on: () => {}, close: async () => {} };
  try { await renderPage({ launch: async () => ({ newContext: async () => ctx, close: async () => {} }) }, { url: url.href, hostname: 'business.com', maxRequests: 60, timeoutMs: 3000 }, () => assert.fail('unexpected network'), new AbortController().signal); }
  finally { for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});
test('public UI rendering failures are actionable without leaking privileged sandbox details', () => {
  const { websiteExtractionError } = require('../../frontend/src/pages/knowledge/website-extraction-status.ts');
  assert(websiteExtractionError('BROWSER_ISOLATION_REQUIRED').includes('deployment administrator'));
  assert(!websiteExtractionError('BROWSER_ISOLATION_REQUIRED').includes('/var/run'));
  assert(websiteExtractionError('BROWSER_CONTENT_INSUFFICIENT').includes('No meaningful public content'));
});
