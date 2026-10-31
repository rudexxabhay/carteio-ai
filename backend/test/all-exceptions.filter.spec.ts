import { BadRequestException, HttpException, ServiceUnavailableException, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { RequestWithId } from '../src/common/middleware/request-id.middleware';
import type { Response } from 'express';

function makeHost() {
  const request = { requestId: 'trace-test', method: 'POST', route: { path: '/items' } } as RequestWithId;
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() } as unknown as Response;
  const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as ArgumentsHost;
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  it('returns field-specific validation details without exposing submitted values or arbitrary detail text', () => {
    const { host, response } = makeHost();
    new AllExceptionsFilter().catch(new BadRequestException({ message: ['name must be a string', 'property private-token-value should not exist'], error: 'Bad Request', statusCode: 400 }), host);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'VALIDATION_ERROR', message: 'Invalid request data', details: ['name is invalid.'], requestId: 'trace-test', path: '/items',
    }));
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain('private-token-value');
    const unsafe = makeHost();
    new AllExceptionsFilter().catch(new BadRequestException({ message: ['submitted credential private-token-value was rejected'] }), unsafe.host);
    expect(unsafe.response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'Invalid request data' }));
    expect(JSON.stringify((unsafe.response.json as jest.Mock).mock.calls)).not.toContain('private-token-value');
  });

  it('keeps rejected session identifiers generic while preserving the recovery code', () => {
    const { host, response } = makeHost();
    new AllExceptionsFilter().catch(new HttpException({ code: 'PLAYGROUND_SESSION_NOT_FOUND', message: 'foreign session 11111111-1111-4111-8111-111111111111 belongs to user@example.test' }, 404), host);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PLAYGROUND_SESSION_NOT_FOUND', message: 'Conversation not found.' }));
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain('11111111');
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain('user@example.test');
  });

  it('hides unknown exception details from the response', () => {
    const { host, response } = makeHost();
    const log = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    new AllExceptionsFilter().catch(new Error('private infrastructure detail'), host);
    const [payload] = (response.json as jest.Mock).mock.calls[0] as [Record<string, unknown>];
    expect(response.status).toHaveBeenCalledWith(500);
    expect(payload).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', requestId: 'trace-test' });
    expect(JSON.stringify(payload)).not.toContain('private infrastructure detail');
    expect(JSON.stringify(payload)).not.toContain('stack');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private infrastructure detail');
    log.mockRestore();
  });

  it('preserves structured auth service codes and safe messages with the request id', () => {
    const { host, response } = makeHost();
    new AllExceptionsFilter().catch(new ServiceUnavailableException({ code: 'AUTH_SERVICE_UNAVAILABLE', message: 'secret-provider-payload-token' }), host);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Service is temporarily unavailable', requestId: 'trace-test' }));
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain('secret-provider-payload-token');
  });

  it('returns only a bounded Retry-After header for rate-limit responses', () => {
    const { host, response } = makeHost();
    new AllExceptionsFilter().catch(new HttpException({ code: 'PLAYGROUND_RATE_LIMITED', message: 'Too many Playground messages.', retryAfterSeconds: 120 }, 429), host);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PLAYGROUND_RATE_LIMITED', message: 'Too many requests' }));
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain('retryAfterSeconds');
  });

  it('preserves the provider Retry-After value within its wider provider-specific bound', () => {
    const { host, response } = makeHost();
    new AllExceptionsFilter().catch(new HttpException({ code: 'PLAYGROUND_PROVIDER_RATE_LIMITED', message: 'Retry after 120 seconds.', retryAfterSeconds: 120 }, 429), host);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '120');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PLAYGROUND_PROVIDER_RATE_LIMITED', message: 'Retry after 120 seconds.' }));
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain('retryAfterSeconds');
  });

  it('exposes flow execution diagnostics only on the authenticated Builder run route', () => {
    const diagnostics = { traceId: 'trace-flow', runId: 'run-flow', failedStep: { nodeId: 'assistant', reasonCode: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE' } };
    const request = { requestId: 'trace-flow', method: 'POST', route: { path: '/api/v1/workspaces/:slug/flows/:flowId/run' }, authSession: { userId: 'manager' } } as RequestWithId;
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() } as unknown as Response;
    const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as ArgumentsHost;
    new AllExceptionsFilter().catch(new HttpException({ code: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE', message: 'Flow execution failed.', flowDiagnostics: diagnostics }, 502), host);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ diagnostics }));

    const anonymous = makeHost();
    (anonymous.host.switchToHttp().getRequest() as any).route = { path: '/api/v1/workspaces/:slug/flows/:flowId/run' };
    new AllExceptionsFilter().catch(new HttpException({ code: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE', message: 'Flow execution failed.', flowDiagnostics: diagnostics }, 502), anonymous.host);
    expect((anonymous.response.json as jest.Mock).mock.calls[0]?.[0]).not.toHaveProperty('diagnostics');
  });
});
