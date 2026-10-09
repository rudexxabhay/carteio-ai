export function safeInternalDestination(value: unknown, origin = window.location.origin): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/dashboard';
  try {
    const target = new URL(value, origin);
    return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : '/dashboard';
  } catch { return '/dashboard'; }
}
