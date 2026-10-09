import { Module, type DynamicModule } from '@nestjs/common';
import { DatabaseHealthService, type DatabasePing } from './database-health.service';
import { PrismaService } from './prisma.service';

@Module({})
export class DatabaseModule {
  static register(enabled: boolean): DynamicModule {
    if (!enabled) {
      return {
        module: DatabaseModule,
        providers: [{ provide: DatabaseHealthService, useFactory: () => new DatabaseHealthService(null) }],
        exports: [DatabaseHealthService],
      };
    }

    return {
      module: DatabaseModule,
      providers: [
        PrismaService,
        {
          provide: DatabaseHealthService,
          useFactory: (client: PrismaService) => new DatabaseHealthService(client as unknown as DatabasePing),
          inject: [PrismaService],
        },
      ],
      exports: [DatabaseHealthService, PrismaService],
    };
  }
}
