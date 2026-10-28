import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NotFoundException, RequestMethod } from '@nestjs/common';
import { AuthSessionGuard } from '../src/modules/auth/auth-session.guard';
import { KnowledgeController } from '../src/modules/workspaces/knowledge.controller';
import { KnowledgeBaseController } from '../src/modules/workspaces/knowledge-base.controller';
import { AssistantKnowledgeController } from '../src/modules/workspaces/assistant-knowledge.controller';
import { AssistantController } from '../src/modules/workspaces/assistant.controller';
import { WorkspaceController } from '../src/modules/workspaces/workspace.controller';
import { WorkspaceService } from '../src/modules/workspaces/workspace.service';
import { FlowController } from '../src/modules/workspaces/flow.controller';
import { SaasController } from '../src/modules/workspaces/saas.controller';
import { WidgetController } from '../src/modules/workspaces/widget.controller';

type Request = { method: string; path: string; body?: unknown };

// Execute the real browser API module in memory. Only its HTTP transport is
// substituted; no server, application build, provider, or database is started.
function browserApi(name: string, response: unknown = {}) {
  const requests: Request[] = [];
  const transport = Object.fromEntries(['Get', 'Post', 'Patch', 'Put', 'Delete', 'DeleteWithBody'].map((verb) => [
    `api${verb}`, (path: string, body?: unknown) => {
      requests.push({ method: verb.replace('WithBody', '').toUpperCase(), path, ...(verb !== 'Get' ? { body } : {}) });
      return Promise.resolve(response);
    },
  ]));
  const filename = resolve(__dirname, `../../frontend/src/services/api/${name}.ts`);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText;
  const exports: Record<string, (...args: any[]) => any> = {};
  runInNewContext(source, {
    exports, URLSearchParams,
    require: (dependency: string) => {
      if (dependency === './client') return { ...transport, ApiError: class extends Error {} };
      if (dependency === '../../config') return { apiConfig: { baseUrl: '/api/v1' } };
      throw new Error(`Unmocked browser dependency: ${dependency}`);
    },
  }, { filename });
  return { api: exports, requests };
}

const controllers = [KnowledgeController, KnowledgeBaseController, AssistantKnowledgeController, AssistantController, WorkspaceController, FlowController, SaasController, WidgetController];
const routes = controllers.flatMap((controller) => Object.getOwnPropertyNames(controller.prototype).flatMap((key) => {
  const handler = (controller.prototype as unknown as Record<string, unknown>)[key];
  if (typeof handler !== 'function') return [];
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
  if (method === undefined) return [];
  const path = `/${Reflect.getMetadata(PATH_METADATA, controller) || ''}/${Reflect.getMetadata(PATH_METADATA, handler) || ''}`.replace(/\/+/gu, '/').replace(/\/+$/u, '');
  return [{ controller, handler, method: RequestMethod[method], pattern: new RegExp(`^${path.replace(/:[^/]+/gu, '[^/]+')}$`) }];
}));

describe('Phase 00 browser-to-Nest contract protection', () => {
  it.each([
    ['knowledge', 'crawlWebsiteSource', ['north', 'source-a']],
    ['knowledge', 'getWebsiteSourceDetails', ['north', 'source-a']],
    ['knowledge', 'getAssistantKnowledge', ['north', 'assistant-a']],
    ['knowledge-bases', 'listKnowledgeBases', ['north']],
    ['knowledge-bases', 'getKnowledgeBase', ['north', 'base-a']],
    ['knowledge-bases', 'getEffectiveKnowledge', ['north', 'assistant-a']],
    ['assistants', 'getAssistant', ['north', 'assistant-a']],
    ['assistants', 'updateAssistant', ['north', 'assistant-a', { systemInstructions: 'Use saved instructions.', defaultLanguage: 'hi' }]],
    ['assistants', 'getPlaygroundConversation', ['north', 'assistant-a', 'session-a']],
    ['workspaces', 'getWorkspace', ['north']],
    ['flows', 'updateFlow', ['north', 'flow-a', { version: 3, name: 'Saved graph' }]],
    ['flows', 'runFlow', ['north', 'flow-a', 'Question', 'turn-a']],
    ['connectors', 'getConnectorPermissions', ['north', 'connector-a', 'assistant-a']],
    ['connectors', 'beginShopifyInstall', ['north', 'fixture.myshopify.com']],
    ['saas', 'getProducts', ['north', 1, 'bracelet']],
    ['saas', 'getProduct', ['north', 'gid://shopify/Product/1', 'connection-a']],
    ['saas', 'getOrders', ['north', 1, '']],
    ['saas', 'addConversationNote', ['north', 'conversation-a', 'Internal note']],
    ['widget', 'getWidgetConfig', ['north', 'assistant-a']],
    ['widget', 'saveWidgetConfig', ['north', { assistantId: 'assistant-a', enabled: false, allowedDomains: [], appearance: {} }]],
  ] as Array<[string, string, unknown[]]>)('%s.%s resolves to a session-guarded backend route', async (module, operation, args) => {
    const { api, requests } = browserApi(module);
    expect(typeof api[operation]).toBe('function');
    await api[operation]!(...args);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const matches = routes.filter((route) => route.method === request.method && route.pattern.test(request.path.split('?')[0]!));
    expect(matches).toHaveLength(1);
    const route = matches[0]!;
    const guards = [...(Reflect.getMetadata(GUARDS_METADATA, route.controller) || []), ...(Reflect.getMetadata(GUARDS_METADATA, route.handler) || [])];
    expect(guards).toContain(AuthSessionGuard);
    if (operation === 'updateFlow') expect(request.body).toEqual({ expectedVersion: 3, name: 'Saved graph' });
    if (operation === 'updateAssistant') expect(request.body).toEqual(args[2]);
    if (operation === 'runFlow') expect(request.body).toEqual({ message: 'Question', clientTurnId: 'turn-a' });
  });

  it('preserves the backend owner role through the actual browser workspace client', async () => {
    const organization = { id: 'org-a', name: 'North', slug: 'north', status: 'ACTIVE', createdAt: new Date(0), updatedAt: new Date(0) };
    const membership = { role: 'OWNER', organization };
    const db = { organizationMembership: { findFirst: jest.fn(async ({ where }: any) => where.userId === 'owner-a' && where.status === 'ACTIVE' && where.organization.slug === 'north' && where.organization.status === 'ACTIVE' ? membership : null) } };
    const service = new WorkspaceService(db as any);
    const payload = await service.getAuthorized('owner-a', 'north');
    const { api } = browserApi('workspaces', payload);
    const workspace = await api.getWorkspace!('north');
    expect(workspace).toMatchObject({ id: 'org-a', role: 'owner', currentUserRole: 'owner' });
    expect(['owner', 'admin'].includes(workspace.currentUserRole || workspace.role)).toBe(true);
    await expect(service.getAuthorized('other-tenant-user', 'north')).rejects.toBeInstanceOf(NotFoundException);
  });
});
