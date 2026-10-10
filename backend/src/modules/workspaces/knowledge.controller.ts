import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { CreateFaqSourceDto, CreateTextSourceDto, CreateWebsiteSourceDto, KnowledgeListQueryDto, UpdateKnowledgeSourceDto } from './knowledge.dto';
import { KnowledgeService } from './knowledge.service';

type AuthenticatedRequest = Request & { authSession?: { userId: string } };

@Controller('workspaces/:slug/knowledge')
@UseGuards(AuthSessionGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: KnowledgeListQueryDto) {
    return this.knowledge.list(request.authSession!.userId, slug, query.type);
  }

  @Post('website')
  createWebsite(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateWebsiteSourceDto) {
    return this.knowledge.createWebsite(request.authSession!.userId, slug, body);
  }

  @Post('faq')
  createFaq(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateFaqSourceDto) {
    return this.knowledge.createFaq(request.authSession!.userId, slug, body);
  }

  @Post('text')
  createText(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateTextSourceDto) {
    return this.knowledge.createText(request.authSession!.userId, slug, body);
  }

  @Get(':sourceId')
  get(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.get(request.authSession!.userId, slug, sourceId);
  }

  @Patch(':sourceId')
  update(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string, @Body() body: UpdateKnowledgeSourceDto) {
    return this.knowledge.update(request.authSession!.userId, slug, sourceId, body);
  }

  @Delete(':sourceId')
  archive(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    return this.knowledge.archive(request.authSession!.userId, slug, sourceId);
  }
}
