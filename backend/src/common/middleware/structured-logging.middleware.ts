import type { NextFunction, Response } from 'express';
import type { RequestWithId } from './request-id.middleware';
const LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
type LogLevel = typeof LEVELS[number];
function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL;
  return LEVELS.includes(value as LogLevel) ? value as LogLevel : 'log';
}
export function structuredLoggingMiddleware(req:RequestWithId,res:Response,next:NextFunction) {
  const started=performance.now();
  res.once('finish',()=>{
    if (process.env.WIDGET_DEBUG_ENABLED === 'true' && (process.env.NODE_ENV ?? 'development') !== 'production' && req.path.startsWith('/api/v1/widgets/')) {
      const responseOrigin=res.getHeader('Access-Control-Allow-Origin');
      const requestOrigin=req.header('origin');
      const corsHeaderMatches=typeof responseOrigin==='string'&&typeof requestOrigin==='string'&&responseOrigin===requestOrigin;
      const operation=req.path==='/api/v1/widgets/bootstrap'?'widget.session.bootstrap':req.path==='/api/v1/widgets/session/history'?'widget.session.history':req.path==='/api/v1/widgets/session/messages'?'widget.ai.message':'widget.session.public_api';
      const base={event:'widget_debug',operation,requestId:req.requestId??'unknown',durationMs:Math.round(performance.now()-started),httpStatus:res.statusCode,corsAllowOriginPresent:typeof responseOrigin==='string',corsAllowOriginMatchesRequest:corsHeaderMatches,status:res.statusCode>=200&&res.statusCode<300&&corsHeaderMatches?'success':'failure',failureCategory:!corsHeaderMatches?'cors_header_missing':res.statusCode>=500?'server_http':res.statusCode>=400?'client_http':res.statusCode>=300?'redirect_response':undefined};
      process.stdout.write(`${JSON.stringify({...base,stage:'W03_browser_request_reached_api'})}\n`);
      if(req.path==='/api/v1/widgets/bootstrap')process.stdout.write(`${JSON.stringify({...base,stage:'W09_bootstrap_response_completed'})}\n`);
      if(req.path==='/api/v1/widgets/session/messages'){
        process.stdout.write(`${JSON.stringify({...base,stage:'W10_message_request_received'})}\n`);
        process.stdout.write(`${JSON.stringify({...base,stage:'W14_message_response_delivered'})}\n`);
      }
    }
    const level: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
    if (LEVELS.indexOf(level) > LEVELS.indexOf(configuredLevel())) return;
    const event={timestamp:new Date().toISOString(),level,event:'http_request',requestId:req.requestId??'unknown',method:HTTP_METHODS.has(req.method) ? req.method : 'OTHER',route:req.route?.path??'unmatched',statusCode:res.statusCode,durationMs:Math.round(performance.now()-started)};
    process.stdout.write(`${JSON.stringify(event)}\n`);
  });
  next();
}
