import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspaceModule } from './modules/workspaces/workspace.module';

@Module({})
export class AppModule {
  static register(databaseEnabled: boolean): DynamicModule {
    const databaseModule = DatabaseModule.register(databaseEnabled);
    const authModule = AuthModule.register(databaseModule);
    return {
      module: AppModule,
      imports: [HealthModule.register(databaseModule), ...(databaseEnabled ? [authModule, WorkspaceModule.register(authModule, databaseModule)] : [])],
    };
  }
}
