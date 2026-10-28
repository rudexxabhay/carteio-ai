import { lookup } from 'node:dns/promises';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { contentHash } from './knowledge-indexing';
import { createWebsiteRenderer, rendererError, type RenderRequest, type WebsiteRenderer } from './website-renderer';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 15_000_000;
const JOB_BUDGET_MS = 120_000;
const REQUEST_TIMEOUT_MS = 12_000;
const hostQueues = new Map<string, Promise<void>>();

export type WebsitePageCategory = 'ABOUT' | 'FAQ' | 'CONTACT' | 'SHIPPING_POLICY' | 'RETURNS_POLICY' | 'CANCELLATION_POLICY' | 'PRIVACY_POLICY' | 'TERMS' | 'PAYMENTS' | 'SUPPORT' | 'GENERAL';
export type CrawlPage = { url: string; title: string; content: string; contentHash: string; depth: number; pageCategory?: WebsitePageCategory; language?: string | null; fetchedAt?: Date; extractionMethod?: 'HTML' | 'BROWSER_RENDERED'; etag?: string | null; lastModified?: string | null };
export type CrawlResult = { pages: CrawlPage[]; removedUrls: string[]; notModifiedUrls: string[]; discovered: number; complete: boolean; skippedRobots: number; failed: number; retryableFailures: number; unsupportedPages: number; totalBytes: number; errorCode?: string };
export type CrawlOperation = 'crawl.static_fetch' | 'crawl.page_extraction' | 'crawl.browser_renderer'
  | 'crawl.browser_resource_fetch' | 'crawl.host_rate_limit_reservation' | 'crawl.host_rate_limit_cleanup';
type FetchResult = { status: number; headers: IncomingHttpHeaders; body: Buffer; url: URL };
type RequestTransport = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
type CrawlNetwork = {
  resolve?: (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>;
  httpRequest?: RequestTransport;
  httpsRequest?: RequestTransport;
};
type HtmlNode = DefaultTreeAdapterMap['node'];

function ipv4Public(ip: string): boolean {
  const n = ip.split('.').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b, c] = n as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

/** Fail closed for any destination outside globally routed unicast ranges. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4Public(address);
  if (version !== 6 || address.includes('%')) return false;
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) {
    const tail = value.slice(7);
    if (isIP(tail) === 4) return ipv4Public(tail);
    const groups = tail.split(':').map((x) => Number.parseInt(x, 16));
    if (groups.length !== 2 || groups.some((x) => !Number.isFinite(x))) return false;
    return ipv4Public(`${groups[0]! >> 8}.${groups[0]! & 255}.${groups[1]! >> 8}.${groups[1]! & 255}`);
  }
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return false;
  const first = Number.parseInt(value.split(':')[0] || '0', 16);
  if (first < 0x2000 || first > 0x3fff) return false; // Global unicast 2000::/3 only.
  const groups = value.split(':');
  const second = Number.parseInt(groups[1] || '0', 16);
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002 || first === 0x3fff || value.startsWith('64:ff9b:')) return false;
  return true;
}

export function assertPublicDnsAnswers(addresses: Array<{ address: string; family: number }>): void {
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('CRAWL_DESTINATION_BLOCKED');
}

export function normalizeCrawlUrl(input: string): URL {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  const internalSuffix = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.home', '.corp', '.intranet', '.private', '.test', '.invalid', '.example'];
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname.includes('%')
    || (url.protocol === 'https:' ? port !== 443 : port !== 80) || !hostname
    || hostname === 'localhost' || internalSuffix.some((suffix) => hostname.endsWith(suffix))
    || (isIP(hostname) === 0 && !hostname.includes('.'))
    || (isIP(hostname) !== 0 && !isPublicAddress(hostname))) throw new Error('CRAWL_URL_BLOCKED');
  url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  url.hash = '';
  if ((url.protocol === 'https:' && port === 443) || (url.protocol === 'http:' && port === 80)) url.port = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

async function paceHost(hostname: string, minimumDelayMs: number, budgetEnd: number, coordinator: any, onOperation?: (operation: CrawlOperation) => void): Promise<void> {
  if (!coordinator?.$queryRaw) throw Object.assign(new Error('Shared crawler rate coordination is unavailable.'), { code: 'CRAWL_COORDINATION_UNAVAILABLE', retryable: true });
  const previous = hostQueues.get(hostname) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const delay = Math.max(300, Math.min(30_000, minimumDelayMs));
    onOperation?.('crawl.host_rate_limit_reservation');
    const reservations = await coordinator.$queryRaw`
      INSERT INTO "KnowledgeHostRateLimit" ("hostname", "nextAllowedAt", "updatedAt")
      VALUES (${hostname}, now() + (${delay} * interval '1 millisecond'), now())
      ON CONFLICT ("hostname") DO UPDATE
        SET "nextAllowedAt" = GREATEST("KnowledgeHostRateLimit"."nextAllowedAt", now()) + (${delay} * interval '1 millisecond'),
            "updatedAt" = now()
      RETURNING "nextAllowedAt" - (${delay} * interval '1 millisecond') AS "reservedAt"`;
    if (!reservations[0]?.reservedAt) throw Object.assign(new Error('Shared crawler rate reservation failed.'), { code: 'CRAWL_COORDINATION_UNAVAILABLE', retryable: true });
    const waitMs = Math.max(0, new Date(reservations[0].reservedAt).getTime() - Date.now());
    if (Date.now() + waitMs >= budgetEnd) throw Object.assign(new Error('CRAWL_TIME_BUDGET'), { code: 'CRAWL_TIME_BUDGET' });
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  });
  hostQueues.set(hostname, run);
  try { await run; }
  finally { if (hostQueues.get(hostname) === run) hostQueues.delete(hostname); }
}

export async function fetchPinned(initial: URL, maxBytes: number, budgetEnd: number, authorizedHostname: string, minimumDelayMs: number, pathAllowed: (url: URL) => boolean, coordinator: any, network: CrawlNetwork = {}, signal?: AbortSignal, followRedirects = true, conditionalHeaders: Record<string, string> = {}, onOperation?: (operation: CrawlOperation) => void, fetchOperation: CrawlOperation = 'crawl.static_fetch'): Promise<FetchResult> {
  let current = normalizeCrawlUrl(initial.href);
  let requestConditionalHeaders = conditionalHeaders;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    signal?.throwIfAborted();
    if (Date.now() >= budgetEnd) throw new Error('CRAWL_TIME_BUDGET');
    const hostname = current.hostname.replace(/^\[|\]$/g, '');
    if (hostname !== authorizedHostname || !pathAllowed(current)) throw new Error('CRAWL_REDIRECT_OUT_OF_SCOPE');
    await paceHost(hostname, minimumDelayMs, budgetEnd, coordinator, onOperation);
    onOperation?.(fetchOperation);
    signal?.throwIfAborted();
    let addresses: LookupAddress[];
    try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await (network.resolve ?? lookup)(hostname, { all: true, verbatim: true }); }
    catch { throw new Error('DNS_RESOLUTION_FAILED'); }
    assertPublicDnsAnswers(addresses);
    const pinned = addresses[0]!;
    const transport: RequestTransport = current.protocol === 'https:' ? (network.httpsRequest ?? httpsRequest) : (network.httpRequest ?? httpRequest);
    const result = await new Promise<FetchResult>((resolve, reject) => {
      let absoluteTimer: NodeJS.Timeout | undefined;
      const req = transport(current, {
        method: 'GET', agent: false, setHost: true,
        signal,
        headers: { 'user-agent': 'CarteioKnowledgeBot/1.0 (+website-owner-authorized crawl)', accept: followRedirects ? 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.8' : '*/*', 'accept-encoding': 'identity', ...requestConditionalHeaders },
        lookup: (_host, options, callback) => {
          if (options?.all) callback(null, [pinned]); else callback(null, pinned.address, pinned.family);
        },
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
        timeout: Math.max(1, Math.min(REQUEST_TIMEOUT_MS, budgetEnd - Date.now())),
      }, (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) { if (absoluteTimer) clearTimeout(absoluteTimer); resolve({ status, headers: response.headers, body: Buffer.from(String(location)), url: current }); response.destroy(); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) { req.destroy(new Error('CRAWL_PAGE_SIZE_LIMIT')); return; } chunks.push(Buffer.from(chunk)); });
        response.on('end', () => { if (absoluteTimer) clearTimeout(absoluteTimer); resolve({ status, headers: response.headers, body: Buffer.concat(chunks), url: current }); });
        response.on('error', (error: Error) => { if (absoluteTimer) clearTimeout(absoluteTimer); reject(error); });
      });
      absoluteTimer = setTimeout(() => req.destroy(Object.assign(new Error('CRAWL_TIME_BUDGET'), { code: 'CRAWL_TIME_BUDGET' })), Math.max(1, budgetEnd - Date.now()));
      req.on('timeout', () => req.destroy(new Error('CRAWL_REQUEST_TIMEOUT')));
      req.on('error', (error: Error) => { if (absoluteTimer) clearTimeout(absoluteTimer); reject(error); });
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (redirect === MAX_REDIRECTS) throw new Error('CRAWL_REDIRECT_LIMIT');
      const target = normalizeCrawlUrl(new URL(result.body.toString('utf8'), current).href);
      if (target.hostname !== authorizedHostname || !pathAllowed(target)) throw new Error('CRAWL_REDIRECT_OUT_OF_SCOPE');
      if (!followRedirects) return { ...result, headers: { ...result.headers, location: target.href } };
      current = target;
      requestConditionalHeaders = {};
      continue;
    }
    return result;
  }
  throw new Error('CRAWL_REDIRECT_LIMIT');
}

const ignoredTags = new Set(['head', 'script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'aside', 'form', 'button', 'template', 'iframe', 'canvas']);
const blockTags = new Set(['article', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'main', 'ol', 'p', 'section', 'table', 'td', 'th', 'tr', 'ul']);
const noisePattern = /cookie|consent|tracking|breadcrumb|site-nav|advertisement|(^|[-_ ])ads?($|[-_ ])/i;
function attr(node: HtmlNode, name: string): string | undefined { return 'attrs' in node ? node.attrs.find((item) => item.name === name)?.value : undefined; }
function isHiddenOrNoise(node: HtmlNode): boolean {
  if (!('tagName' in node)) return false;
  const style = attr(node, 'style') ?? '';
  const role = attr(node, 'role') ?? '';
  return ignoredTags.has(node.tagName)
    || node.attrs.some((item) => item.name === 'hidden' || (item.name === 'aria-hidden' && item.value.toLowerCase() === 'true'))
    || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)
    || ['navigation', 'banner', 'contentinfo', 'complementary'].includes(role.toLowerCase())
    || noisePattern.test(`${attr(node, 'id') ?? ''} ${attr(node, 'class') ?? ''}`);
}
function walk(node: HtmlNode, visit: (node: HtmlNode) => void) {
  const stack: HtmlNode[] = [node];
  let count = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++count > 50_000) throw new Error('HTML_NODE_LIMIT');
    visit(current);
    if ('childNodes' in current) {
      for (let index = current.childNodes.length - 1; index >= 0; index--) stack.push(current.childNodes[index]!);
    }
  }
}
function normalizedText(root: HtmlNode, preferMain: boolean, excludeLinks = false): string {
  let hasMain = false;
  walk(root, (node) => { if (('tagName' in node && (node.tagName === 'main' || node.tagName === 'article')) || attr(node, 'role') === 'main') hasMain = true; });
  const output: string[] = [];
  const stack: Array<{ node: HtmlNode; skipped: boolean; inMain: boolean }> = [{ node: root, skipped: false, inMain: false }];
  let count = 0;
  while (stack.length) {
    const { node, skipped, inMain } = stack.pop()!;
    if (++count > 50_000) throw new Error('HTML_NODE_LIMIT');
    if ('value' in node) {
      if (!skipped && (!preferMain || !hasMain || inMain)) output.push(node.value);
      continue;
    }
    const tag = 'tagName' in node ? node.tagName : undefined;
    const omit = skipped || Boolean(tag && (isHiddenOrNoise(node) || (excludeLinks && tag === 'a')));
    const main = inMain || tag === 'main' || tag === 'article' || attr(node, 'role') === 'main';
    if (tag && blockTags.has(tag)) output.push('\n');
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index]!, skipped: omit, inMain: main });
    }
  }
  return output.join('').replace(/[\t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
}

export function extractHtmlPage(html: string, url: URL, depth: number): CrawlPage | null {
  if (Buffer.byteLength(html, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('CRAWL_PAGE_SIZE_LIMIT');
  const document = parse(html, { sourceCodeLocationInfo: false });
  let title = '';
  let heading = '';
  let language: string | null = null;
  let canonicalHref: string | undefined;
  walk(document, (node) => {
    if (!('tagName' in node)) return;
    if (node.tagName === 'html' && !language) {
      const candidate = attr(node, 'lang')?.trim();
      if (candidate && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(candidate)) language = candidate.slice(0, 35);
    }
    if (node.tagName === 'title' && !title) title = normalizedText(node, false);
    if (node.tagName === 'h1' && !heading) heading = normalizedText(node, false);
    if (node.tagName === 'link' && (attr(node, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical')) canonicalHref = attr(node, 'href');
  });
  title = (title || heading || url.hostname).replace(/\s+/g, ' ').trim().slice(0, 500);
  let canonical = url;
  if (canonicalHref) {
    try { const candidate = normalizeCrawlUrl(new URL(canonicalHref, url).href); if (candidate.hostname === url.hostname) canonical = candidate; } catch { /* Ignore malformed/out-of-scope canonical metadata. */ }
  }
  const body = normalizedText(document, true);
  const meaningful = normalizedText(document, true, true);
  if (meaningful.length < 40 || (meaningful.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 25
    || (meaningful.length < 160 && /^(loading\b|please wait\b|enable javascript\b|you need to enable javascript\b)/i.test(meaningful))) return null;
  const faqPairs = extractStructuredFaqs(html);
  const faqText = faqPairs.length ? `\n\nFrequently asked questions\n${faqPairs.map(({ question, answer }) => `Q: ${question}\nA: ${answer}`).join('\n\n')}` : '';
  const content = `${title}\n\n${body}${faqText}`.slice(0, 200_000);
  return { url: canonical.href, title, content, contentHash: contentHash(content), depth, pageCategory: classifyWebsitePage(canonical, title), language, extractionMethod: 'HTML' };
}

const categoryRules: Array<[WebsitePageCategory, RegExp]> = [
  ['RETURNS_POLICY', /return|refund|exchange|restock/i], ['CANCELLATION_POLICY', /cancel/i], ['SHIPPING_POLICY', /shipping|delivery|dispatch|tracking/i],
  ['PRIVACY_POLICY', /privacy|data-protection|cookies/i], ['TERMS', /terms|conditions|legal/i], ['PAYMENTS', /payment|pay-options|billing/i],
  ['FAQ', /faq|frequently-asked|questions/i], ['CONTACT', /contact|reach-us/i], ['ABOUT', /about|our-story|company/i], ['SUPPORT', /support|help|customer-service/i],
];
export function classifyWebsitePage(url: URL, title: string): WebsitePageCategory {
  const candidate = `${url.pathname} ${title}`;
  return categoryRules.find(([, pattern]) => pattern.test(candidate))?.[0] ?? 'GENERAL';
}

function extractStructuredFaqs(html: string): Array<{ question: string; answer: string }> {
  const output: Array<{ question: string; answer: string }> = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (output.length >= 50 || match[1]!.length > 256_000) break;
    let root: unknown;
    try { root = JSON.parse(match[1]!.replace(/<!--[\s\S]*?-->/g, '').trim()); } catch { continue; }
    const stack: unknown[] = [root]; let visited = 0;
    while (stack.length && output.length < 50 && visited++ < 2_000) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) { stack.push(...value.slice(0, 100)); continue; }
      const record = value as Record<string, unknown>;
      const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
      if (types.includes('Question')) {
        const accepted = record.acceptedAnswer;
        const answerValue = Array.isArray(accepted) ? accepted[0] : accepted;
        const rawQuestion = typeof record.name === 'string' ? record.name : '';
        const rawAnswer = answerValue && typeof answerValue === 'object' && 'text' in answerValue ? (answerValue as { text?: unknown }).text : null;
        const question = typeof rawQuestion === 'string' ? rawQuestion.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
        const answer = typeof rawAnswer === 'string' ? rawAnswer.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000) : '';
        if (question && answer) output.push({ question, answer });
      }
      for (const child of Object.values(record)) if (child && typeof child === 'object') stack.push(child);
    }
  }
  return output;
}

/** Shared decision path: static content first, actual rendering only when it has no useful text. */
export async function extractWebsitePage(html: string, url: URL, depth: number, renderer: WebsiteRenderer, request: Omit<RenderRequest, 'url'>, onFallback?: () => Promise<void>): Promise<{ page: CrawlPage; links: string[] }> {
  request.signal.throwIfAborted();
  const staticPage = extractHtmlPage(html, url, depth);
  if (staticPage) return { page: staticPage, links: htmlAnchors(html) };
  if (!request.authorized) throw rendererError('WEBSITE_CRAWL_NOT_AUTHORIZED');
  await onFallback?.();
  const rendered = await renderer.render({ ...request, url });
  request.signal.throwIfAborted();
  const finalUrl = normalizeCrawlUrl(rendered.url);
  if (finalUrl.hostname !== request.hostname || !request.pathAllowed(finalUrl)) throw rendererError('BROWSER_DESTINATION_BLOCKED');
  const page = extractHtmlPage(rendered.html, finalUrl, depth);
  if (!page) throw rendererError('BROWSER_CONTENT_INSUFFICIENT');
  page.extractionMethod = 'BROWSER_RENDERED';
  return { page, links: [...htmlAnchors(html), ...rendered.links].slice(0, 2000) };
}

function htmlAnchors(html: string): string[] {
  const document = parse(html, { sourceCodeLocationInfo: false });
  const links: string[] = [];
  walk(document, (node) => { if ('tagName' in node && node.tagName === 'a') { const href = attr(node, 'href'); if (href && links.length < 20_000) links.push(href); } });
  return links;
}

function parseRobots(text: string): { rules: Array<{ allow: boolean; path: string }>; sitemaps: string[]; delayMs: number } {
  const rules: Array<{ allow: boolean; path: string }> = []; const sitemaps: string[] = []; let agents: string[] = []; let groupHasRules = false; let delayMs = 300;
  for (const line of text.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split(':'); const key = rawKey?.trim().toLowerCase(); const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (groupHasRules) { agents = []; groupHasRules = false; }
      agents.push(value.toLowerCase());
      continue;
    }
    const applies = agents.some((agent) => agent === '*' || agent.includes('carteioknowledgebot'));
    if ((key === 'disallow' || key === 'allow') && value) {
      groupHasRules = true;
      if (applies) {
        if (value.length > 2048 || rules.length >= 999) return { rules: [{ allow: false, path: '/' }], sitemaps, delayMs };
        rules.push({ allow: key === 'allow', path: value });
      }
    }
    if (applies && key === 'crawl-delay') { groupHasRules = true; const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) delayMs = Math.min(5000, Math.max(delayMs, seconds * 1000)); }
    if (key === 'sitemap' && value) sitemaps.push(value);
  }
  return { rules, sitemaps, delayMs };
}

export function robotsRuleMatches(rule: string, pathname: string): boolean {
  const anchored = rule.endsWith('$');
  const parts = (anchored ? rule.slice(0, -1) : rule).split('*');
  if (parts.length === 1) return anchored ? pathname === parts[0] : pathname.startsWith(parts[0]!);
  let cursor = 0;
  if (parts[0]) {
    if (!pathname.startsWith(parts[0])) return false;
    cursor = parts[0].length;
  }
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    if (!part) continue;
    const found = pathname.indexOf(part, cursor);
    if (found < 0) return false;
    cursor = found + part.length;
  }
  const last = parts.at(-1)!;
  return !anchored || !last || cursor === pathname.length;
}

export function robotsAllows(rules: Array<{ allow: boolean; path: string }>, pathname: string): boolean {
  const matches = rules.filter((rule) => robotsRuleMatches(rule.path, pathname)).sort((a, b) => b.path.replace(/[\*$]/g, '').length - a.path.replace(/[\*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return matches.length === 0 || matches[0]!.allow;
}

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body: string) => {
    if (body[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[body.toLowerCase()] ?? entity;
    const code = body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
  });
}

function discoveryPriority(url: URL): number {
  const path = url.pathname;
  if (/about|our-story|company/i.test(path)) return 100;
  if (/faq|frequently-asked|questions|help-center/i.test(path)) return 95;
  if (/shipping|delivery|returns?|refund|cancellations?|privacy|terms|payment|contact|support|help/i.test(path)) return 90;
  if (/^\/pages?\//i.test(path)) return 50;
  return 0;
}
export function isShopifyCatalogUrl(url: URL): boolean { return /^\/(?:products|collections)(?:\/|$)/i.test(url.pathname); }

/** Bounded, same-host crawler. Every request and redirect resolves and pins a validated public address. */
export class WebsiteCrawler {
  constructor(private readonly coordinator: any, private readonly renderer: WebsiteRenderer = createWebsiteRenderer(), private readonly network: CrawlNetwork = {}) {}

  async crawl(input: { startUrl: string; maxPages?: number; maxDepth?: number; pathPrefix?: string | null; seedUrls?: readonly string[]; validators?: Readonly<Record<string, { etag?: string | null; lastModified?: string | null }>>; excludeShopifyCatalog?: boolean; sourceAuthorized?: boolean; signal?: AbortSignal; assertAuthorized?: () => Promise<void>; onStage?: (stage: 'HTML_EXTRACTION' | 'BROWSER_RENDERING') => Promise<void>; onOperation?: (operation: CrawlOperation) => void }): Promise<CrawlResult> {
    if (input.sourceAuthorized !== true) throw Object.assign(new Error('A registered workspace website source is required.'), { code: 'WEBSITE_CRAWL_NOT_AUTHORIZED', terminal: true });
    const start = normalizeCrawlUrl(input.startUrl);
    const maxPages = Math.max(1, Math.min(input.maxPages ?? 50, 200));
    const maxDepth = Math.max(0, Math.min(input.maxDepth ?? 3, 8));
    const pathPrefix = input.pathPrefix || '/';
    const deadline = Date.now() + JOB_BUDGET_MS;
    const visited = new Set<string>(); const pages = new Map<string, CrawlPage>();
    const reportStage = async (stage: 'HTML_EXTRACTION' | 'BROWSER_RENDERING') => {
      try { await input.onStage?.(stage); }
      catch (error: unknown) {
        // Progress persistence failure must not be converted into a page-fetch failure.
        if (typeof error === 'object' && error !== null) Object.defineProperty(error, 'crawlProgressUpdateFailed', { value: true, configurable: true });
        throw error;
      }
    };
    let totalBytes = 0; let skippedRobots = 0; let failed = 0; let retryableFailures = 0; let unsupportedPages = 0; let discoveryTruncated = false; let sitemapObserved = false;
    let errorCode: string | undefined;
    const signal = input.signal ?? new AbortController().signal;
    const removedUrls: string[] = [], notModifiedUrls: string[] = [];
    let fetchedPageCount = 0;
    const normalizedPrefix = pathPrefix === '/' ? '/' : `/${pathPrefix.split('/').filter(Boolean).join('/')}`;
    const inScope = (url: URL) => url.hostname === start.hostname
      && (normalizedPrefix === '/' || url.pathname === normalizedPrefix || url.pathname.startsWith(`${normalizedPrefix}/`))
      && !(input.excludeShopifyCatalog === true && isShopifyCatalogUrl(url))
      && !/\/(?:admin(?:istrator)?|wp-admin|dashboard|account|my-account|profile|login|sign-?in|sign-?up|auth|logout|checkout|cart|basket|orders?|order-tracking|track-order|payments?|billing|invoices?|api|graphql|customers?|users?|members?|portal|password-reset|password-recovery)(?:\/|$)/i.test(url.pathname)
      && !/(?:^|&)(?:access[_-]?token|auth(?:orization)?|code|customer(?:[_-]?id)?|email|key|order(?:[_-]?id)?|password|phone|session(?:[_-]?id)?|signature|token|user(?:[_-]?id)?)(?:=|&|$)/i.test(url.search.slice(1));
    const get = async (url: URL, maxBytes = MAX_RESPONSE_BYTES, pathAllowed = inScope, validators?: { etag?: string | null; lastModified?: string | null }) => {
      signal.throwIfAborted(); await input.assertAuthorized?.();
      const conditionalHeaders: Record<string, string> = {};
      if (validators?.etag && validators.etag.length <= 1024 && !/[\r\n]/.test(validators.etag)) conditionalHeaders['if-none-match'] = validators.etag;
      if (validators?.lastModified && validators.lastModified.length <= 128 && !/[\r\n]/.test(validators.lastModified)) conditionalHeaders['if-modified-since'] = validators.lastModified;
      const response = await fetchPinned(url, Math.min(maxBytes, MAX_TOTAL_BYTES - totalBytes), deadline, start.hostname, delayMs, pathAllowed, this.coordinator, this.network, signal, true, conditionalHeaders, input.onOperation);
      totalBytes += response.body.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('CRAWL_TOTAL_SIZE_LIMIT');
      return response;
    };
    input.onOperation?.('crawl.host_rate_limit_cleanup');
    await this.coordinator.$executeRaw`DELETE FROM "KnowledgeHostRateLimit" WHERE "hostname" IN (SELECT "hostname" FROM "KnowledgeHostRateLimit" WHERE "updatedAt" < now() - interval '30 days' ORDER BY "updatedAt" LIMIT 100)`;
    let rules: Array<{ allow: boolean; path: string }> = []; let sitemapHints: string[] = []; let delayMs = 300;
    try {
      const robotsUrl = new URL('/robots.txt', start);
      const robots = await get(robotsUrl, 256_000, (url) => url.hostname === start.hostname && url.pathname === '/robots.txt');
      if (robots.status >= 200 && robots.status < 300) { const parsed = parseRobots(robots.body.toString('utf8')); rules = parsed.rules; sitemapHints = parsed.sitemaps; delayMs = parsed.delayMs; }
      else if (robots.status === 401 || robots.status === 403) rules = [{ allow: false, path: '/' }];
      else if (robots.status >= 500) throw Object.assign(new Error('Robots policy could not be checked.'), { code: 'ROBOTS_TEMPORARILY_UNAVAILABLE', retryable: true });
    } catch (error: any) { if (error?.retryable || error?.code === 'CRAWL_DESTINATION_BLOCKED') throw error; throw Object.assign(new Error('Robots policy could not be checked safely.'), { code: 'ROBOTS_FETCH_FAILED', retryable: true }); }
    const blocked = (url: URL) => {
      const path = `${url.pathname}${url.search}`;
      return !robotsAllows(rules, path);
    };
    const queue: Array<{ url: URL; depth: number }> = [{ url: start, depth: 0 }];
    if (maxDepth > 0) for (const seed of (input.seedUrls ?? []).slice(0, 200)) {
      try { const target = normalizeCrawlUrl(new URL(seed, start).href); if (inScope(target) && !blocked(target)) queue.push({ url: target, depth: 1 }); }
      catch { /* Provider-synchronized page seeds are hints only; normal URL/domain checks remain mandatory. */ }
    }
    const sitemapUrls: string[] = [];
    if (inScope(start)) {
      const sitemapSeen = new Set<string>();
      const loadSitemap = async (url: URL, depth: number): Promise<void> => {
        if (sitemapSeen.has(url.href)) return;
        if (depth > 2 || sitemapSeen.size >= 10 || sitemapUrls.length >= maxPages || blocked(url)) { discoveryTruncated = true; return; }
        sitemapSeen.add(url.href);
        const sitemap = await get(url, 512_000, inScope);
        if (sitemap.status < 200 || sitemap.status >= 300 || !/xml/i.test(String(sitemap.headers['content-type']))) { discoveryTruncated = true; return; }
        const xml = sitemap.body.toString('utf8');
        const isIndex = /<sitemapindex\b/i.test(xml);
        if (!isIndex && !/<urlset\b/i.test(xml)) { discoveryTruncated = true; return; }
        sitemapObserved = true;
        for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)) {
          try {
            const target = normalizeCrawlUrl(decodeXml(match[1]!.trim()));
            if (!inScope(target)) continue;
            if (isIndex && target.pathname.toLowerCase().endsWith('.xml')) await loadSitemap(target, depth + 1);
            else sitemapUrls.push(target.href);
          } catch { /* Reject malformed, off-scope and unsafe sitemap destinations. */ }
          if (sitemapUrls.length >= maxPages) { discoveryTruncated = true; break; }
        }
      };
      if (sitemapHints.length > 10) discoveryTruncated = true;
      const sitemapSeeds = [...new Set([new URL('/sitemap.xml', start).href, ...sitemapHints])].slice(0, 10);
      for (const seed of sitemapSeeds) { try { const target = normalizeCrawlUrl(seed); if (target.hostname === start.hostname) await loadSitemap(target, 0); } catch { /* Sitemap is optional; reject unsafe or malformed hints. */ } }
    }
    if (maxDepth >= 1) for (const item of sitemapUrls) if (queue.length < maxPages) queue.push({ url: normalizeCrawlUrl(item), depth: 1 });
    while (queue.length && fetchedPageCount < maxPages && Date.now() < deadline) {
      queue.sort((left, right) => discoveryPriority(right.url) - discoveryPriority(left.url) || left.depth - right.depth || left.url.href.localeCompare(right.url.href));
      signal.throwIfAborted();
      const item = queue.shift()!;
      const url = normalizeCrawlUrl(item.url.href);
      if (!inScope(url) || visited.has(url.href)) continue;
      visited.add(url.href);
      if (blocked(url)) { skippedRobots++; continue; }
      try {
        // Conservative per-host pacing; this crawler is single-threaded by design.
        if (visited.size > 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
        fetchedPageCount++;
        await reportStage('HTML_EXTRACTION');
        input.onOperation?.('crawl.static_fetch');
        const response = await get(url, MAX_RESPONSE_BYTES, inScope, input.validators?.[url.href]);
        if (response.status === 304) { notModifiedUrls.push(url.href); continue; }
        if (response.status === 404 || response.status === 410) { removedUrls.push(url.href); continue; }
        if (response.status === 429 || response.status >= 500) { failed++; retryableFailures++; continue; }
        if (response.status < 200 || response.status >= 300) { failed++; continue; }
        const type = String(response.headers['content-type'] ?? '').toLowerCase();
        if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) { failed++; unsupportedPages++; continue; }
        const html = response.body.toString(/charset=([^;]+)/i.exec(type)?.[1]?.toLowerCase() === 'iso-8859-1' ? 'latin1' : 'utf8');
        input.onOperation?.('crawl.page_extraction');
        const extracted = await extractWebsitePage(html, response.url, item.depth, this.renderer, {
          authorized: input.sourceAuthorized === true, hostname: start.hostname, signal, deadline,
          pathAllowed: (target) => inScope(target) && !blocked(target),
          load: async (target, maxBytes, resourceSignal) => {
            await input.assertAuthorized?.(); resourceSignal.throwIfAborted();
            const resource = await fetchPinned(target, Math.min(maxBytes, MAX_TOTAL_BYTES - totalBytes), deadline, start.hostname, delayMs,
              (candidate) => inScope(candidate) && !blocked(candidate), this.coordinator, this.network, resourceSignal, false, {}, input.onOperation, 'crawl.browser_resource_fetch');
            totalBytes += resource.body.length;
            if (totalBytes > MAX_TOTAL_BYTES) throw rendererError('BROWSER_RESOURCE_LIMIT');
            // Cookies/auth headers are never passed to or retained by the browser.
            const headers: Record<string, string> = {};
            for (const key of ['content-type', 'content-security-policy', 'location', 'x-content-type-options']) {
              const value = resource.headers[key]; if (typeof value === 'string') headers[key] = value;
            }
            return { status: resource.status, headers, body: resource.body };
          },
        }, async () => { await reportStage('BROWSER_RENDERING'); input.onOperation?.('crawl.browser_renderer'); });
        await input.assertAuthorized?.();
        const page = extracted.page;
        {
          const canonical = normalizeCrawlUrl(page.url);
          if (!inScope(canonical) || blocked(canonical)) page.url = response.url.href;
          page.fetchedAt = new Date();
          page.etag = typeof response.headers.etag === 'string' ? response.headers.etag.slice(0, 1024) : null;
          page.lastModified = typeof response.headers['last-modified'] === 'string' ? response.headers['last-modified'].slice(0, 128) : null;
          pages.set(page.url, page);
        }
        if (item.depth < maxDepth) {
          for (const href of extracted.links) {
            try {
              const target = normalizeCrawlUrl(new URL(href.trim(), response.url).href);
              if (inScope(target) && !visited.has(target.href) && !blocked(target)) {
                if (queue.length < maxPages * 4) queue.push({ url: target, depth: item.depth + 1 });
                else discoveryTruncated = true;
              }
            } catch { /* Ignore unsupported and unsafe link targets. */ }
          }
        }
      } catch (error: any) {
        signal.throwIfAborted();
        if (error?.crawlProgressUpdateFailed) throw error;
        failed++;
        const code = String(error?.code ?? error?.message ?? '');
        if (code.startsWith('BROWSER_')) { errorCode = code; unsupportedPages++; }
        if (error?.terminal || ['WORKER_LEASE_LOST', 'WEBSITE_CRAWL_NOT_AUTHORIZED', 'STALE_SOURCE_VERSION'].includes(code)) { errorCode = code || 'WEBSITE_CRAWL_NOT_AUTHORIZED'; break; }
        if (error?.retryable || (!error?.terminal && !['CRAWL_URL_BLOCKED', 'CRAWL_DESTINATION_BLOCKED', 'CRAWL_REDIRECT_LIMIT', 'CRAWL_REDIRECT_OUT_OF_SCOPE', 'CRAWL_PAGE_SIZE_LIMIT', 'CRAWL_TOTAL_SIZE_LIMIT'].includes(code))) retryableFailures++;
        if (['BROWSER_RENDERING_NOT_CONFIGURED', 'BROWSER_ISOLATION_REQUIRED', 'BROWSER_IMAGE_NOT_CONFIGURED', 'WORKER_LEASE_LOST', 'STALE_SOURCE_VERSION'].includes(code)) { errorCode = code; break; }
      }
    }
    if (pages.size === 0 && skippedRobots > 0 && failed === 0) { failed = 1; errorCode = 'ROBOTS_DISALLOWS_CRAWLING'; }
    // Without a fully enumerated sitemap, link discovery is bounded by page/depth
    // limits and cannot authorize source-wide removal reconciliation.
    const complete = sitemapObserved && !discoveryTruncated && queue.length === 0 && Date.now() < deadline && skippedRobots === 0 && failed === 0 && retryableFailures === 0 && unsupportedPages === 0;
    return { pages: [...pages.values()], removedUrls, notModifiedUrls, discovered: visited.size, complete, skippedRobots, failed, retryableFailures, unsupportedPages, totalBytes, errorCode };
  }
}
