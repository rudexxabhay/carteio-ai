import type { NextFunction, Request, Response } from 'express';

export function csrfOriginMiddleware(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin'); const referer = req.get('referer');
    let refererOrigin: string | undefined;
    try { if (referer) refererOrigin = new URL(referer).origin; } catch { /* Rejected below. */ }
    if (!origin || !allowed.has(origin) || (referer && refererOrigin !== origin)) return res.status(403).json({ statusCode: 403, code: 'CSRF_REJECTED', message: 'Request origin is not allowed' });
    return next();
  };
}
