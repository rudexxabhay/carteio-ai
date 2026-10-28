import type { Logger } from '@nestjs/common';
import { connectorSyncDebug } from './connector-sync-debug';

describe('connectorSyncDebug database error diagnostics', () => {
  beforeEach(() => { process.env.CONNECTOR_SYNC_DEBUG = 'true'; });
  afterEach(() => { delete process.env.CONNECTOR_SYNC_DEBUG; });

  it('keeps Prisma P2010 separate from the underlying PostgreSQL SQLSTATE', () => {
    const logger = { log: jest.fn(), error: jest.fn() };
    const failure = Object.assign(new Error('raw query failed'), { code: 'P2010', meta: { code: '42601', message: 'syntax error near token=private-value' } });
    connectorSyncDebug(logger as unknown as Logger, '14_worker_job_pickup', 'batch', Date.now(), { operation: 'connector.sync_job_claim' }, failure);
    const diagnostic = JSON.parse(logger.error.mock.calls[0][0]);
    expect(diagnostic).toMatchObject({ prismaCode: 'P2010', databaseCode: '42601', sqlState: '42601', errorCategory: 'DATABASE_SQL_SYNTAX' });
    expect(diagnostic.databaseMessage).toContain('token=[REDACTED]');
    expect(JSON.stringify(diagnostic)).not.toContain('private-value');
  });

  it('does not report the Prisma wrapper code as a SQLSTATE when database metadata is absent', () => {
    const logger = { log: jest.fn(), error: jest.fn() };
    const failure = Object.assign(new Error('raw query failed'), { code: 'P2010' });
    connectorSyncDebug(logger as unknown as Logger, '14_worker_job_pickup', 'batch', Date.now(), { operation: 'connector.sync_job_claim' }, failure);
    const diagnostic = JSON.parse(logger.error.mock.calls[0][0]);
    expect(diagnostic).toMatchObject({ prismaCode: 'P2010', errorCategory: 'DATABASE_PRISMA', diagnosticDetail: 'UNDERLYING_DATABASE_ERROR_UNAVAILABLE' });
    expect(diagnostic).not.toHaveProperty('sqlState');
  });

  it('identifies missing schema objects from safe nested adapter metadata', () => {
    const logger = { log: jest.fn(), error: jest.fn() };
    const failure = Object.assign(new Error('raw query failed'), { code: 'P2010', meta: { driverAdapterError: { cause: { code: '42P01', message: 'relation "ConnectorSyncJob" does not exist' } } } });
    connectorSyncDebug(logger as unknown as Logger, '14_worker_job_pickup', 'batch', Date.now(), { operation: 'connector.sync_job_claim' }, failure);
    const diagnostic = JSON.parse(logger.error.mock.calls[0][0]);
    expect(diagnostic).toMatchObject({ prismaCode: 'P2010', sqlState: '42P01', errorCategory: 'DATABASE_SCHEMA' });
    expect(diagnostic.databaseMessage).toContain('ConnectorSyncJob');
  });
});
