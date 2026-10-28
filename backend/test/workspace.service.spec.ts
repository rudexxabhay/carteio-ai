import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AuthSessionGuard } from '../src/modules/auth/auth-session.guard';
import type { AuthenticatedRequest } from '../src/modules/auth/auth-session.guard';
import { sessionCookieName } from '../src/modules/auth/auth.service';
import type { AssistantService } from '../src/modules/workspaces/assistant.service';
import { AssistantController } from '../src/modules/workspaces/assistant.controller';
import { WorkspaceController } from '../src/modules/workspaces/workspace.controller';
import { WorkspaceService, normalizeWorkspaceSlug } from '../src/modules/workspaces/workspace.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

const userId = 'b9b936fb-ff46-44c5-83fd-dd40b0d6f825';
const otherUserId = '6a6c17b9-bd0e-42a6-81fa-5319e24994a6';
const org = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1', name: 'Carteio', slug: 'carteio', websiteUrl: null, businessType: null,
  status: 'ACTIVE', createdAt: new Date('2026-10-10T00:00:00Z'), updatedAt: new Date('2026-10-10T00:00:00Z'), ...overrides,
});
const workspaceService = (db: Record<string, any>) => new WorkspaceService(db as unknown as PrismaService);

describe('workspace authorization and creation', () => {
  it('requires a verified authenticated session on workspace endpoints', async () => {
    const guard = new AuthSessionGuard({ current: jest.fn().mockRejectedValue(new UnauthorizedException()) } as any);
    const request = { headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request).not.toHaveProperty('authSession');
    expect(Reflect.getMetadata('__guards__', WorkspaceController)).toContain(AuthSessionGuard);
  });

  it.each([
    ['an invalid credential', 'invalid-session-token'],
    ['a malformed encoded credential', '%E0%A4%A'],
  ])('fails closed for %s before attaching a trusted identity', async (_description, token) => {
    const current = jest.fn().mockRejectedValue(new UnauthorizedException());
    const guard = new AuthSessionGuard({ current } as any);
    const cookie = token === '%E0%A4%A' ? `${sessionCookieName()}=${token}` : `${sessionCookieName()}=${encodeURIComponent(token)}`;
    const request = { headers: { cookie }, body: { userId: otherUserId, workspaceId: 'workspace-b' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(current).toHaveBeenCalledWith(token === '%E0%A4%A' ? undefined : token);
    expect(request).not.toHaveProperty('authSession');
  });

  it('derives request identity from the verified session, not client fields', async () => {
    const current = jest.fn().mockResolvedValue({ sessionId: 'server-session', user: { id: userId, name: 'Verified' } });
    const guard = new AuthSessionGuard({ current } as any);
    const request: { headers: { cookie: string }; body: { userId: string; workspaceId: string }; authSession?: { userId: string; sessionId: string; user: { id: string; name: string } } } = {
      headers: { cookie: `${sessionCookieName()}=valid-session-token` },
      body: { userId: otherUserId, workspaceId: 'workspace-b' },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authSession).toMatchObject({ userId, sessionId: 'server-session', user: { id: userId } });
    expect(request.authSession).not.toMatchObject({ userId: otherUserId });
  });

  it('passes only the guard-established identity to Playground session access', async () => {
    const request = {
      headers: { cookie: `${sessionCookieName()}=verified-session-token` },
      body: { userId: otherUserId, workspaceId: 'workspace-b', assistantId: 'assistant-b' },
    } as unknown as AuthenticatedRequest;
    const guard = new AuthSessionGuard({ current: jest.fn().mockResolvedValue({ sessionId: 'server-session', user: { id: userId, name: 'Verified' } }) } as any);
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    await guard.canActivate(context);

    const playgroundConversation = jest.fn().mockResolvedValue({ sessionId: 'session-1', messages: [] });
    const controller = new AssistantController({ playgroundConversation } as unknown as AssistantService);
    await controller.playgroundConversation(request, 'carteio', 'assistant-a', 'session-1');

    expect(playgroundConversation).toHaveBeenCalledWith(userId, 'carteio', 'assistant-a', 'session-1', 0, 40);
    expect(Reflect.getMetadata('__guards__', AssistantController)).toContain(AuthSessionGuard);
  });

  it('normalizes workspace slugs consistently and rejects reserved or invalid values', () => {
    expect(normalizeWorkspaceSlug('  Carteió  AI ')).toBe('carteio-ai');
    expect(normalizeWorkspaceSlug('my_workspace')).toBe('my-workspace');
    expect(() => normalizeWorkspaceSlug('admin')).toThrow();
    expect(() => normalizeWorkspaceSlug('has/route')).toThrow();
  });

  it('creates an organization, owner membership, and audit event in one transaction', async () => {
    const calls: Array<{ model: string; args: Record<string, unknown> }> = [];
    const transaction = {
      organization: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { calls.push({ model: 'organization', args: data }); return org(data); }) },
      organizationMembership: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { calls.push({ model: 'membership', args: data }); return data; }) },
      auditEvent: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { calls.push({ model: 'audit', args: data }); return data; }) },
    };
    const db = { $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(transaction)) };
    const result = await workspaceService(db).create(userId, { name: ' Carteio ', slug: 'CARTEIO', websiteUrl: 'https://carteio.in', businessType: 'SaaS' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.model)).toEqual(['organization', 'membership', 'audit']);
    expect(calls[0]?.args).toMatchObject({ name: 'Carteio', slug: 'carteio', websiteUrl: 'https://carteio.in', businessType: 'SaaS' });
    expect(calls[1]?.args).toMatchObject({ userId, role: 'OWNER', status: 'ACTIVE' });
    expect(calls[2]?.args).toMatchObject({ actorUserId: userId, action: 'workspace.created', entityType: 'organization' });
    expect(calls[2]?.args).toMatchObject({ metadata: { role: 'OWNER' } });
    expect(JSON.stringify(calls[2]?.args)).not.toContain('carteio');
    expect(result).toMatchObject({ slug: 'carteio', role: 'owner', status: 'active' });
  });

  it('maps a slug uniqueness race to a safe conflict response', async () => {
    const db = { $transaction: jest.fn(async (_callback?: unknown) => { throw { code: 'P2002' }; }) };
    await expect(workspaceService(db).create(userId, { name: 'Example', slug: 'example' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rolls back the complete creation callback when owner membership or audit creation fails', async () => {
    const operations: string[] = [];
    const committed: string[] = [];
    const transaction = {
      organization: { create: jest.fn(async (_input: { data: Record<string, unknown> }) => { operations.push('organization'); return org(); }) },
      organizationMembership: { create: jest.fn(async (_input: { data: Record<string, unknown> }) => { operations.push('membership'); return {}; }) },
      auditEvent: { create: jest.fn(async () => { throw new Error('audit unavailable'); }) },
    };
    const db = { $transaction: jest.fn(async (callback: (tx: any) => unknown) => {
      const staged: string[] = [];
      const wrapped = {
        organization: { create: async (input: { data: Record<string, unknown> }) => { const value = await transaction.organization.create(input); staged.push('organization'); return value; } },
        organizationMembership: { create: async (input: { data: Record<string, unknown> }) => { const value = await transaction.organizationMembership.create(input); staged.push('membership'); return value; } },
        auditEvent: transaction.auditEvent,
      };
      const result = await callback(wrapped);
      committed.push(...staged);
      return result;
    }) };
    await expect(workspaceService(db).create(userId, { name: 'Example', slug: 'example' })).rejects.toThrow('audit unavailable');
    expect(operations).toEqual(['organization', 'membership']);
    expect(committed).toEqual([]);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('allows the database unique constraint to resolve concurrent slug creation races', async () => {
    const slugs = new Set<string>();
    const transaction = {
      organization: { create: jest.fn(async ({ data }: { data: { slug: string } }) => {
        if (slugs.has(data.slug)) throw { code: 'P2002' };
        slugs.add(data.slug);
        return org(data);
      }) },
      organizationMembership: { create: jest.fn(async () => ({})) },
      auditEvent: { create: jest.fn(async () => ({})) },
    };
    const db = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const results = await Promise.allSettled([
      workspaceService(db).create(userId, { name: 'Example', slug: 'example' }),
      workspaceService(db).create(otherUserId, { name: 'Example', slug: 'example' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof ConflictException)).toHaveLength(1);
  });

  it('lists only active memberships belonging to the current user', async () => {
    const findMany = jest.fn().mockResolvedValue([{ role: 'OWNER', organization: org() }]);
    const count = jest.fn().mockResolvedValue(1);
    const result = await workspaceService({ organizationMembership: { findMany, count } }).list(userId, { page: 1, pageSize: 25 });
    expect(findMany.mock.calls[0]?.[0].where).toEqual({ userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } });
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({ slug: 'carteio', role: 'owner' });
  });

  it('hides unauthorized or inactive organizations as not found', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = workspaceService({ organizationMembership: { findFirst } });
    await expect(service.getAuthorized(otherUserId, 'carteio')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0]?.[0].where).toEqual({ userId: otherUserId, status: 'ACTIVE', organization: { slug: 'carteio', status: 'ACTIVE' } });
  });

  it('returns a generic not-found API error without revealing organization identifiers', () => {
    const filter = new AllExceptionsFilter();
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const request = { requestId: 'req-1', method: 'GET', route: { path: '/workspaces/:slug' } };
    const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as any;
    filter.catch(new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' }), host);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'WORKSPACE_NOT_FOUND', message: 'Resource not found', path: '/workspaces/:slug' }));
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('org-secret');
  });

  it('prevents members from changing settings and never reaches the cross-tenant update', async () => {
    const update = jest.fn();
    const service = workspaceService({
      organizationMembership: { findFirst: jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'MEMBER' }) },
      organization: { update },
    });
    await expect(service.update(otherUserId, 'carteio', { name: 'Changed' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant updates without exposing whether the slug exists', async () => {
    const update = jest.fn();
    const service = workspaceService({ organizationMembership: { findFirst: jest.fn().mockResolvedValue(null) }, organization: { update } });
    await expect(service.update(otherUserId, 'carteio', { name: 'Changed' })).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns member names and roles without emails or other private fields', async () => {
    const findFirst = jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'OWNER' });
    const findMany = jest.fn().mockResolvedValue([{ id: 'membership-1', role: 'OWNER', createdAt: new Date(), user: { id: userId, name: 'Owner' } }]);
    const count = jest.fn().mockResolvedValue(1);
    const result = await workspaceService({ organizationMembership: { findFirst, findMany, count } }).members(userId, 'carteio', { page: 1, pageSize: 25 });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { organizationId: 'org-1', status: 'ACTIVE' }, select: { user: { select: { id: true, name: true } } } });
    expect(result.members[0]).toEqual({ id: userId, name: 'Owner', role: 'owner', joinedAt: expect.any(Date) });
    expect(JSON.stringify(result)).not.toContain('@');
  });

  it('uses a forward-only migration for optional workspace profile fields', () => {
    const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(resolve(__dirname, '../prisma/migrations/20261010120000_phase_05_workspace_profile/migration.sql'), 'utf8');
    expect(schema).toContain('websiteUrl  String?');
    expect(schema).toContain('businessType String?');
    expect(migration).toContain('ADD COLUMN "websiteUrl"');
    expect(migration).toContain('ADD COLUMN "businessType"');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|SCHEMA)/i);
  });
});
