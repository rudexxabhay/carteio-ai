import { PrivateKnowledgeStorage } from './private-knowledge-storage';
import { LocalKnowledgeStorage } from './local-knowledge-storage';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeProcessingService } from './knowledge-processing.service';
import { WorkspaceService } from './workspace.service';

/** Minimal provider graph for the persistent knowledge queue consumer. */
@Module({
  imports: [DatabaseModule.register(true)],
  providers: [{ provide: PrivateKnowledgeStorage, useClass: LocalKnowledgeStorage }, WorkspaceService, KnowledgeBaseService, KnowledgeProcessingService],
})
export class KnowledgeWorkerModule {}
