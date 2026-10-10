import { Module, type DynamicModule } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({})
export class WorkspaceModule {
  static register(authModule: DynamicModule, databaseModule: DynamicModule): DynamicModule {
    return {
      module: WorkspaceModule,
      imports: [authModule, databaseModule],
      controllers: [WorkspaceController],
      providers: [WorkspaceService],
      exports: [WorkspaceService],
    };
  }
}
