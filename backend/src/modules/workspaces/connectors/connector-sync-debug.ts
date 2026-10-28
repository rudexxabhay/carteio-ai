import type { Logger } from '@nestjs/common';

type DebugFields = Record<string, string | number | boolean | null | undefined>;

function safeType(error: unknown): string {
  const value = error instanceof Error ? error.constructor?.name : 'UnknownError';
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(value) ? value : 'Error';
}

function safeDatabaseMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const message = value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bpostgres(?:ql)?:\/\/\S+/gi, '[REDACTED_CONNECTION]')
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Key\s+\([^)]+\)=\([^)]+\)/gi, 'Key ([REDACTED])')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[REDACTED_ID]')
    .replace(/(password authentication failed for user)\s+'[^']+'/gi, '$1 [REDACTED]')
    .replace(/(invalid input value for enum[^:]*:)\s*'[^']*'/gi, '$1 [REDACTED]')
    .replace(/(invalid input syntax for type [^:]+:)\s*'[^']*'/gi, '$1 [REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 240);
  return message || undefined;
}

function databaseFailureCategory(sqlState: string | undefined): string | undefined {
  if (!sqlState) return undefined;
  if (sqlState === '42601') return 'DATABASE_SQL_SYNTAX';
  if (sqlState === '42P01' || sqlState === '42703' || sqlState === '42704' || sqlState === '42883') return 'DATABASE_SCHEMA';
  if (sqlState.startsWith('08')) return 'DATABASE_CONNECTION';
  if (sqlState.startsWith('22')) return 'DATABASE_DATA';
  if (sqlState.startsWith('40')) return 'DATABASE_TRANSACTION';
  if (sqlState === '55P03' || sqlState === '57014') return 'DATABASE_LOCKING_OR_TIMEOUT';
  return 'DATABASE_SQL';
}

function errorDetails(error: unknown) {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  const types: string[] = [];
  let prismaCode: string | undefined;
  let databaseCode: string | undefined;
  let sqlState: string | undefined;
  let databaseMessage: string | undefined;
  while (pending.length && types.length < 5) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    types.push(safeType(item));
    const record = item as { cause?: unknown; code?: unknown; meta?: unknown; errors?: unknown };
    if (!prismaCode && typeof record.code === 'string' && /^P\d{4}$/.test(record.code)) prismaCode = record.code;
    if (!sqlState && typeof record.code === 'string' && /^[0-9A-Z]{5}$/.test(record.code) && !/^P\d{4}$/.test(record.code)) sqlState = record.code;
    const metadataCandidates: unknown[] = [record.meta];
    if (record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta)) {
      const metadata = record.meta as { driverAdapterError?: unknown; cause?: unknown };
      metadataCandidates.push(metadata.driverAdapterError, metadata.cause);
      if (metadata.driverAdapterError && typeof metadata.driverAdapterError === 'object' && !Array.isArray(metadata.driverAdapterError)) {
        metadataCandidates.push((metadata.driverAdapterError as { cause?: unknown }).cause);
      }
    }
    for (const candidate of metadataCandidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const metadata = candidate as { code?: unknown; message?: unknown; database_error?: unknown };
      const candidateCode = typeof metadata.code === 'string' && /^[0-9A-Z_]{1,32}$/.test(metadata.code) && metadata.code !== prismaCode ? metadata.code : undefined;
      if (!databaseCode && candidateCode) databaseCode = candidateCode;
      if (!sqlState && candidateCode && /^[0-9A-Z]{5}$/.test(candidateCode)) sqlState = candidateCode;
      if (!databaseMessage) databaseMessage = safeDatabaseMessage(metadata.message) ?? safeDatabaseMessage(metadata.database_error);
    }
    if ('cause' in record) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors.slice(0, 4));
  }
  const category = databaseFailureCategory(sqlState) ?? (prismaCode ? 'DATABASE_PRISMA' : types.includes('TypeError') || types.includes('RangeError') ? 'RUNTIME' : 'OPERATION');
  return {
    exceptionType: types[0] ?? 'UnknownError', causeTypes: types.slice(1),
    ...(prismaCode ? { prismaCode } : {}), ...(databaseCode ? { databaseCode } : {}), ...(sqlState ? { sqlState } : {}),
    ...(databaseMessage ? { databaseMessage } : {}),
    ...(prismaCode && !databaseCode && !databaseMessage ? { diagnosticDetail: 'UNDERLYING_DATABASE_ERROR_UNAVAILABLE' } : {}),
    errorCategory: category,
  };
}

export function connectorSyncDebug(logger: Logger, stage: string, requestId: string, startedAt: number, fields: DebugFields = {}, error?: unknown) {
  if (process.env.CONNECTOR_SYNC_DEBUG !== 'true') return;
  const payload = {
    event: 'connector_sync_debug',
    prefix: '[SHOPIFY_SYNC_DEBUG]',
    stage,
    requestId,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    ...fields,
    ...(error === undefined ? { outcome: 'success' } : { outcome: 'failure', ...errorDetails(error) }),
  };
  const serialized = JSON.stringify(payload);
  if (error === undefined) logger.log(serialized);
  else logger.error(serialized);
}
