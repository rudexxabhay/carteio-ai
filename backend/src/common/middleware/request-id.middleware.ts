import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
export interface RequestWithId extends Request { requestId?: string; }
export function requestIdMiddleware(req: RequestWithId,res:Response,next:NextFunction) { const supplied=req.header('x-request-id'); const requestId=supplied && /^[A-Za-z0-9._-]{1,100}$/.test(supplied) ? supplied : randomUUID(); req.requestId=requestId;res.setHeader('X-Request-ID',requestId);next(); }
