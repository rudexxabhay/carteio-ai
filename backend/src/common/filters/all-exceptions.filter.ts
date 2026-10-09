import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorResponse } from '@carteio/shared-types';
import type { RequestWithId } from '../middleware/request-id.middleware';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const candidateStatus = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
      ? candidateStatus
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const suppliedCode = typeof exceptionResponse === 'object' && exceptionResponse !== null && 'code' in exceptionResponse && typeof exceptionResponse.code === 'string' ? exceptionResponse.code : undefined;
    const validationMessages = typeof exceptionResponse === 'object' && exceptionResponse !== null &&
      'message' in exceptionResponse && Array.isArray(exceptionResponse.message) &&
      exceptionResponse.message.every((item) => typeof item === 'string')
      ? exceptionResponse.message as string[]
      : undefined;
    const safeMessage = typeof exceptionResponse === 'string' && exceptionResponse.length <= 200 ? exceptionResponse
      : typeof exceptionResponse === 'object' && exceptionResponse !== null &&
      'message' in exceptionResponse && typeof exceptionResponse.message === 'string' && exceptionResponse.message.length <= 200
      ? exceptionResponse.message : undefined;
    const code = suppliedCode ?? (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR'
      : validationMessages ? 'VALIDATION_ERROR'
      : statusCode === 404 ? 'NOT_FOUND'
      : statusCode === 401 ? 'UNAUTHORIZED'
      : statusCode === 403 ? 'FORBIDDEN'
      : statusCode === 413 ? 'PAYLOAD_TOO_LARGE'
      : statusCode === 429 ? 'RATE_LIMITED'
      : statusCode >= 400 ? 'INVALID_REQUEST' : 'REQUEST_ERROR');
    const message = statusCode >= 500 && statusCode !== 503 ? 'An unexpected error occurred'
      : validationMessages ? 'Invalid request data'
      : safeMessage && [400, 401, 403, 409, 422, 503].includes(statusCode) ? safeMessage
      : statusCode === 404 ? 'Resource not found'
      : statusCode === 401 ? 'Authentication is required'
      : statusCode === 403 ? 'Access is not allowed'
      : statusCode === 413 ? 'Request body is too large'
      : statusCode === 429 ? 'Too many requests'
      : 'Request could not be completed';

    if (statusCode >= 500) {
      process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'request_error',
        requestId: request.requestId ?? 'unknown',
        method: request.method,
        route: request.route?.path ?? 'unmatched',
        message: exception instanceof HttpException ? 'Server request failed' : 'Unhandled request error',
      })}\n`);
    }

    const path = typeof request.route?.path === 'string' ? request.route.path : '/unmatched';
    const payload: ApiErrorResponse = {
      statusCode,
      code,
      message,
      requestId: request.requestId ?? 'unknown',
      timestamp: new Date().toISOString(),
      path,
      ...(validationMessages ? { details: validationMessages } : {}),
    };
    response.status(statusCode).json(payload);
  }
}
