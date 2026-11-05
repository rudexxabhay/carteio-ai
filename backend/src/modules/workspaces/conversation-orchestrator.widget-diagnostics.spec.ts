import { ConversationOrchestrator } from './conversation-orchestrator.service';
import { PlaygroundTraceRecorder } from './playground-diagnostics';

describe('Widget durable diagnostics', () => {
  const context = {
    requestId: '550e8400-e29b-41d4-a716-446655440001', organizationId: 'org-1', assistantId: 'assistant-1',
    userId: 'user-1', channel: 'PUBLIC_WIDGET', clientTurnId: 'widget-idempotency-01', message: 'private message', requestDeadline: 1,
  } as any;
  const session = { organizationId: 'org-1', assistantId: 'assistant-1', conversationId: '550e8400-e29b-41d4-a716-446655440002', userId: 'user-1' };

  it('persists a bounded channel-tagged trace against the securely associated support conversation', async () => {
    const db: any = { playgroundDiagnosticTrace: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}) } };
    const orchestrator = new ConversationOrchestrator(db, {} as any);
    const recorder = new PlaygroundTraceRecorder(context.requestId, undefined, false, 'PUBLIC_WIDGET');
    recorder.milestone('INTENT_INTERPRETATION', { organizationId: 'org-1', assistantId: 'assistant-1' });
    const trace = recorder.snapshot({ conversationId: session.conversationId });

    await (orchestrator as any).persistWidgetDiagnosticTrace(session, context, trace, 'COMPLETED', '550e8400-e29b-41d4-a716-446655440003');

    expect(db.playgroundDiagnosticTrace.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ supportConversationId: session.conversationId }) }));
    expect(db.playgroundDiagnosticTrace.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-1', assistantId: 'assistant-1', supportConversationId: session.conversationId, userId: 'user-1', requestId: context.requestId, channel: 'PUBLIC_WIDGET', outcome: 'COMPLETED' }) }));
    expect(JSON.stringify(db.playgroundDiagnosticTrace.create.mock.calls)).not.toContain('private message');
  });

  it('does not replace the original turn failure when diagnostic persistence fails', async () => {
    const db: any = { playgroundDiagnosticTrace: { count: jest.fn().mockRejectedValue(new Error('database private detail')) } };
    const orchestrator = new ConversationOrchestrator(db, {} as any);
    jest.spyOn((orchestrator as any).logger, 'warn').mockImplementation(() => undefined);
    const trace = new PlaygroundTraceRecorder(context.requestId, undefined, false, 'PUBLIC_WIDGET').snapshot({});
    await expect((orchestrator as any).persistWidgetDiagnosticTrace(session, context, trace, 'FAILED')).resolves.toBeUndefined();
  });

  it('allocates a distinct attempt after a concurrent unique-key collision', async () => {
    const db: any = { playgroundDiagnosticTrace: {
      count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
      create: jest.fn().mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({}),
    } };
    const orchestrator = new ConversationOrchestrator(db, {} as any);
    const trace = new PlaygroundTraceRecorder(context.requestId, undefined, false, 'PUBLIC_WIDGET').snapshot({});

    await (orchestrator as any).persistWidgetDiagnosticTrace(session, context, trace, 'FAILED');

    expect(db.playgroundDiagnosticTrace.create).toHaveBeenCalledTimes(2);
    expect(db.playgroundDiagnosticTrace.create.mock.calls[0][0].data.attempt).toBe(1);
    expect(db.playgroundDiagnosticTrace.create.mock.calls[1][0].data.attempt).toBe(2);
  });

  it('enforces workspace owner/admin scope and tenant, assistant, channel, and expiry filters for history', async () => {
    const db: any = {
      supportConversation: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({ id: session.conversationId }) },
      playgroundDiagnosticTrace: { findMany: jest.fn().mockResolvedValue([]) },
      supportMessage: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const workspaces: any = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'ADMIN' }) };
    const orchestrator = new ConversationOrchestrator(db, workspaces);
    await orchestrator.widgetDiagnosticSessions('admin-1', 'workspace', 'assistant-1', 0, 20);
    await orchestrator.widgetDiagnosticTraces('admin-1', 'workspace', 'assistant-1', session.conversationId, 0, 40);
    expect(workspaces.requireAccess).toHaveBeenCalledWith('admin-1', 'workspace', ['OWNER', 'ADMIN']);
    expect(db.supportConversation.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1', assistantId: 'assistant-1', channel: 'WEB_WIDGET' });
    expect(db.playgroundDiagnosticTrace.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1', assistantId: 'assistant-1', supportConversationId: session.conversationId, channel: 'PUBLIC_WIDGET', expiresAt: { gt: expect.any(Date) } });
  });

  it('denies trace retrieval when the selected conversation is outside the authorized tenant', async () => {
    const db: any = {
      supportConversation: { findFirst: jest.fn().mockResolvedValue(null) },
      playgroundDiagnosticTrace: { findMany: jest.fn() },
      supportMessage: { findMany: jest.fn() },
    };
    const workspaces: any = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'other-org', role: 'OWNER' }) };
    const orchestrator = new ConversationOrchestrator(db, workspaces);

    await expect(orchestrator.widgetDiagnosticTraces('owner-1', 'workspace', 'assistant-1', session.conversationId, 0, 40)).rejects.toBeDefined();
    expect(db.playgroundDiagnosticTrace.findMany).not.toHaveBeenCalled();
  });

  it('persists Widget capture consent only through manager-scoped conversation ownership', async () => {
    const prior = { node: process.env.NODE_ENV, app: process.env.APP_ENV, enabled: process.env.PLAYGROUND_DIAGNOSTICS_ENABLED };
    process.env.NODE_ENV = 'production'; process.env.APP_ENV = 'uat'; process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true';
    const db: any = { supportConversation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-1' }) } };
    const workspaces: any = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'ADMIN' }) };
    const orchestrator = new ConversationOrchestrator(db, workspaces);
    try {
      await expect(orchestrator.setWidgetDiagnosticCapture('admin-1', 'workspace', 'assistant-1', session.conversationId, true)).resolves.toEqual({ conversationId: session.conversationId, enabled: true });
      expect(db.supportConversation.updateMany).toHaveBeenCalledWith({ where: { id: session.conversationId, organizationId: 'org-1', assistantId: 'assistant-1', channel: 'WEB_WIDGET' }, data: { diagnosticCaptureEnabled: true } });
      expect(workspaces.requireAccess).toHaveBeenCalledWith('admin-1', 'workspace', ['OWNER', 'ADMIN']);
    } finally {
      for (const [key, value] of [['NODE_ENV', prior.node], ['APP_ENV', prior.app], ['PLAYGROUND_DIAGNOSTICS_ENABLED', prior.enabled]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});
