import type { NextFunction, Response } from 'express';
import { requestIdMiddleware, type RequestWithId } from '../src/common/middleware/request-id.middleware';

describe('requestIdMiddleware', () => {
  it('accepts UUID request IDs and replaces arbitrary token-like values before logging', () => {
    const validId = '11111111-1111-4111-8111-111111111111';
    const tokenLikeValue = `gsk_${'x'.repeat(60)}`;
    const req = { header: jest.fn().mockReturnValueOnce(validId).mockReturnValueOnce(tokenLikeValue) } as unknown as RequestWithId;
    const res = { setHeader: jest.fn() } as unknown as Response;
    const next = jest.fn() as NextFunction;

    requestIdMiddleware(req, res, next);
    expect(req.requestId).toBe(validId);
    expect(res.setHeader).toHaveBeenLastCalledWith('X-Request-ID', validId);
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(req.requestId).not.toBe(tokenLikeValue);
  });
});
