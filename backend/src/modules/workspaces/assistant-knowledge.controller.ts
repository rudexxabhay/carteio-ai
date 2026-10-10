import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { KnowledgeService } from './knowledge.service';

type AuthenticatedRequest = Request & { authSession?: { userId: string } };

@Controller('workspaces/:slug/assistants/:assistantId/knowledge')
@UseGuards(AuthSessionGuard)
export class AssistantKnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.knowledge.listAssistantSources(request.authSession!.userId, slug, assistantId);
  }

  @Post(':sourceId')
  attach(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.attach(request.authSession!.userId, slug, assistantId, sourceId);
  }

  @Delete(':sourceId')
  detach(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.detach(request.authSession!.userId, slug, assistantId, sourceId);
  }
}
