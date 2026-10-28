import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { BadRequestException, Injectable } from '@nestjs/common';

function ipv4Number(value: string): number { return value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0); }
function blockedIpv4(value: string): boolean {
  const n = ipv4Number(value);
  const ranges: Array<[number, number]> = [
    [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
    [0xc0000000, 24], [0xc0000200, 24], [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
  ];
  return ranges.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4(address);
  if (family !== 6 || address.includes('%')) return false;
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7);
    if (isIP(tail) === 4) return isPublicAddress(tail);
    const groups = tail.split(':');
    if (groups.length >= 2) {
      const bytes = groups.slice(-2).map((group) => parseInt(group, 16));
      if (bytes.every(Number.isFinite)) return isPublicAddress(`${bytes[0]! >> 8}.${bytes[0]! & 255}.${bytes[1]! >> 8}.${bytes[1]! & 255}`);
    }
    return false;
  }
  const groups = lower.split('::');
  const left = groups[0] ? groups[0].split(':') : [];
  const right = groups[1] ? groups[1].split(':') : [];
  const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (full.length !== 8) return false;
  const value = full.reduce((result, group) => (result << 16n) | BigInt(parseInt(group || '0', 16)), 0n);
  const globalUnicast = value >> 125n === 1n; // 2000::/3 only
  const documentation = value >> 96n === 0x20010db8n;
  const protocolAssignments = value >> 121n === 0x10n; // 2001::/7 special-use range
  const sixToFour = value >> 112n === 0x2002n;
  return globalUnicast && !documentation && !protocolAssignments && !sixToFour;
}

@Injectable()
export class SafeOutboundHttpService {
  private async validatedUrl(input: string) {
    let url: URL;
    try { url = new URL(input); } catch { throw new BadRequestException('Connector URL is invalid'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port || url.hash || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw new BadRequestException('Connector requests require a public HTTPS destination');
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new BadRequestException('Connector destination resolves to a restricted network');
    return { url, address: addresses[0]! };
  }

  async request(method: 'GET' | 'POST', input: string, headers: Record<string, string>, body?: string | Buffer, responseLimit = 1048576, redirectLimit = 3): Promise<{ status: number; location?: string; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
    const maximum = Math.min(Math.max(responseLimit, 1024), 2097152);
    let current = input;
    for (let redirects = 0; redirects <= redirectLimit; redirects += 1) {
      const { url, address } = await this.validatedUrl(current);
      const response = await new Promise<{ status: number; location?: string; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
        const request = httpsRequest(url, {
          method, headers: { ...headers, ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) }, agent: false, servername: url.hostname,
          lookup: ((_hostname: string, options: { all?: boolean }, callback: (error: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void) => {
            if (options.all) callback(null, [{ address: address.address, family: address.family }]);
            else callback(null, address.address, address.family);
          }) as any,
        }, (result) => {
          const chunks: Buffer[] = []; let size = 0;
          result.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maximum) request.destroy(new Error('CONNECTOR_RESPONSE_TOO_LARGE')); else chunks.push(Buffer.from(chunk)); });
          result.on('error', reject);
          result.on('end', () => resolve({ status: result.statusCode ?? 0, ...(result.headers.location ? { location: String(result.headers.location).slice(0, 2048) } : {}), headers: result.headers, body: Buffer.concat(chunks) }));
        });
        request.setTimeout(8000, () => request.destroy(new Error('CONNECTOR_REQUEST_TIMEOUT')));
        request.on('error', reject);
        request.end(body);
      });
      if (response.status < 300 || response.status >= 400 || !response.location) return response;
      if (method !== 'GET') throw new Error('CONNECTOR_REDIRECT_REJECTED');
      if (redirects === redirectLimit) throw new Error('CONNECTOR_REDIRECT_LIMIT');
      const next = new URL(response.location, url);
      current = next.toString();
      // Never forward credentials to another origin, even if that origin is public.
      if (next.origin !== url.origin) headers = {};
    }
    throw new Error('CONNECTOR_REDIRECT_LIMIT');
  }

  async get(input: string, headers: Record<string, string>, redirectLimit = 3): Promise<{ status: number; location?: string }> {
    const result = await this.request('GET', input, headers, undefined, 32768, redirectLimit);
    return { status: result.status, ...(result.location ? { location: result.location } : {}) };
  }

  async post(input: string, headers: Record<string, string>, body: string | Buffer, responseLimit = 1048576) {
    return this.request('POST', input, headers, body, responseLimit, 0);
  }
}
