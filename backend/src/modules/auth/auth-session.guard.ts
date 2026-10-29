import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { AuthService, sessionCookieName } from './auth.service';
export type AuthenticatedSessionContext = Readonly<Awaited<ReturnType<AuthService['current']>> & { userId: string }>;
export type AuthenticatedRequest = Request & { authSession: AuthenticatedSessionContext; requestId?: string };
type RequestWithAuthSession = Request & { authSession?: AuthenticatedSessionContext };
export function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  const part = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!part) return undefined;
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return undefined; }
}
@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithAuthSession & RequestWithId>();
    const verifiedSession = await this.auth.current(getCookie(request, sessionCookieName()), request.requestId);
    request.authSession = Object.freeze({ ...verifiedSession, userId: verifiedSession.user.id });
    return true;
  }
}
