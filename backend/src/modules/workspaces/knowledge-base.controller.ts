import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { BulkKnowledgeBaseSourcesDto, CreateKnowledgeBaseDto, KnowledgeBaseListQueryDto, KnowledgeBaseSourceQueryDto, ReplaceAssistantKnowledgeBasesDto, UpdateKnowledgeBaseDto } from './knowledge-base.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeProcessingService } from './knowledge-processing.service';

type AuthenticatedRequest = Request & { authSession?: { userId: string } };

@Controller('workspaces/:slug')
@UseGuards(AuthSessionGuard)
export class KnowledgeBaseController {
  constructor(private readonly bases: KnowledgeBaseService, private readonly processing: KnowledgeProcessingService) {}

  @Get('knowledge-bases')
  list(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: KnowledgeBaseListQueryDto) { return this.bases.list(req.authSession!.userId, slug, query); }

  @Get('knowledge-bases/unassigned-sources')
  unassignedSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: KnowledgeBaseSourceQueryDto) { return this.bases.unassignedSources(req.authSession!.userId, slug, query); }

  @Post('knowledge-bases')
  create(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateKnowledgeBaseDto) { return this.bases.create(req.authSession!.userId, slug, body); }

  @Get('knowledge-bases/:baseId')
  get(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string) { return this.bases.get(req.authSession!.userId, slug, baseId); }

  @Patch('knowledge-bases/:baseId')
  update(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: UpdateKnowledgeBaseDto) { return this.bases.update(req.authSession!.userId, slug, baseId, body); }

  @Delete('knowledge-bases/:baseId')
  archive(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string) { return this.bases.archive(req.authSession!.userId, slug, baseId); }

  @Get('knowledge-bases/:baseId/sources')
  sources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Query() query: KnowledgeBaseSourceQueryDto) { return this.bases.sources(req.authSession!.userId, slug, baseId, query); }

  @Get('knowledge-bases/:baseId/available-sources')
  availableSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Query() query: KnowledgeBaseSourceQueryDto) { return this.bases.availableSources(req.authSession!.userId, slug, baseId, query); }

  @Post('knowledge-bases/:baseId/sources/bulk')
  addSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: BulkKnowledgeBaseSourcesDto) { return this.bases.addSources(req.authSession!.userId, slug, baseId, body); }

  @Delete('knowledge-bases/:baseId/sources/bulk')
  removeSources(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Body() body: BulkKnowledgeBaseSourcesDto) { return this.bases.removeSources(req.authSession!.userId, slug, baseId, body); }

  @Get('assistants/:assistantId/knowledge-bases')
  assistantBases(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Query() query: KnowledgeBaseListQueryDto) { return this.bases.assistantBases(req.authSession!.userId, slug, assistantId, query); }

  @Get('knowledge-bases/:baseId/assistants')
  baseAssistants(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string) { return this.bases.baseAssistants(req.authSession!.userId, slug, baseId); }

  @Post('knowledge-bases/:baseId/assistants/:assistantId')
  addBaseAssistant(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) { return this.bases.addBaseAssistant(req.authSession!.userId, slug, baseId, assistantId); }

  @Delete('knowledge-bases/:baseId/assistants/:assistantId')
  removeBaseAssistant(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('baseId', ParseUUIDPipe) baseId: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) { return this.bases.removeBaseAssistant(req.authSession!.userId, slug, baseId, assistantId); }

  @Put('assistants/:assistantId/knowledge-bases')
  replaceAssistantBases(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Body() body: ReplaceAssistantKnowledgeBasesDto) { return this.bases.replaceAssistantBases(req.authSession!.userId, slug, assistantId, body); }

  @Get('assistants/:assistantId/effective-knowledge')
  effective(@Req() req: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.processing.effectivePublicKnowledge(req.authSession!.userId, slug, assistantId);
  }
}
