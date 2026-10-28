import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlatformOperatorGuard } from './platform-admin';

describe('PlatformOperatorGuard', () => {
  it('does not treat workspace membership as platform access', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const guard = new PlatformOperatorGuard(prisma as unknown as PrismaService);
    const request = { authSession: { userId: 'workspace-owner' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires an authenticated session before reading platform operator records', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const guard = new PlatformOperatorGuard(prisma as unknown as PrismaService);
    const context = { switchToHttp: () => ({ getRequest: () => ({}) }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
