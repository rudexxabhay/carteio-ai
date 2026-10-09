import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorResponse } from '@carteio/shared-types';
import type { RequestWithId } from './request-id.middleware';

export function bodyParserErrorMiddleware(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const isTooLarge = typeof error === 'object' && error !== null && 'status' in error && error.status === 413;
  const statusCode = isTooLarge ? 413 : 400;
  const payload: ApiErrorResponse = {
    statusCode,
    code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
    message: isTooLarge ? 'Request body is too large' : 'Request body could not be parsed',
    requestId: (req as RequestWithId).requestId ?? 'unknown',
    timestamp: new Date().toISOString(),
    path: '/unmatched',
  };
  res.status(statusCode).json(payload);
}
