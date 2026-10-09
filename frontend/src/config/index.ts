export const productConfig = { name: 'Carteio AI', domain: 'https://ai.carteio.in' } as const;

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1';
if (!configuredApiBase.startsWith('/') || configuredApiBase.startsWith('//') || configuredApiBase.includes('..')) {
  throw new Error('VITE_API_BASE_URL must be a same-origin path such as /api/v1');
}
export const apiConfig = { baseUrl: configuredApiBase.replace(/\/$/, ''), timeoutMs: 8000 } as const;
