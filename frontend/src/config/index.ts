export const productConfig = { name: 'Carteio AI' } as const;

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1';
if (!configuredApiBase.startsWith('/') || configuredApiBase.startsWith('//') || configuredApiBase.includes('..')) {
  throw new Error('VITE_API_BASE_URL must be a same-origin path such as /api/v1');
}
export const apiConfig = { baseUrl: configuredApiBase.replace(/\/$/, ''), timeoutMs: 8000 } as const;

const configuredWidgetHostingOrigin = import.meta.env.VITE_WIDGET_HOSTING_ORIGIN?.trim();
const configuredWidgetApiOrigin = import.meta.env.VITE_WIDGET_API_ORIGIN?.trim();
function validatedWidgetOrigin(rawOrigin: string): string | null {
  let parsed: URL;
  try { parsed = new URL(rawOrigin); }
  catch { return null; }
  const localHost = parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost') || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if ((parsed.protocol !== 'https:' && !(import.meta.env.DEV && localHost && parsed.protocol === 'http:')) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  return parsed.origin;
}

export function getWidgetHostingOrigin(): string {
  const rawOrigin = configuredWidgetHostingOrigin || (import.meta.env.DEV ? window.location.origin : '');
  return rawOrigin ? validatedWidgetOrigin(rawOrigin) ?? '' : '';
}

export function getWidgetApiOrigin(): string | null {
  return configuredWidgetApiOrigin ? validatedWidgetOrigin(configuredWidgetApiOrigin) : null;
}

export function isWidgetApiOriginConfigurationValid(): boolean {
  return !configuredWidgetApiOrigin || getWidgetApiOrigin() !== null;
}
