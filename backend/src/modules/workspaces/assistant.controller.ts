import { Body, Controller, Delete, Get, HttpException, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import type { AuthenticatedRequest } from '../auth/auth-session.guard';
import { AssistantService } from './assistant.service';
import { AssistantBusinessRuleDto, AssistantListQueryDto, CreateAssistantDto, UpdateAssistantBusinessRuleDto } from './assistant.dto';
import { PlaygroundChatDto, UpdateAssistantPlaygroundDto } from './playground.dto';
import { TrainingHistoryQueryDto } from './training-history.dto';
import { playgroundDiagnosticsEnabled, type PlaygroundTraceEvent } from './playground-diagnostics';

@Controller('workspaces/:slug/assistants')
@UseGuards(AuthSessionGuard)
export class AssistantController {
  constructor(private readonly assistants: AssistantService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateAssistantDto) {
    return this.assistants.create(request.authSession.userId, slug, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() pagination: AssistantListQueryDto) {
    return this.assistants.list(request.authSession.userId, slug, pagination);
  }

  @Get('provider-status')
  providerStatus(@Req() request: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.assistants.providerConfigurationStatus(request.authSession.userId, slug);
  }

  @Post('provider-status/openrouter/validate')
  validateOpenRouterModel(@Req() request: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.assistants.validateOpenRouterModel(request.authSession.userId, slug);
  }

  @Get(':assistantId')
  get(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.get(request.authSession.userId, slug, assistantId);
  }

  @Patch(':assistantId')
  update(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Body() body: UpdateAssistantPlaygroundDto) {
    return this.assistants.update(request.authSession.userId, slug, assistantId, body);
  }

  @Post(':assistantId/activate')
  activate(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.setActive(request.authSession.userId, slug, assistantId, true);
  }

  @Post(':assistantId/deactivate')
  deactivate(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.setActive(request.authSession.userId, slug, assistantId, false);
  }

  @Post(':assistantId/archive')
  archive(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.archive(request.authSession.userId, slug, assistantId);
  }

  @Post(':assistantId/restore')
  restore(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.restore(request.authSession.userId, slug, assistantId);
  }

  @Delete(':assistantId')
  permanentDeleteUnavailable(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.permanentDeleteUnavailable(request.authSession.userId, slug, assistantId);
  }

  @Get(':assistantId/rules')
  rules(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.listRules(request.authSession.userId, slug, assistantId);
  }

  @Post(':assistantId/rules')
  createRule(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Body() body: AssistantBusinessRuleDto) {
    return this.assistants.createRule(request.authSession.userId, slug, assistantId, body);
  }

  @Patch(':assistantId/rules/:ruleId')
  updateRule(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() body: UpdateAssistantBusinessRuleDto) {
    return this.assistants.updateRule(request.authSession.userId, slug, assistantId, ruleId, body);
  }

  @Delete(':assistantId/rules/:ruleId')
  deleteRule(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    return this.assistants.deleteRule(request.authSession.userId, slug, assistantId, ruleId);
  }

  @Get(':assistantId/training-history')
  history(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Query() query: TrainingHistoryQueryDto) {
    return this.assistants.trainingHistory(request.authSession.userId, slug, assistantId, query);
  }

  @Get(':assistantId/training-overview')
  trainingOverview(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string) {
    return this.assistants.trainingOverview(request.authSession.userId, slug, assistantId);
  }

  @Post(':assistantId/playground/chat/stream')
  async playgroundChatStream(@Req() request: AuthenticatedRequest, @Res() response: Response, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Body() body: PlaygroundChatDto) {
    if (!playgroundDiagnosticsEnabled()) throw new NotFoundException({ code: 'PLAYGROUND_LIVE_TRACE_DISABLED', message: 'Live Playground diagnostics are unavailable in this environment.' });
    const requestId = request.requestId || randomUUID();
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortIfDisconnected = () => { if (!response.writableEnded) abort(); };
    const send = (event: string, data: unknown, id?: number) => {
      if (response.writableEnded || response.destroyed) return;
      response.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    response.status(200);
    response.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Request-ID': requestId });
    response.flushHeaders();
    const heartbeat = setInterval(() => { if (!response.writableEnded && !response.destroyed) response.write(': keep-alive\n\n'); }, 15_000);
    request.once('aborted', abort);
    response.once('close', abortIfDisconnected);
    let lastSequence = 0;
    try {
      const result = await this.assistants.playgroundChat(
        request.authSession.userId, slug, assistantId, body, requestId, controller.signal,
        () => send('ready', { traceId: requestId }),
        (event: PlaygroundTraceEvent) => { lastSequence = Math.max(lastSequence, event.sequence); send('trace', event, event.sequence); },
      );
      const diagnostics = 'diagnostics' in result ? result.diagnostics : undefined;
      send('response', result);
      lastSequence = Math.max(lastSequence, diagnostics?.events.at(-1)?.sequence ?? 0);
      send('terminal', { traceId: requestId, status: 'SUCCEEDED', lastSequence });
    } catch (error) {
      if (!controller.signal.aborted && !response.destroyed) {
        const safeResponse = error instanceof HttpException ? error.getResponse() : null;
        const payload = typeof safeResponse === 'object' && safeResponse !== null && !Array.isArray(safeResponse) ? safeResponse as Record<string, unknown> : {};
        const code = typeof payload.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(payload.code) ? payload.code : error instanceof HttpException ? 'PLAYGROUND_REQUEST_FAILED' : 'INTERNAL_ERROR';
        const retryAfterSeconds = typeof payload.retryAfterSeconds === 'number' && Number.isSafeInteger(payload.retryAfterSeconds) && payload.retryAfterSeconds > 0 && payload.retryAfterSeconds <= 3600 ? payload.retryAfterSeconds : undefined;
        const diagnostics = payload.diagnostics;
        const message = code === 'PLAYGROUND_PROVIDER_RATE_LIMITED' && retryAfterSeconds ? `The selected AI provider is rate limiting requests. Retry after ${retryAfterSeconds} seconds.` : 'The Playground request could not be completed.';
        send('failure', { code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}), ...(diagnostics ? { diagnostics } : {}) });
        if (typeof diagnostics === 'object' && diagnostics !== null && 'events' in diagnostics && Array.isArray((diagnostics as { events: Array<{ sequence?: number }> }).events)) {
          lastSequence = Math.max(lastSequence, (diagnostics as { events: Array<{ sequence?: number }> }).events.reduce((max, event) => Math.max(max, event.sequence ?? 0), 0));
        }
        send('terminal', { traceId: requestId, status: controller.signal.aborted ? 'CANCELLED' : 'FAILED', lastSequence });
      }
    } finally {
      clearInterval(heartbeat);
      request.removeListener('aborted', abort);
      response.removeListener('close', abortIfDisconnected);
      if (!response.writableEnded && !response.destroyed) response.end();
    }
  }

  @Post(':assistantId/playground/chat')
  async playgroundChat(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Body() body: PlaygroundChatDto) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortIfDisconnected = () => { if (!response.writableEnded) abort(); };
    request.once('aborted', abort);
    response.once('close', abortIfDisconnected);
    try {
      return await this.assistants.playgroundChat(request.authSession.userId, slug, assistantId, body, request.requestId, controller.signal);
    } finally {
      request.removeListener('aborted', abort);
      response.removeListener('close', abortIfDisconnected);
    }
  }

  @Get(':assistantId/playground/sessions/:sessionId')
  playgroundConversation(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('assistantId', ParseUUIDPipe) assistantId: string, @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string, @Query('offset') offset?: string, @Query('limit') limit?: string, @Query('latest') latest?: string) {
    const boundedInteger = (value: string | undefined, fallback: number, maximum: number) => value && /^\d{1,7}$/.test(value) ? Math.min(maximum, Number(value)) : fallback;
    return this.assistants.playgroundConversation(request.authSession.userId, slug, assistantId, sessionId, boundedInteger(offset, 0, 1_000_000), boundedInteger(limit, 40, 100), latest === 'true');
  }
}
