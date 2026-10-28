import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
export interface RequestWithId extends Request { requestId?: string; }
export function requestIdMiddleware(req: RequestWithId,res:Response,next:NextFunction) { const supplied=req.header('x-request-id'); const requestId=supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : randomUUID(); req.requestId=requestId;res.setHeader('X-Request-ID',requestId);next(); }
