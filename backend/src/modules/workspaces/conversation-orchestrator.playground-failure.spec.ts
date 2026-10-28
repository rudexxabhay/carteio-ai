import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConversationOrchestrator } from './conversation-orchestrator.service';

describe('ConversationOrchestrator Playground failures', () => {
  const env = { node: process.env.NODE_ENV, diagnostics: process.env.PLAYGROUND_DIAGNOSTICS_ENABLED };

  afterEach(() => {
    if (env.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env.node;
    if (env.diagnostics === undefined) delete process.env.PLAYGROUND_DIAGNOSTICS_ENABLED;
    else process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = env.diagnostics;
  });

  it('classifies the live-record response safety rejection instead of reporting INTERNAL_ERROR', () => {
    const orchestrator = new ConversationOrchestrator({} as any, {} as any);
    const failure = new ServiceUnavailableException({ code: 'PLAYGROUND_LIVE_RECORD_LIMITATION_INVALID' });
    expect((orchestrator as any).safeErrorCategory(failure)).toBe('PROVIDER_INVALID_RESPONSE');
  });

  it('records a session-release failure without turning a completed turn into a request failure', async () => {
    const orchestrator = new ConversationOrchestrator({} as any, {} as any);
    const cleanupError = Object.assign(new Error('private database detail'), { code: 'P2022' });
    const stageLog = jest.spyOn((orchestrator as any).logger, 'debug').mockImplementation(() => undefined);
    const errorLog = jest.spyOn((orchestrator as any).logger, 'error').mockImplementation(() => undefined);

    await expect((orchestrator as any).releaseSessionSafely({ requestId: 'trace-cleanup', organizationId: 'org-1', assistantId: 'assistant-1', channel: 'PLAYGROUND' }, async () => { throw cleanupError; })).resolves.toBeUndefined();

    expect(stageLog).toHaveBeenCalledWith(expect.stringContaining('"stage":"SESSION_RELEASE","outcome":"FAILED"'));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"failureOperation":"SESSION_RELEASE"'));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private database detail');
  });

  it('returns a safe failed trace when an unexpected post-generation error escapes execution', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true';
    const db: any = {
      chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-1', organizationId: 'org-1', status: 'ACTIVE' }) },
      playgroundMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const workspaces: any = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) };
    const orchestrator = new ConversationOrchestrator(db, workspaces);
    jest.spyOn(orchestrator as any, 'enforcePlaygroundRate').mockResolvedValue(undefined);
    jest.spyOn(orchestrator as any, 'acquireConversation').mockResolvedValue({ id: 'session-1', turns: [] });
    const originalError = Object.assign(new Error('private provider/database detail'), { code: 'P2022' });
    const serverErrorLog = jest.spyOn((orchestrator as any).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(orchestrator, 'executeSharedAI').mockRejectedValue(originalError);

    let caught: unknown;
    try {
      await orchestrator.playgroundChat('user-1', 'workspace', 'assistant-1', { message: 'question', clientTurnId: 'turn-1' }, 'trace-1');
    } catch (error) { caught = error; }

    expect(caught).toBeInstanceOf(HttpException);
    const response = (caught as HttpException).getResponse() as Record<string, any>;
    expect(response.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response)).not.toContain('private provider/database detail');
    expect(response.diagnostics).toMatchObject({ traceId: 'trace-1', finalAnswer: { answerOrigin: 'FAILED', deliveryStatus: 'INTERNAL_EXECUTION_FAILURE' } });
    expect(response.diagnostics.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'FINAL_RESPONSE', outcome: 'FAILED', errorCategory: 'INTERNAL_ERROR' }),
    ]));
    expect((caught as Error & { cause?: unknown }).cause).toBe(originalError);
    expect(serverErrorLog).toHaveBeenCalledWith(expect.stringContaining('"event":"playground_execution_exception"'));
    const logRecord = JSON.parse(serverErrorLog.mock.calls[0]![0] as string);
    expect(logRecord).toMatchObject({ traceId: 'trace-1', requestId: 'trace-1', failureOperation: 'FINAL_RESPONSE', exceptionType: 'Error', errorCodes: ['P2022'] });
    expect(logRecord.stackTrace).toContain('conversation-orchestrator.playground-failure.spec.ts');
    expect(JSON.stringify(logRecord)).not.toContain('private provider/database detail');
  });
});
