import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { renderPage } from './render-page.mjs';

const controller = new AbortController();
const pending = new Map();
let requestId = 0;
let started = false;
let completed = false;
// Wait for pipe writes before exiting; a large DOM result must not be truncated.
const send = (value) => new Promise((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : resolve());
});
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
// Independent watchdog also applies if the trusted parent crashes or a DOM evaluation loops.
const watchdog = setTimeout(() => process.exit(1), 22_000);
const broker = (url) => new Promise((resolve, reject) => {
  if (controller.signal.aborted || pending.size >= 60) { reject(new Error('BROWSER_RESOURCE_LIMIT')); return; }
  const id = ++requestId; pending.set(id, { resolve, reject });
  void send({ type: 'request', id, method: 'GET', url }).catch((error) => { pending.delete(id); reject(error); });
});
lines.on('line', (line) => {
  try {
    if (Buffer.byteLength(line) > 2_100_000) throw new Error('BROWSER_RESOURCE_LIMIT');
    const message = JSON.parse(line);
    if (!started && message.type === 'render') {
      if (typeof message.url !== 'string' || typeof message.hostname !== 'string' || !Number.isInteger(message.timeoutMs)
        || message.timeoutMs < 1000 || message.timeoutMs > 20_000 || message.maxRequests !== 60) throw new Error('BROWSER_RESOURCE_LIMIT');
      started = true;
      void renderPage(chromium, message, broker, controller.signal).then(async (result) => {
        completed = true; await send({ type: 'result', ...result });
      }).catch(async (error) => {
        completed = true;
        const codes = ['BROWSER_SANDBOX_FAILED', 'BROWSER_RESOURCE_LIMIT', 'BROWSER_CONTENT_INSUFFICIENT', 'BROWSER_NAVIGATION_FAILED'];
        await send({ type: 'error', code: codes.includes(error.message) ? error.message : 'BROWSER_RENDER_FAILED' }).catch(() => undefined);
      }).finally(() => { clearTimeout(watchdog); lines.close(); process.exit(0); });
    } else if (started && message.type === 'response' && pending.has(message.id)) {
      pending.get(message.id).resolve(message); pending.delete(message.id);
    } else throw new Error('BROWSER_RESOURCE_LIMIT');
  } catch {
    controller.abort(); clearTimeout(watchdog); process.exit(1);
  }
});
lines.on('close', () => {
  if (completed) return;
  controller.abort(); for (const value of pending.values()) value.reject(new Error('CRAWL_CANCELLED'));
  // stdin EOF revokes this task's authority; exiting PID 1 stops its browser children.
  process.exit(1);
});
