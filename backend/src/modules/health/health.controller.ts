import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse } from '@carteio/shared-types';
import { DatabaseHealthService } from '../../infrastructure/database/database-health.service';
@Controller()
export class HealthController {
  constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Get('health')
  getHealth(): HealthResponse { return { status: 'ok', service: 'carteio-ai-api' }; }

  @Get('ready')
  async getReadiness(@Res() response: Response) {
    const readiness = await this.databaseHealth.check();
    const status = readiness.status === 'unavailable' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK;
    return response.status(status).json(readiness);
  }
}
