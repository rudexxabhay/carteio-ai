import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SaasService } from './saas.service';

describe('SaasService tenant-scoped product foundations', () => {
  const organizationId = 'workspace-a';
  let db: any;
  let workspaces: any;
  let service: SaasService;

  beforeEach(() => {
    db = {
      integrationConnection: { findMany: jest.fn(), count: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      connectorInstance: { findMany: jest.fn().mockResolvedValue([]) },
      connectorDataPermission: { findMany: jest.fn().mockResolvedValue([]) },
      commerceProduct: { findMany: jest.fn(), count: jest.fn() },
      commerceOrder: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
      supportConversation: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      supportMessage: { create: jest.fn() },
      workspaceSubscription: { findFirst: jest.fn() },
      playgroundMessage: { aggregate: jest.fn(), count: jest.fn() },
      playgroundConversation: { count: jest.fn() },
      organizationMembership: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({ integrationConnection: db.integrationConnection, auditEvent: { create: jest.fn() } })),
    };
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId, role: 'OWNER' }) };
    service = new SaasService(db, workspaces, { processTrustedCustomerTurn: jest.fn().mockResolvedValue({}) } as any);
  });

  it('creates only a draft and never stores or returns submitted credentials', async () => {
    db.integrationConnection.create.mockResolvedValue({ id: 'connection-a', platform: 'SHOPIFY', displayName: 'Store', siteUrl: null, state: 'DRAFT', grantedScopes: [], createdAt: new Date() });
    const result = await service.createIntegration('user-a', 'workspace-a', { platform: 'SHOPIFY', displayName: 'Store' });
    expect(result.state).toBe('DRAFT');
    expect(result.setup).toBe('CREDENTIAL_VAULT_REQUIRED');
    expect(db.integrationConnection.create.mock.calls[0][0].data).not.toHaveProperty('accessToken');
    expect(db.integrationConnection.create.mock.calls[0][0].data.secretReference).toBeUndefined();
  });

  it('rejects non-HTTPS integration URLs before persistence', async () => {
    await expect(service.createIntegration('user-a', 'workspace-a', { platform: 'CUSTOM_API', displayName: 'API', siteUrl: 'http://example.com' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.integrationConnection.create).not.toHaveBeenCalled();
  });

  it('scopes catalog queries to the active workspace and bounds page size', async () => {
    db.commerceProduct.findMany.mockResolvedValue([]); db.commerceProduct.count.mockResolvedValue(0);
    db.integrationConnection.count.mockResolvedValue(0);
    const result = await service.products('user-a', 'workspace-a', { page: 1, pageSize: 10000, search: 'SKU-1' });
    expect(db.commerceProduct.findMany.mock.calls[0][0].where.organizationId).toBe(organizationId);
    expect(db.commerceProduct.findMany.mock.calls[0][0].take).toBe(100);
    expect(result.availability).toBe('NOT_CONNECTED');
  });

  it('loads a product detail by exact external ID and authorized store connection', async () => {
    const verifiedAt = new Date();
    db.connectorInstance.findMany.mockResolvedValue([{
      id: 'connector-a', connectorId: 'shopify_v1', verifiedCapabilities: ['PRODUCT_CATALOG'], lastVerifiedAt: verifiedAt,
      commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products'], grantedScopesVerifiedAt: verifiedAt },
    }]);
    db.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    db.commerceProduct.findMany.mockResolvedValue([]);
    db.commerceProduct.count.mockResolvedValue(0);
    db.integrationConnection.count.mockResolvedValue(1);

    await service.products('user-a', 'workspace-a', { page: 1, pageSize: 1, externalId: 'gid://shopify/Product/42', integrationId: 'commerce-a' });

    expect(db.commerceProduct.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId,
      connectionId: { in: ['commerce-a'] },
      externalId: 'gid://shopify/Product/42',
      AND: [{ OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] }],
    });
  });

  it('does not report empty store data as zero sales when no integration exists', async () => {
    db.integrationConnection.count.mockResolvedValue(0);
    const result = await service.sales('user-a', 'workspace-a');
    expect(result.availability).toBe('NOT_CONNECTED');
    expect(result.currencyTotals).toEqual([]);
    expect(db.commerceOrder.groupBy).not.toHaveBeenCalled();
  });

  it('filters and scopes inbox records by workspace and refuses foreign conversation reads', async () => {
    db.supportConversation.findMany.mockResolvedValue([]); db.supportConversation.count.mockResolvedValue(0);
    await service.inbox('user-a', 'workspace-a', { page: 1, pageSize: 25, state: 'OPEN' });
    expect(db.supportConversation.findMany.mock.calls[0][0].where).toEqual({ organizationId, state: 'OPEN' });
    db.supportConversation.findFirst.mockResolvedValue(null);
    await expect(service.inboxConversation('user-a', 'workspace-a', 'conversation-other')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SaasService customer inbox safeguards', () => {
  const organizationId = 'tenant-a';
  const conversationId = 'conversation-a';
  let db: any;
  let workspaces: any;
  let service: SaasService;
  let customerTurnProcessor: any;

  beforeEach(() => {
    const tx: any = {
      supportConversation: { upsert: jest.fn().mockResolvedValue({ id: conversationId, channel: 'INTERNAL' }), update: jest.fn().mockResolvedValue({ id: conversationId, state: 'RESOLVED' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue({ id: conversationId, state: 'RESOLVED' }) },
      supportMessage: { createMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'note-a', ...data, createdAt: new Date() })) },
      auditEvent: { create: jest.fn() },
    };
    db = {
      supportConversation: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue({ id: conversationId, state: 'OPEN' }) },
      supportMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      supportConversationReadState: { upsert: jest.fn().mockResolvedValue({ isRead: true }) },
      chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-a' }) },
      playgroundConversation: { findMany: jest.fn() },
      organizationMembership: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
      tx,
    };
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId, role: 'OWNER' }) };
    customerTurnProcessor = { processTrustedCustomerTurn: jest.fn().mockResolvedValue({ conversationId, messageId: 'ai-message', reply: 'AI response', replay: false }) };
    service = new SaasService(db, workspaces, customerTurnProcessor);
  });

  it('keeps every inbox query scoped to the resolved workspace and limits support access to managers', async () => {
    await service.inbox('user-a', 'tenant-a', { page: 1, pageSize: 25 });
    expect(db.supportConversation.findMany.mock.calls[0][0].where.organizationId).toBe(organizationId);
    expect(workspaces.requireAccess).toHaveBeenCalledWith('user-a', 'tenant-a');
    workspaces.requireAccess.mockResolvedValue({ organizationId, role: 'MEMBER' });
    await service.inbox('member-a', 'tenant-a', { page: 1, pageSize: 25 });
    expect(db.supportConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId, assignedToUserId: 'member-a' }, skip: 0, take: 25 }));
  });

  it('keeps Playground records outside the support inbox tables', async () => {
    await service.inbox('user-a', 'tenant-a', { page: 1, pageSize: 25 });
    expect(db.playgroundConversation.findMany).not.toHaveBeenCalled();
  });

  it('hashes visitor identity, validates the owning active assistant, and idempotently inserts customer messages', async () => {
    const token = service.createVisitorSessionId();
    const result = await service.recordCustomerMessage({ organizationId, assistantId: 'assistant-a', visitorSessionId: token, channel: 'INTERNAL', idempotencyKey: 'message-key-0001', content: '<script>alert(1)</script>' });
    expect(token).toHaveLength(43);
    expect(db.tx.supportConversation.upsert.mock.calls[0][0].where.organizationId_assistantId_externalSessionHash.externalSessionHash).not.toBe(token);
    expect(db.tx.supportMessage.createMany.mock.calls[0][0].data[0]).toMatchObject({ kind: 'CUSTOMER', content: '<script>alert(1)</script>', idempotencyKey: 'message-key-0001' });
    expect(result).toMatchObject({ conversationId, inserted: true, reply: 'AI response' });
    expect(customerTurnProcessor.processTrustedCustomerTurn).toHaveBeenCalledWith(expect.objectContaining({ organizationId, assistantId: 'assistant-a', conversationId, content: '<script>alert(1)</script>' }));
  });

  it('retries a serialization conflict so concurrent intake can settle safely', async () => {
    let attempt = 0;
    db.$transaction.mockImplementation(async (callback: (value: any) => unknown) => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('serialization conflict'), { code: 'P2034' });
      return callback(db.tx);
    });
    const result = await service.recordAssistantMessage({ organizationId, assistantId: 'assistant-a', visitorSessionId: service.createVisitorSessionId(), channel: 'INTERNAL', idempotencyKey: 'message-key-0002', content: 'Stored response', provider: 'provider-x' });
    expect(attempt).toBe(2);
    expect(db.tx.supportMessage.createMany.mock.calls[0][0].data[0]).toMatchObject({ kind: 'AI', provider: 'provider-x' });
    expect(result.inserted).toBe(true);
  });

  it('rejects invalid metadata-like untrusted message payloads before database writes', async () => {
    await expect(service.recordCustomerMessage({ organizationId, assistantId: 'assistant-a', visitorSessionId: 'short', channel: 'INTERNAL', idempotencyKey: 'message-key-0003', content: 'Hello' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tx.supportConversation.upsert).not.toHaveBeenCalled();
  });

  it('rejects unbounded or unknown source metadata instead of persisting it', async () => {
    await expect(service.recordAssistantMessage({ organizationId, assistantId: 'assistant-a', visitorSessionId: service.createVisitorSessionId(), channel: 'INTERNAL', idempotencyKey: 'message-key-0004', content: 'Response', sourceRefs: [{ title: 'Source', privateCustomerEmail: 'person@example.com' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tx.supportConversation.upsert).not.toHaveBeenCalled();
  });

  it('does not increment conversation summaries when an idempotent message is already stored', async () => {
    db.tx.supportMessage.createMany.mockResolvedValue({ count: 0 });
    const visitorSessionId = service.createVisitorSessionId();
    const result = await service.recordCustomerMessage({ organizationId, assistantId: 'assistant-a', visitorSessionId, channel: 'INTERNAL', idempotencyKey: 'message-key-0005', content: 'Duplicate delivery' });
    expect(result.inserted).toBe(false);
    expect(db.tx.supportConversation.update).not.toHaveBeenCalled();
    expect(customerTurnProcessor.processTrustedCustomerTurn).toHaveBeenCalled();
  });

  it('refuses foreign conversation detail and persists a per-member read cursor for authorized views', async () => {
    db.supportConversation.findFirst.mockResolvedValueOnce(null);
    await expect(service.inboxConversation('user-a', 'tenant-a', 'foreign-id')).rejects.toBeInstanceOf(NotFoundException);
    db.supportConversation.findFirst.mockResolvedValueOnce({ id: conversationId, assistantId: 'assistant-a', externalSessionHash: 'a'.repeat(64), channel: 'INTERNAL', state: 'OPEN', createdAt: new Date(), assistant: { id: 'assistant-a', name: 'Assistant' } });
    await service.inboxConversation('user-a', 'tenant-a', conversationId);
    expect(db.supportConversationReadState.upsert.mock.calls[0][0].where.conversationId_userId).toEqual({ conversationId, userId: 'user-a' });
    expect(db.supportMessage.findMany.mock.calls[0][0]).toMatchObject({ where: { conversationId, organizationId }, take: 50 });
  });

  it('audits authorized status changes and leaves assignment unsupported in this phase', async () => {
    const result = await service.updateInboxConversation('user-a', 'tenant-a', conversationId, { state: 'RESOLVED' });
    expect(result.state).toBe('RESOLVED');
    expect(db.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'support.status_changed', metadata: { previousState: 'OPEN', state: 'RESOLVED' } }) }));
  });
  it('stores an internal note under the authorized conversation without customer delivery or summary changes', async () => {
    const result = await service.addConversationNote('user-a', 'tenant-a', conversationId, '  Manager note  ');
    expect(result).toMatchObject({ id: 'note-a', kind: 'INTERNAL_NOTE', content: 'Manager note' });
    expect(db.tx.supportMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: { organizationId, conversationId, authorUserId: 'user-a', kind: 'INTERNAL_NOTE', content: 'Manager note' } }));
    expect(db.tx.supportConversation.update).not.toHaveBeenCalled();
    expect(customerTurnProcessor.processTrustedCustomerTurn).not.toHaveBeenCalled();
    expect(db.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId, action: 'support.conversation_note_added', metadata: { noteId: 'note-a' } }) }));
  });

  it('rejects foreign conversations, assigned members and empty notes before persistence', async () => {
    db.supportConversation.findFirst.mockResolvedValueOnce(null);
    await expect(service.addConversationNote('user-a', 'tenant-a', 'foreign', 'Note')).rejects.toBeInstanceOf(NotFoundException);
    workspaces.requireAccess.mockResolvedValueOnce({ organizationId, role: 'MEMBER' });
    await expect(service.addConversationNote('member-a', 'tenant-a', conversationId, 'Note')).rejects.toThrow('Only workspace owners');
    expect(db.supportConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: conversationId, organizationId, assignedToUserId: 'member-a' } }));
    await expect(service.addConversationNote('user-a', 'tenant-a', conversationId, ' ')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('selects the stored visitor hash for detail presentation without returning it to the browser', async () => {
    db.supportConversation.findFirst.mockImplementation(async ({ select }: any) => ({ id: conversationId, ...(select.externalSessionHash ? { externalSessionHash: 'abcdef123456' } : {}) }));
    const result = await service.inboxConversation('user-a', 'tenant-a', conversationId);
    expect(result.customerReference).toBe('Visitor abcdef');
    expect(result).not.toHaveProperty('externalSessionHash');
    expect(db.supportMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId, conversationId, kind: { in: ['CUSTOMER', 'AI', 'BUSINESS_TEAM', 'INTERNAL_NOTE'] } }) }));
  });

});
