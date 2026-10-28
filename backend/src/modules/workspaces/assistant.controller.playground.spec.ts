import { HttpException, NotFoundException } from '@nestjs/common';
import { AssistantController } from './assistant.controller';

describe('AssistantController live Playground trace', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.APP_ENV;
  const originalDiagnostics = process.env.PLAYGROUND_DIAGNOSTICS_ENABLED;

  afterEach(() => {
    for (const [key, value] of [['NODE_ENV', originalNodeEnv], ['APP_ENV', originalAppEnv], ['PLAYGROUND_DIAGNOSTICS_ENABLED', originalDiagnostics]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('sends readiness before correlated execution events and reconciles with the completed trace', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true';
    const traceEvent = { traceId: 'trace-1', sequence: 1, operation: 'MESSAGE_RECEIVED', status: 'completed', outcome: 'COMPLETED', at: new Date().toISOString(), requestId: 'trace-1', organizationId: 'org-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'MESSAGE_RECEIVED', durationMs: 0 };
    const assistants = { playgroundChat: jest.fn(async (...args: any[]) => {
      args[6]();
      args[7](traceEvent);
      return { reply: 'Grounded response', sessionId: 'session-1', diagnostics: { traceId: 'trace-1', events: [traceEvent] } };
    }) };
    const controller = new AssistantController(assistants as any);
    const writes: string[] = [];
    const response: any = {
      writableEnded: false, destroyed: false,
      status: jest.fn(function(this: any) { return this; }),
      set: jest.fn(function(this: any) { return this; }),
      flushHeaders: jest.fn(),
      write: jest.fn((value: string) => { writes.push(value); return true; }),
      once: jest.fn(), removeListener: jest.fn(),
      end: jest.fn(function(this: any) { this.writableEnded = true; }),
    };
    const request: any = { requestId: 'trace-1', authSession: { userId: 'user-1' }, once: jest.fn(), removeListener: jest.fn() };

    await controller.playgroundChatStream(request, response, 'workspace', 'assistant-1', { message: 'Hello', clientTurnId: 'turn-1' } as any);

    expect(writes.map(frame => frame.match(/^event: ([^\n]+)/m)?.[1])).toEqual(['ready', 'trace', 'response', 'terminal']);
    expect(writes[1]).toContain('id: 1');
    expect(writes[3]).toContain('"lastSequence":1');
    expect(assistants.playgroundChat).toHaveBeenCalledWith('user-1', 'workspace', 'assistant-1', expect.anything(), 'trace-1', expect.any(AbortSignal), expect.any(Function), expect.any(Function));
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('rejects the live endpoint before starting an AI turn when diagnostics are disabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'production';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'false';
    const assistants = { playgroundChat: jest.fn() };
    const controller = new AssistantController(assistants as any);
    await expect(controller.playgroundChatStream({ authSession: { userId: 'user-1' } } as any, {} as any, 'workspace', 'assistant-1', { message: 'Hello' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(assistants.playgroundChat).not.toHaveBeenCalled();
  });

  it('reports provider rate limiting as an SSE failure with a failed terminal event after HTTP 200 headers', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true';
    const assistants = { playgroundChat: jest.fn().mockRejectedValue(new HttpException({ code: 'PLAYGROUND_PROVIDER_RATE_LIMITED', retryAfterSeconds: 17 }, 429)) };
    const controller = new AssistantController(assistants as any);
    const writes: string[] = [];
    const response: any = {
      writableEnded: false, destroyed: false, statusCode: undefined,
      status: jest.fn(function(this: any, code: number) { this.statusCode = code; return this; }),
      set: jest.fn(function(this: any) { return this; }), flushHeaders: jest.fn(),
      write: jest.fn((value: string) => { writes.push(value); return true; }),
      once: jest.fn(), removeListener: jest.fn(),
      end: jest.fn(function(this: any) { this.writableEnded = true; }),
    };
    const request: any = { requestId: 'trace-rate-limit', authSession: { userId: 'user-1' }, once: jest.fn(), removeListener: jest.fn() };
    await controller.playgroundChatStream(request, response, 'workspace', 'assistant-1', { message: 'Hello' } as any);
    expect(response.statusCode).toBe(200);
    expect(writes.map(frame => frame.match(/^event: ([^\n]+)/m)?.[1])).toEqual(['failure', 'terminal']);
    expect(writes[0]).toContain('PLAYGROUND_PROVIDER_RATE_LIMITED');
    expect(writes[0]).toContain('"retryAfterSeconds":17');
    expect(writes[0]).toContain('Retry after 17 seconds');
    expect(writes[1]).toContain('"status":"FAILED"');
  });

  it('streams the authorized failure trace with the same request trace ID', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true';
    const diagnostics = { traceId: 'trace-internal', events: [{ sequence: 4, stage: 'FINAL_RESPONSE', outcome: 'FAILED', errorCategory: 'INTERNAL_ERROR' }] };
    const assistants = { playgroundChat: jest.fn().mockRejectedValue(new HttpException({ code: 'INTERNAL_ERROR', message: 'The Playground request could not be completed.', diagnostics }, 500)) };
    const controller = new AssistantController(assistants as any);
    const writes: string[] = [];
    const response: any = {
      writableEnded: false, destroyed: false,
      status: jest.fn(function(this: any) { return this; }),
      set: jest.fn(function(this: any) { return this; }), flushHeaders: jest.fn(),
      write: jest.fn((value: string) => { writes.push(value); return true; }),
      once: jest.fn(), removeListener: jest.fn(),
      end: jest.fn(function(this: any) { this.writableEnded = true; }),
    };
    const request: any = { requestId: 'trace-internal', authSession: { userId: 'user-1' }, once: jest.fn(), removeListener: jest.fn() };

    await controller.playgroundChatStream(request, response, 'workspace', 'assistant-1', { message: 'Question', clientTurnId: 'turn-1' } as any);

    expect(writes[0]).toContain('event: failure');
    expect(writes[0]).toContain('"traceId":"trace-internal"');
    expect(writes[0]).toContain('"stage":"FINAL_RESPONSE"');
    expect(writes[1]).toContain('event: terminal');
    expect(writes[1]).toContain('"traceId":"trace-internal"');
    expect(writes[1]).toContain('"status":"FAILED"');
  });
});
