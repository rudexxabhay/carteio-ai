export type RetrievalAudience = 'INTERNAL_MANAGER_PREVIEW' | 'PUBLIC_VISITOR';
export type EffectiveSource = { id: string; visibility: string; [key: string]: unknown };

/** Collection membership never overrides source visibility. */
export function sourcesForAudience<T extends EffectiveSource>(sources: T[], audience: RetrievalAudience): T[] {
  return sources.filter((source) => audience === 'INTERNAL_MANAGER_PREVIEW'
    ? source.visibility === 'INTERNAL_RESTRICTED' || source.visibility === 'PUBLIC_REFERENCE'
    : source.visibility === 'PUBLIC_REFERENCE');
}

export function originMatchesVerifiedDomain(origin: string, verifiedDomain: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    const domain = verifiedDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return Boolean(domain) && host === domain;
  } catch { return false; }
}

/** Public crawls of third-party sites remain attributable references, not verified business origins. */
export function sourceUrlMatchesVerifiedDomain(sourceUrl: string | null | undefined, verifiedDomain: string): boolean {
  if (!sourceUrl) return false;
  try {
    const parsed = new URL(sourceUrl);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return false;
    const normalize = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '').replace(/\.$/, '');
    return normalize(parsed.hostname) === normalize(verifiedDomain);
  } catch { return false; }
}
