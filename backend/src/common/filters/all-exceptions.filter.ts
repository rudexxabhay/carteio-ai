import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorResponse } from '@carteio/shared-types';
import type { RequestWithId } from '../middleware/request-id.middleware';
import { playgroundDiagnosticsEnabled } from '../../modules/workspaces/playground-diagnostics';

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

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
    const rawCode = typeof exceptionResponse === 'object' && exceptionResponse !== null && 'code' in exceptionResponse && typeof exceptionResponse.code === 'string' ? exceptionResponse.code : undefined;
    const suppliedCode = rawCode && /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : undefined;
    const retryAfterMaximum = suppliedCode === 'PLAYGROUND_PROVIDER_RATE_LIMITED' ? 3600 : 60;
    const retryAfterSeconds = statusCode === HttpStatus.TOO_MANY_REQUESTS && typeof exceptionResponse === 'object' && exceptionResponse !== null && 'retryAfterSeconds' in exceptionResponse && typeof exceptionResponse.retryAfterSeconds === 'number' && Number.isInteger(exceptionResponse.retryAfterSeconds)
      ? Math.max(1, Math.min(retryAfterMaximum, exceptionResponse.retryAfterSeconds)) : undefined;
    const validationMessages = typeof exceptionResponse === 'object' && exceptionResponse !== null &&
      'message' in exceptionResponse && Array.isArray(exceptionResponse.message) &&
      exceptionResponse.message.every((item: unknown): item is string => typeof item === 'string')
      ? exceptionResponse.message
      : undefined;
    const isValidationFailure = validationMessages !== undefined;
    const badRequestMessage = statusCode === HttpStatus.BAD_REQUEST && typeof exceptionResponse === 'object' && exceptionResponse !== null &&
      'message' in exceptionResponse && typeof exceptionResponse.message === 'string'
      ? exceptionResponse.message.slice(0, 300)
      : undefined;
    const code = suppliedCode ?? (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR'
      : isValidationFailure ? 'VALIDATION_ERROR'
      : statusCode === 404 ? 'NOT_FOUND'
      : statusCode === 401 ? 'UNAUTHORIZED'
      : statusCode === 403 ? 'FORBIDDEN'
      : statusCode === 413 ? 'PAYLOAD_TOO_LARGE'
      : statusCode === 429 ? 'RATE_LIMITED'
      : statusCode >= 400 ? 'INVALID_REQUEST' : 'REQUEST_ERROR');
    const message = statusCode >= 500 && statusCode !== 503 ? 'An unexpected error occurred'
      : isValidationFailure ? 'Invalid request data'
      : badRequestMessage ? badRequestMessage
      : statusCode === 404 && suppliedCode === 'PLAYGROUND_SESSION_NOT_FOUND' ? 'Conversation not found.'
      : statusCode === 404 ? 'Resource not found'
      : statusCode === 401 ? 'Authentication is required'
      : statusCode === 403 ? 'Access is not allowed'
      : statusCode === 413 ? 'Request body is too large'
      : statusCode === 429 && suppliedCode === 'PLAYGROUND_PROVIDER_RATE_LIMITED' && typeof exceptionResponse === 'object' && exceptionResponse !== null && 'message' in exceptionResponse && typeof exceptionResponse.message === 'string' ? exceptionResponse.message.slice(0, 300)
      : statusCode === 429 ? 'Too many requests'
      : statusCode === 503 ? 'Service is temporarily unavailable'
      : statusCode === 409 ? 'The request conflicts with the current resource state.'
      : statusCode >= 400 && statusCode < 500 ? 'The request could not be completed.'
      : 'Request could not be completed';

    if (statusCode >= 500) {
      const authRoute = /^\/api\/v1\/auth\/(google|login|otp\/request|otp\/verify|me)(?:\/|$)/u.exec(typeof request.path === 'string' ? request.path : '');
      if (process.env.VERCEL === '1' && process.env.NODE_ENV === 'production'
        && (process.env.PUBLIC_APP_URL === 'https://uat.ai.carteio.in' || process.env.VERCEL_PROJECT_PRODUCTION_URL === 'carteio-ai-uat-backend.vercel.app')
        && authRoute) {
        const candidate = typeof exception === 'object' && exception !== null ? exception as { name?: unknown; code?: unknown; meta?: unknown } : null;
        const prismaCode = typeof candidate?.code === 'string' && /^P\d{4}$/u.test(candidate.code) ? candidate.code : undefined;
        const meta = candidate?.meta && typeof candidate.meta === 'object' ? candidate.meta as { code?: unknown } : null;
        const pgCode = typeof meta?.code === 'string' && /^[A-Z0-9]{5}$/u.test(meta.code) ? meta.code : undefined;
        const exceptionClass = typeof candidate?.name === 'string' && ['PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientInitializationError', 'PrismaClientValidationError', 'ServiceUnavailableException', 'TypeError', 'Error'].includes(candidate.name) ? candidate.name : 'OTHER';
        const causeCategory = pgCode === '42501' || prismaCode === 'P1010' ? 'DB_PERMISSION'
          : pgCode === '28P01' || prismaCode === 'P1000' ? 'DB_AUTHENTICATION'
          : pgCode === '3D000' ? 'DB_NAME'
          : pgCode === '42P01' || pgCode === '42703' || prismaCode === 'P2021' || prismaCode === 'P2022' ? 'DB_SCHEMA'
          : prismaCode === 'P1001' || prismaCode === 'P1002' || prismaCode === 'P1008' ? 'DB_CONNECTION'
          : exceptionClass.startsWith('Prisma') ? 'DB_OTHER' : 'UNCLASSIFIED';
        process.stderr.write(`${JSON.stringify({ event: 'uat_auth_request_failure', requestId: request.requestId ?? 'unknown', operation: authRoute[1]?.replace('/', '_') ?? 'auth', stage: 'request_or_guard', exceptionClass, causeCategory, ...(prismaCode ? { prismaCode } : {}), ...(pgCode ? { pgCode } : {}) })}\n`);
      }
      process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'request_error',
        requestId: request.requestId ?? 'unknown',
        method: HTTP_METHODS.has(request.method) ? request.method : 'OTHER',
        route: request.route?.path ?? 'unmatched',
        statusCode,
        code,
        message: exception instanceof HttpException ? 'Server request failed' : 'Unhandled request error',
      })}\n`);
    }

    const path = typeof request.route?.path === 'string' ? request.route.path : '/unmatched';
    if (retryAfterSeconds !== undefined) response.setHeader('Retry-After', String(retryAfterSeconds));
    const payload: ApiErrorResponse = {
      statusCode,
      code,
      message,
      requestId: request.requestId ?? 'unknown',
      timestamp: new Date().toISOString(),
      path,
    };
    const diagnosticPath = path.endsWith('/playground/chat') || path.endsWith('/playground/chat/');
    const diagnostics = typeof exceptionResponse === 'object' && exceptionResponse !== null && 'diagnostics' in exceptionResponse
      ? exceptionResponse.diagnostics : undefined;
    const authenticatedRequest = request as RequestWithId & { authSession?: { userId: string } };
    if (diagnosticPath && authenticatedRequest.authSession?.userId && playgroundDiagnosticsEnabled() && diagnostics && typeof diagnostics === 'object') {
      (payload as ApiErrorResponse & { diagnostics?: unknown }).diagnostics = diagnostics;
    }
    const flowExecutionDiagnostics = typeof exceptionResponse === 'object' && exceptionResponse !== null && 'flowDiagnostics' in exceptionResponse
      ? exceptionResponse.flowDiagnostics : undefined;
    const authorizedFlowRunPath = /^\/api\/v\d+\/workspaces\/[^/]+\/flows\/[^/]+\/run\/?$/u.test(path);
    if (authorizedFlowRunPath && authenticatedRequest.authSession?.userId && flowExecutionDiagnostics && typeof flowExecutionDiagnostics === 'object') {
      (payload as ApiErrorResponse & { diagnostics?: unknown }).diagnostics = flowExecutionDiagnostics;
    }
    response.status(statusCode).json(payload);
  }
}
