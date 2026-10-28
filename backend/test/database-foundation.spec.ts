import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyDatabaseError } from '../src/infrastructure/database/database-error';
import { DatabaseHealthService } from '../src/infrastructure/database/database-health.service';
import { HealthController } from '../src/modules/health/health.controller';
import type { Response } from 'express';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

describe('database foundation', () => {
  it('returns minimal ready status when the configured database answers', async () => {
    const database = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const health = new DatabaseHealthService(database);
    await expect(health.check()).resolves.toEqual({ status: 'ready', database: 'connected' });
    await expect(health.check()).resolves.toEqual({ status: 'ready', database: 'connected' });
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns a redacted unavailable status on a database error', async () => {
    const database = { $queryRaw: jest.fn().mockRejectedValue(new Error('postgres://private-host/password')) };
    await expect(new DatabaseHealthService(database).check()).resolves.toEqual({ status: 'unavailable', database: 'unavailable' });
  });

  it('maps unavailable database readiness to HTTP 503 without returning driver details', async () => {
    const controller = new HealthController(new DatabaseHealthService({
      $queryRaw: jest.fn().mockRejectedValue(new Error('postgres://private-host/password')),
    }));
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.getReadiness(response as unknown as Response);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ status: 'unavailable', database: 'unavailable' });
  });

  it('disconnects Prisma during Nest application shutdown', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    await PrismaService.prototype.onModuleDestroy.call({ $disconnect: disconnect } as unknown as PrismaService);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('classifies common Prisma failures without inspecting error messages', () => {
    expect(classifyDatabaseError({ code: 'P2002', message: 'private data' })).toBe('constraint');
    expect(classifyDatabaseError({ code: 'P2024' })).toBe('timeout');
    expect(classifyDatabaseError({ code: 'P2034' })).toBe('transaction');
    expect(classifyDatabaseError({ code: 'P1001' })).toBe('connection');
    expect(classifyDatabaseError(new Error('secret'))).toBe('unknown');
  });

  it('declares tenant-matching composite foreign keys and restrictive deletion in the schema', () => {
    const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('@@unique([userId, organizationId])');
    expect(schema).toContain('references: [id, organizationId], onDelete: Restrict');
    expect(schema).toContain('verificationStatus WebsiteVerificationStatus @default(UNVERIFIED)');
    expect(schema).toContain('onDelete: Restrict');
    // Password hashes and session/token digests are intentionally persisted;
    // provider credentials must remain environment-only.
    expect(schema).toContain('passwordHash String');
    expect(schema).toMatch(/tokenHash\s+String/);
    expect(schema).not.toMatch(/(?:provider|groq|gemini|openai)ApiKey|apiKey\s+String/i);
  });
});
