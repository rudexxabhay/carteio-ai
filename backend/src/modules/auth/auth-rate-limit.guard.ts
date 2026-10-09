import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
const events = new Map<string, number[]>();
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request & { body?: Record<string, unknown> }>();
    const route = req.route?.path ?? req.path;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().normalize('NFKC').toLowerCase() : 'unknown';
    const limit = route.includes('otp/request') ? 4 : route.includes('otp/verify') ? 10 : route.includes('google') ? 8 : route.includes('login') ? 8 : route.includes('forgot') || route.includes('resend') ? 4 : 10;
    const windowMs = 15 * 60_000;
    const now = Date.now(); const keys = [`ip:${req.ip}:${route}`, `account:${email}:${route}`];
    for (const key of keys) {
      const valid = (events.get(key) ?? []).filter(time => time > now - windowMs);
      if (valid.length >= limit) { events.set(key, valid); throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS); }
      valid.push(now); events.set(key, valid);
    }
    if (events.size > 10_000) for (const [key, values] of events) if (!values.some(time => time > now - windowMs)) events.delete(key);
    return true;
  }
}
