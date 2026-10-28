import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';

export type RendererAvailability = { configured: boolean; code: string | null; message: string };
export type RenderedWebsite = { html: string; url: string; links: string[] };
export type RenderResource = { status: number; headers: Record<string, string>; body: Buffer };
export type RenderRequest = {
  url: URL; authorized: boolean; hostname: string; signal: AbortSignal; deadline: number;
  pathAllowed: (url: URL) => boolean;
  load: (url: URL, maxBytes: number, signal: AbortSignal) => Promise<RenderResource>;
};
export interface WebsiteRenderer {
  readonly availability: RendererAvailability;
  render(request: RenderRequest): Promise<RenderedWebsite>;
}

export function rendererError(code: string, retryable = false): Error {
  return Object.assign(new Error(code), { code, retryable, terminal: !retryable });
}

/** No client/model input can choose a renderer, executable, container flag or image. */
export function rendererAvailability(env: NodeJS.ProcessEnv = process.env, platform = process.platform): RendererAvailability {
  if (env.KNOWLEDGE_BROWSER_RENDERING_ENABLED !== 'true') return { configured: false, code: 'BROWSER_RENDERING_NOT_CONFIGURED', message: 'JavaScript rendering is not configured on this deployment. Static HTML crawling remains available.' };
  if (platform !== 'linux') return { configured: false, code: 'BROWSER_ISOLATION_REQUIRED', message: 'JavaScript rendering requires an isolated Linux rendering worker.' };
  if (!/^sha256:[a-f0-9]{64}$/.test(env.KNOWLEDGE_RENDERER_IMAGE ?? '')) return { configured: false, code: 'BROWSER_IMAGE_NOT_CONFIGURED', message: 'The isolated JavaScript renderer has not been configured by the deployment administrator.' };
  return { configured: true, code: null, message: 'Automatic rendering is configured; isolation is checked before each browser task.' };
}

/** Additional application policy. The trusted loader also performs pinned DNS/IP validation. */
export function assertRenderDestination(raw: string, request: Pick<RenderRequest, 'authorized' | 'hostname' | 'pathAllowed'>): URL {
  if (!request.authorized) throw rendererError('WEBSITE_CRAWL_NOT_AUTHORIZED');
  let url: URL;
  try { url = new URL(raw); } catch { throw rendererError('BROWSER_DESTINATION_BLOCKED'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.hostname !== request.hostname || url.port || !request.pathAllowed(url)) throw rendererError('BROWSER_DESTINATION_BLOCKED');
  return url;
}

const command = promisify(execFile);
// Do not inherit API secrets, proxy variables, Docker contexts or a host user profile.
const dockerEnv = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/nonexistent', DOCKER_CONFIG: '/nonexistent', DOCKER_HOST: 'unix:///var/run/docker.sock' };
const RUNTIME = 'carteio-renderer';
const MAX_RENDER_MS = 25_000;
const MAX_REQUESTS = 60;
const MAX_BYTES = 6_000_000;
const MAX_LINE_BYTES = 2_500_000;

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Inspect before start: an image or daemon must not silently replace the isolation contract. */
export function assertContainerIsolation(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 1 || !record(value[0])) throw rendererError('BROWSER_ISOLATION_REQUIRED');
  const container = value[0]; const host = container.HostConfig; const config = container.Config;
  if (!record(host) || !record(config) || host.NetworkMode !== 'none' || host.Runtime !== RUNTIME
    || host.Privileged !== false || host.ReadonlyRootfs !== true || host.IpcMode !== 'private'
    || config.User !== 'pwuser' || !Array.isArray(host.CapDrop) || !host.CapDrop.includes('ALL')
    || !Array.isArray(host.SecurityOpt) || !host.SecurityOpt.some((option) => typeof option === 'string' && option.startsWith('no-new-privileges'))
    || host.Memory !== 536870912 || host.MemorySwap !== 536870912 || host.NanoCpus !== 1000000000 || host.PidsLimit !== 256
    || !Array.isArray(config.Entrypoint) || config.Entrypoint.length !== 1 || config.Entrypoint[0] !== 'node'
    || !Array.isArray(config.Cmd) || config.Cmd.length !== 1 || config.Cmd[0] !== '/app/worker.mjs'
    || !Array.isArray(container.Mounts) || container.Mounts.some((mount) => !record(mount) || mount.Type !== 'tmpfs' || !['/tmp', '/dev/shm'].includes(String(mount.Destination)))
    || !record(host.PortBindings) || Object.keys(host.PortBindings).length !== 0) throw rendererError('BROWSER_ISOLATION_REQUIRED');
}

export function assertRendererRuntime(value: unknown): void {
  if (!record(value) || !record(value[RUNTIME])) throw rendererError('BROWSER_ISOLATION_REQUIRED');
  const runtime = value[RUNTIME];
  if (typeof runtime.path !== 'string' || !/(^|\/)runsc$/.test(runtime.path)
    || !Array.isArray(runtime.runtimeArgs) || !runtime.runtimeArgs.includes('--network=none')) throw rendererError('BROWSER_ISOLATION_REQUIRED');
}

/** A fresh network-disabled gVisor container per page; HTTP is brokered over stdio. */
export class IsolatedContainerRenderer implements WebsiteRenderer {
  readonly availability: RendererAvailability;
  constructor(private readonly image = process.env.KNOWLEDGE_RENDERER_IMAGE ?? '', env: NodeJS.ProcessEnv = process.env) {
    this.availability = rendererAvailability({ ...env, KNOWLEDGE_RENDERER_IMAGE: image });
  }

  async render(request: RenderRequest): Promise<RenderedWebsite> {
    if (!this.availability.configured) throw rendererError(this.availability.code ?? 'BROWSER_RENDERING_NOT_CONFIGURED');
    assertRenderDestination(request.url.href, request);
    request.signal.throwIfAborted();
    const remaining = Math.min(MAX_RENDER_MS, request.deadline - Date.now());
    if (remaining < 1000) throw rendererError('BROWSER_RENDER_TIMEOUT', true);
    const name = `carteio-render-${randomUUID()}`;
    const controller = new AbortController();
    const abort = () => controller.abort(rendererError('CRAWL_CANCELLED'));
    request.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(rendererError('BROWSER_RENDER_TIMEOUT', true)), remaining);
    let created = false;
    const run = (args: string[]) => command('docker', args, { env: dockerEnv, timeout: 6000, maxBuffer: 64_000, signal: controller.signal });
    try {
      // Local image only; no pull, daemon changes, paid service or browser download.
      const runtimeInfo = await run(['info', '--format', '{{json .Runtimes}}']);
      const runtimes: unknown = JSON.parse(runtimeInfo.stdout);
      assertRendererRuntime(runtimes);
      await run(['image', 'inspect', this.image]);
      await run(['create', '--pull=never', '--name', name, '--runtime', RUNTIME, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges=true', '--user', 'pwuser', '--ipc', 'private', '--memory', '512m', '--memory-swap', '512m',
        '--cpus', '1', '--pids-limit', '256', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m,mode=1777', '--tmpfs', '/dev/shm:rw,noexec,nosuid,size=128m,mode=1777',
        '--entrypoint', 'node', '--interactive', this.image, '/app/worker.mjs']);
      created = true;
      const inspected = await run(['inspect', name]);
      assertContainerIsolation(JSON.parse(inspected.stdout));
      return await this.exchange(name, request, controller.signal, remaining);
    } catch (error: unknown) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('BROWSER_')) throw error;
      // No raw Docker output, host paths, credentials or page logs enter user-facing errors.
      throw rendererError('BROWSER_RUNTIME_UNAVAILABLE', true);
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', abort); controller.abort();
      // This also kills orphaned Chromium tasks if the attached process exited unexpectedly.
      try { await command('docker', ['rm', '--force', name], { env: dockerEnv, timeout: 5000, maxBuffer: 4096 }); }
      catch { if (created) throw rendererError('BROWSER_CLEANUP_FAILED', true); }
    }
  }

  private exchange(name: string, request: RenderRequest, signal: AbortSignal, timeoutMs: number): Promise<RenderedWebsite> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['start', '--attach', '--interactive', name], { env: dockerEnv, stdio: ['pipe', 'pipe', 'pipe'], signal });
      let input = ''; let bytes = 0; let count = 0; let done = false; let queue = Promise.resolve();
      let outputBytes = 0; let lines = 0;
      const decoder = new StringDecoder('utf8');
      const seen = new Set<number>();
      const finish = (error?: Error, result?: RenderedWebsite) => {
        if (done) return; done = true; child.stdin.end();
        if (error) reject(error); else if (result) resolve(result);
      };
      const send = (message: object) => { if (!done && !signal.aborted) child.stdin.write(`${JSON.stringify(message)}\n`); };
      const handle = async (message: unknown) => {
        if (signal.aborted || done) return;
        if (!record(message)) throw rendererError('BROWSER_PROTOCOL_INVALID');
        if (message.type === 'request') {
          if (typeof message.id !== 'number' || !Number.isInteger(message.id) || seen.has(message.id) || typeof message.url !== 'string' || message.url.length > 2048
            || message.method !== 'GET' || ++count > MAX_REQUESTS) throw rendererError('BROWSER_RESOURCE_LIMIT');
          seen.add(message.id);
          try {
            const url = assertRenderDestination(message.url, request);
            const resource = await request.load(url, Math.min(1_500_000, MAX_BYTES - bytes), signal);
            bytes += resource.body.length;
            if (bytes > MAX_BYTES) throw rendererError('BROWSER_RESOURCE_LIMIT');
            send({ type: 'response', id: message.id, status: resource.status, headers: resource.headers, body: resource.body.toString('base64') });
          } catch (error: unknown) {
            if (error instanceof Error && error.message === 'CRAWL_PAGE_SIZE_LIMIT') throw rendererError('BROWSER_RESOURCE_LIMIT');
            if (error instanceof Error && 'code' in error && error.code === 'BROWSER_RESOURCE_LIMIT') throw error;
            send({ type: 'response', id: message.id, blocked: true });
          }
        } else if (message.type === 'result') {
          if (typeof message.html !== 'string' || Buffer.byteLength(message.html) > 1_500_000 || typeof message.url !== 'string'
            || !Array.isArray(message.links) || message.links.length > 2000 || !message.links.every((url) => typeof url === 'string' && url.length <= 2048)) throw rendererError('BROWSER_RESOURCE_LIMIT');
          assertRenderDestination(message.url, request);
          finish(undefined, { html: message.html, url: message.url, links: message.links });
        } else if (message.type === 'error') {
          const permitted = ['BROWSER_RENDER_TIMEOUT', 'BROWSER_CONTENT_INSUFFICIENT', 'BROWSER_RESOURCE_LIMIT', 'BROWSER_SANDBOX_FAILED', 'BROWSER_NAVIGATION_FAILED'];
          const code = typeof message.code === 'string' && permitted.includes(message.code) ? message.code : 'BROWSER_RENDER_FAILED';
          throw rendererError(code, code === 'BROWSER_RENDER_TIMEOUT');
        } else throw rendererError('BROWSER_PROTOCOL_INVALID');
      };
      child.stdout.on('data', (data: Buffer) => {
        outputBytes += data.length; input += decoder.write(data);
        if (outputBytes > 4_000_000 || Buffer.byteLength(input) > MAX_LINE_BYTES) { finish(rendererError('BROWSER_RESOURCE_LIMIT')); child.kill(); return; }
        let separator: number;
        while ((separator = input.indexOf('\n')) >= 0) {
          const line = input.slice(0, separator); input = input.slice(separator + 1);
          if (++lines > MAX_REQUESTS + 2) { finish(rendererError('BROWSER_RESOURCE_LIMIT')); child.kill(); return; }
          queue = queue.then(async () => { const message: unknown = JSON.parse(line); await handle(message); }).catch((error: unknown) => {
            finish(error instanceof Error && 'code' in error ? error : rendererError('BROWSER_PROTOCOL_INVALID')); child.kill();
          });
        }
      });
      child.stderr.on('data', () => { /* Drain untrusted diagnostics without retaining page content or secrets. */ });
      child.stdin.on('error', () => finish(rendererError('BROWSER_RUNTIME_UNAVAILABLE', true)));
      child.on('error', () => finish(rendererError(signal.aborted ? 'CRAWL_CANCELLED' : 'BROWSER_RUNTIME_UNAVAILABLE', !signal.aborted)));
      child.on('close', () => { void queue.finally(() => { if (!done) finish(rendererError('BROWSER_RENDER_FAILED', true)); }); });
      send({ type: 'render', url: request.url.href, hostname: request.hostname, timeoutMs: Math.min(timeoutMs, 20_000), maxRequests: MAX_REQUESTS });
    });
  }
}

export function createWebsiteRenderer(): WebsiteRenderer { return new IsolatedContainerRenderer(); }
