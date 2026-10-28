import { ForbiddenException } from '@nestjs/common';

let widgetOriginPolicyCacheRevision = 0;

export function invalidateWidgetOriginPolicyCache(): void {
  widgetOriginPolicyCacheRevision += 1;
}

export function currentWidgetOriginPolicyCacheRevision(): number {
  return widgetOriginPolicyCacheRevision;
}

export function normalizeWidgetOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) throw new ForbiddenException('Website origin required');
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const local = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
    if (url.origin !== raw || (url.protocol !== 'https:' && !local) || (url.port && !local)) throw new Error();
    return url.origin;
  } catch {
    throw new ForbiddenException('Website origin is invalid');
  }
}

export function widgetOriginMatchesDomains(origin: string, domains: unknown): boolean {
  if (!Array.isArray(domains)) return false;
  const host = new URL(origin).hostname.toLowerCase();
  const entry = domains[0];
  if (typeof entry !== 'string') return false;
  const domain = entry.trim().toLowerCase();
  // A widget is bound to one exact hostname. Subdomains need their own widget configuration.
  return Boolean(domain) && host === domain;
}

export function widgetSigningSecret(): Buffer {
  const secret = (process.env.AUTH_OTP_HASH_SECRET ?? '').trim();
  if (Buffer.byteLength(secret) < 32 || /^(?:YOUR_|GENERATE_|CHANGE_ME|PLACEHOLDER)/i.test(secret)) throw new Error('Widget session signing is not configured');
  return Buffer.from(secret, 'utf8');
}
