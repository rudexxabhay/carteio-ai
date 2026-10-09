export type DatabaseErrorCategory = 'connection' | 'constraint' | 'timeout' | 'transaction' | 'unknown';

/** Classify known Prisma codes without reading or exposing driver error messages. */
export function classifyDatabaseError(error: unknown): DatabaseErrorCategory {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return 'unknown';
  if (/^P10\d{2}$/.test(code)) return 'connection';
  if (code === 'P2002' || code === 'P2003' || code === 'P2014') return 'constraint';
  if (code === 'P2024') return 'timeout';
  if (code === 'P2034') return 'transaction';
  return 'unknown';
}
