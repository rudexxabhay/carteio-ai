import { Module, type DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller';
@Module({})
export class HealthModule {
  static register(databaseModule: DynamicModule): DynamicModule {
    return { module: HealthModule, imports: [databaseModule], controllers: [HealthController] };
  }
}
