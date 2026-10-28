import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import type { AuthenticatedRequest } from '../auth/auth-session.guard';
import { CreateFlowDto, FlowRunDto, UpdateFlowDto } from './flow.dto';
import { FlowService } from './flow.service';

@Controller('workspaces/:slug/flows')
@UseGuards(AuthSessionGuard)
export class FlowController {
  constructor(private readonly flows: FlowService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query('assistantId') assistantId?: string) {
    return this.flows.list(request.authSession.userId, slug, assistantId);
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateFlowDto) {
    return this.flows.create(request.authSession.userId, slug, body);
  }

  @Get(':flowId')
  get(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('flowId', ParseUUIDPipe) flowId: string) {
    return this.flows.get(request.authSession.userId, slug, flowId);
  }

  @Patch(':flowId')
  update(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('flowId', ParseUUIDPipe) flowId: string, @Body() body: UpdateFlowDto) {
    return this.flows.update(request.authSession.userId, slug, flowId, body);
  }

  @Delete(':flowId')
  delete(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('flowId', ParseUUIDPipe) flowId: string) {
    return this.flows.delete(request.authSession.userId, slug, flowId);
  }

  @Post(':flowId/run')
  async run(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response, @Param('slug') slug: string, @Param('flowId', ParseUUIDPipe) flowId: string, @Body() body: FlowRunDto) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortIfDisconnected = () => { if (!response.writableEnded) abort(); };
    request.once('aborted', abort);
    response.once('close', abortIfDisconnected);
    try {
      return await this.flows.run(request.authSession.userId, slug, flowId, body, request.requestId ?? randomUUID(), controller.signal);
    } finally {
      request.removeListener('aborted', abort);
      response.removeListener('close', abortIfDisconnected);
    }
  }
}
