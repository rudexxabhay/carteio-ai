import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({})
export class AppModule {
  static register(databaseEnabled: boolean): DynamicModule {
    return {
      module: AppModule,
      imports: [HealthModule.register(DatabaseModule.register(databaseEnabled)), ...(databaseEnabled ? [AuthModule] : [])],
    };
  }
}
