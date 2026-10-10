import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { CreateWorkspaceDto, UpdateWorkspaceDto, WorkspacePaginationDto } from './workspace.dto';
import { WorkspaceService } from './workspace.service';

type AuthenticatedRequest = Request & { authSession?: { userId: string } };

@Controller('workspaces')
@UseGuards(AuthSessionGuard)
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateWorkspaceDto) {
    return this.workspaces.create(request.authSession!.userId, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() pagination: WorkspacePaginationDto) {
    return this.workspaces.list(request.authSession!.userId, pagination);
  }

  @Get(':slug/members')
  members(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() pagination: WorkspacePaginationDto) {
    return this.workspaces.members(request.authSession!.userId, slug, pagination);
  }

  @Get(':slug')
  get(@Req() request: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.workspaces.getAuthorized(request.authSession!.userId, slug);
  }

  @Patch(':slug')
  update(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: UpdateWorkspaceDto) {
    return this.workspaces.update(request.authSession!.userId, slug, body);
  }
}
