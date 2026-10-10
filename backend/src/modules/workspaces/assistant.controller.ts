import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { AssistantService } from './assistant.service';
import { CreateAssistantDto, UpdateAssistantDto } from './assistant.dto';
import { WorkspacePaginationDto } from './workspace.dto';

type AuthenticatedRequest = Request & { authSession?: { userId: string } };

@Controller('workspaces/:slug/assistants')
@UseGuards(AuthSessionGuard)
export class AssistantController {
  constructor(private readonly assistants: AssistantService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateAssistantDto) {
    return this.assistants.create(request.authSession!.userId, slug, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() pagination: WorkspacePaginationDto) {
    return this.assistants.list(request.authSession!.userId, slug, pagination);
  }

  @Get(':assistantId')
  get(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.get(request.authSession!.userId, slug, assistantId);
  }

  @Patch(':assistantId')
  update(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Body() body: UpdateAssistantDto) {
    return this.assistants.update(request.authSession!.userId, slug, assistantId, body);
  }

  @Post(':assistantId/activate')
  activate(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.setActive(request.authSession!.userId, slug, assistantId, true);
  }

  @Post(':assistantId/deactivate')
  deactivate(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.setActive(request.authSession!.userId, slug, assistantId, false);
  }
}
