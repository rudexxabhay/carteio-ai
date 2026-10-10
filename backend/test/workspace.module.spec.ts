import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthSessionGuard } from '../src/modules/auth/auth-session.guard';
import { WorkspaceController } from '../src/modules/workspaces/workspace.controller';
import { WorkspaceModule } from '../src/modules/workspaces/workspace.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';

describe('WorkspaceModule initialization', () => {
  it('resolves the shared session guard and auth dependencies while keeping route protection active', async () => {
    const databaseModule = DatabaseModule.register(true);
    const authModule = AuthModule.register(databaseModule);
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspaceModule.register(authModule, databaseModule)],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    try {
      const guard = moduleRef.get(AuthSessionGuard);
      const authService = moduleRef.get(AuthService);

      expect(guard).toBeInstanceOf(AuthSessionGuard);
      expect(authService).toBeInstanceOf(AuthService);
      expect((guard as unknown as { auth: AuthService }).auth).toBe(authService);
      expect(Reflect.getMetadata('__guards__', WorkspaceController)).toContain(AuthSessionGuard);
      expect(moduleRef.get(PrismaService)).toEqual({});
    } finally {
      await moduleRef.close();
    }
  });
});
