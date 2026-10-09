import type { NextFunction, Response } from 'express';
import type { RequestWithId } from './request-id.middleware';
const LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
type LogLevel = typeof LEVELS[number];
function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL;
  return LEVELS.includes(value as LogLevel) ? value as LogLevel : 'log';
}
export function structuredLoggingMiddleware(req:RequestWithId,res:Response,next:NextFunction) {
  const started=performance.now();
  res.once('finish',()=>{
    const level: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
    if (LEVELS.indexOf(level) > LEVELS.indexOf(configuredLevel())) return;
    const event={timestamp:new Date().toISOString(),level,event:'http_request',requestId:req.requestId??'unknown',method:req.method,route:req.route?.path??'unmatched',statusCode:res.statusCode,durationMs:Math.round(performance.now()-started)};
    process.stdout.write(`${JSON.stringify(event)}\n`);
  });
  next();
}
