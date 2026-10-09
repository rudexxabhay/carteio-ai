import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import type { RequestWithId } from '../src/common/middleware/request-id.middleware';
import type { Response } from 'express';

function makeHost() {
  const request = { requestId: 'trace-test', method: 'POST', route: { path: '/items' } } as RequestWithId;
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as ArgumentsHost;
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  it('returns validation failures with a stable code and safe detail list', () => {
    const { host, response } = makeHost();
    new AllExceptionsFilter().catch(new BadRequestException({ message: ['name must be a string'], error: 'Bad Request', statusCode: 400 }), host);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'VALIDATION_ERROR', message: 'Invalid request data', requestId: 'trace-test', details: ['name must be a string'], path: '/items',
    }));
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
    log.mockRestore();
  });
});
