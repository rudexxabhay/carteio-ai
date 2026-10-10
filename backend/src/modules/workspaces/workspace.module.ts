import { Module, type DynamicModule } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { KnowledgeController } from './knowledge.controller';
import { AssistantKnowledgeController } from './assistant-knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { PrivateKnowledgeStorage, UnconfiguredPrivateKnowledgeStorage } from './private-knowledge-storage';

@Module({})
export class WorkspaceModule {
  static register(authModule: DynamicModule, databaseModule: DynamicModule): DynamicModule {
    return {
      module: WorkspaceModule,
      imports: [authModule, databaseModule],
      controllers: [WorkspaceController, AssistantController, KnowledgeController, AssistantKnowledgeController],
      providers: [WorkspaceService, AssistantService, KnowledgeService, { provide: PrivateKnowledgeStorage, useClass: UnconfiguredPrivateKnowledgeStorage }],
      exports: [WorkspaceService, AssistantService, KnowledgeService],
    };
  }
}
