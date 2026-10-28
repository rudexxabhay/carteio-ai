import { CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, InternalServerErrorException, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuthSessionGuard } from '../auth/auth-session.guard';

type PlatformAdminRequest = Request & { authSession?: { userId: string } };

@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformAdminRequest>();
    const userId = request.authSession?.userId;
    if (!userId) throw new ForbiddenException({ code: 'PLATFORM_OPERATOR_REQUIRED', message: 'Platform operator access is required.' });
    const operator = await this.prisma.$queryRaw<Array<{ userId: string }>>`SELECT "userId" FROM "PlatformOperator" WHERE "userId" = ${userId}::uuid AND "enabled" = true LIMIT 1`;
    if (!operator.length) throw new ForbiddenException({ code: 'PLATFORM_OPERATOR_REQUIRED', message: 'Platform operator access is required.' });
    return true;
  }
}

@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const rows = await this.prisma.$queryRaw<Array<{ users: string; workspaces: string; assistants: string; integrations: string; products: string; orders: string; subscriptions: string; failedSyncJobs: string }>>`
      SELECT
        (SELECT COUNT(*)::text FROM "User") AS users,
        (SELECT COUNT(*)::text FROM "Organization") AS workspaces,
        (SELECT COUNT(*)::text FROM "Chatbot") AS assistants,
        (SELECT COUNT(*)::text FROM "IntegrationConnection") AS integrations,
        (SELECT COUNT(*)::text FROM "CommerceProduct") AS products,
        (SELECT COUNT(*)::text FROM "CommerceOrder") AS orders,
        (SELECT COUNT(*)::text FROM "WorkspaceSubscription" WHERE "state" = 'ACTIVE') AS subscriptions,
        (SELECT COUNT(*)::text FROM "CommerceSyncJob" WHERE "state" = 'FAILED') AS "failedSyncJobs"`;
    const counts = rows[0];
    if (!counts) throw new InternalServerErrorException({ code: 'PLATFORM_METRICS_UNAVAILABLE', message: 'Platform metrics are unavailable.' });
    return { generatedAt: new Date().toISOString(), counts: { users: Number(counts.users), workspaces: Number(counts.workspaces), assistants: Number(counts.assistants), integrationConnections: Number(counts.integrations), products: Number(counts.products), orders: Number(counts.orders), activeSubscriptions: Number(counts.subscriptions), failedSyncJobs: Number(counts.failedSyncJobs) }, privacy: 'Aggregate counts only. No conversation transcripts, private Knowledge content, or integration credentials are returned.' };
  }
}

@Controller('platform-admin')
@UseGuards(AuthSessionGuard, PlatformOperatorGuard)
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get('overview')
  overview(@Req() _request: Request) { return this.admin.overview(); }
}
