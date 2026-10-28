import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthSessionGuard } from '../src/modules/auth/auth-session.guard';
import { WorkspaceController } from '../src/modules/workspaces/workspace.controller';
import { WorkspaceModule } from '../src/modules/workspaces/workspace.module';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { AssistantController } from '../src/modules/workspaces/assistant.controller';
import { AssistantService } from '../src/modules/workspaces/assistant.service';
import { KnowledgeController } from '../src/modules/workspaces/knowledge.controller';
import { AssistantKnowledgeController } from '../src/modules/workspaces/assistant-knowledge.controller';
import { KnowledgeService } from '../src/modules/workspaces/knowledge.service';
import { PrivateKnowledgeStorage } from '../src/modules/workspaces/private-knowledge-storage';
import { KnowledgeBaseController } from '../src/modules/workspaces/knowledge-base.controller';
import { KnowledgeBaseService } from '../src/modules/workspaces/knowledge-base.service';

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
      expect(Reflect.getMetadata('__guards__', AssistantController)).toContain(AuthSessionGuard);
      expect(Reflect.getMetadata('__guards__', KnowledgeController)).toContain(AuthSessionGuard);
      expect(Reflect.getMetadata('__guards__', AssistantKnowledgeController)).toContain(AuthSessionGuard);
      expect(Reflect.getMetadata('__guards__', KnowledgeBaseController)).toContain(AuthSessionGuard);
      expect(moduleRef.get(AssistantService)).toBeInstanceOf(AssistantService);
      expect(moduleRef.get(KnowledgeService)).toBeInstanceOf(KnowledgeService);
      expect(moduleRef.get(KnowledgeBaseService)).toBeInstanceOf(KnowledgeBaseService);
      expect(moduleRef.get(PrivateKnowledgeStorage).isConfigured()).toBe(false);
      expect(moduleRef.get(PrismaService)).toEqual({});
    } finally {
      await moduleRef.close();
    }
  });
});
