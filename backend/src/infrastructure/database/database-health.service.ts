import { Logger } from '@nestjs/common';
import { classifyDatabaseError } from './database-error';

export type DatabaseReadiness =
  | { status: 'limited'; database: 'not_configured' }
  | { status: 'ready'; database: 'connected' }
  | { status: 'unavailable'; database: 'unavailable' };

export interface DatabasePing {
  $queryRaw<T = unknown>(query: TemplateStringsArray): Promise<T>;
}

export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);
  private checkedAt = 0;
  private cached: DatabaseReadiness | undefined;
  private pending: Promise<DatabaseReadiness> | undefined;

  constructor(private readonly database: DatabasePing | null) {}

  check(): Promise<DatabaseReadiness> {
    if (!this.database) return Promise.resolve({ status: 'limited', database: 'not_configured' });
    if (this.cached && Date.now() - this.checkedAt < 5_000) return Promise.resolve(this.cached);
    if (this.pending) return this.pending;

    this.pending = this.probe(this.database).then((result) => {
      this.cached = result;
      this.checkedAt = Date.now();
      return result;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async probe(database: DatabasePing): Promise<DatabaseReadiness> {
    try {
      await database.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'connected' };
    } catch (error: unknown) {
      // Keep an operational category for diagnostics, never the driver message or URL.
      this.logger.warn(`Database readiness check failed (${classifyDatabaseError(error)})`);
      return { status: 'unavailable', database: 'unavailable' };
    }
  }
}
