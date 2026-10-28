import { Body, Controller, Delete, Get, Logger, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard } from '../auth/auth-session.guard';
import { CommerceListQueryDto, CreateIntegrationConnectionDto, CreateConnectorDto, ConnectorCredentialsDto, InboxListQueryDto, InboxMessagePageQueryDto, QueueConnectorSyncDto, ShopifyInstallDto, TicketAssignmentDto, TicketListQueryDto, TicketNoteDto, TicketReplyDto, UpdateConnectorDto, UpdateConnectorDataPermissionDto, UpdateConnectorSyncScheduleDto, UpdateInboxConversationDto, UpdateTicketDto } from './saas.dto';
import { SaasService } from './saas.service';
import { TicketingService } from './ticketing.service';
import { ConnectorService } from './connectors/connector.service';
import { connectorSyncDebug } from './connectors/connector-sync-debug';
import { ShopifyOAuthService } from './connectors/shopify-oauth.service';

type AuthenticatedRequest = Request & { authSession?: { userId: string }; requestId?: string };

@Controller('workspaces/:slug')
@UseGuards(AuthSessionGuard)
export class SaasController {
  private readonly logger = new Logger(SaasController.name);
  constructor(private readonly saas: SaasService, private readonly tickets: TicketingService, private readonly connectors: ConnectorService, private readonly shopifyOAuth: ShopifyOAuthService) {}

  @Get('connectors/catalog') connectorCatalog(@Req() r: AuthenticatedRequest, @Param('slug') slug: string) { return this.connectors.catalog(r.authSession!.userId, slug); }
  @Get('connectors/capabilities') connectorCapabilities(@Req() r: AuthenticatedRequest, @Param('slug') slug: string) { return this.connectors.capabilities(r.authSession!.userId, slug); }
  @Get('connectors') connectorList(@Req() r: AuthenticatedRequest, @Param('slug') slug: string) { return this.connectors.list(r.authSession!.userId, slug); }
  @Post('connectors') connectorCreate(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateConnectorDto) { return this.connectors.create(r.authSession!.userId, slug, body); }
  @Post('connectors/shopify/install') shopifyInstall(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: ShopifyInstallDto) { return this.shopifyOAuth.begin(r.authSession!.userId, slug, body); }
  @Post('connectors/shopify/scope-upgrade') shopifyScopeUpgrade(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: ShopifyInstallDto) { return this.shopifyOAuth.begin(r.authSession!.userId, slug, body, true); }
  @Patch('connectors/:connectorInstanceId') connectorUpdate(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Body() body: UpdateConnectorDto) { return this.connectors.update(r.authSession!.userId, slug, id, body); }
  @Post('connectors/:connectorInstanceId/credentials') connectorCredentials(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Body() body: ConnectorCredentialsDto) { return this.connectors.replaceCredentials(r.authSession!.userId, slug, id, body.credentials); }
  @Post('connectors/:connectorInstanceId/verify') connectorVerify(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string) { return this.connectors.verify(r.authSession!.userId, slug, id); }
  @Post('connectors/:connectorInstanceId/reconnect') connectorReconnect(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string) { return this.connectors.verify(r.authSession!.userId, slug, id); }
  @Post('connectors/:connectorInstanceId/disconnect') connectorDisconnect(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string) { return this.connectors.disconnect(r.authSession!.userId, slug, id); }
  @Get('connectors/:connectorInstanceId/permissions') connectorPermissions(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Query('assistantId') assistantId?: string) { return this.connectors.permissions(r.authSession!.userId, slug, id, assistantId); }
  @Post('connectors/:connectorInstanceId/permissions/refresh') refreshConnectorPermissions(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string) { return this.connectors.refreshShopifyPermissions(r.authSession!.userId, slug, id); }
  @Patch('connectors/:connectorInstanceId/permissions') updateConnectorPermission(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Body() body: UpdateConnectorDataPermissionDto) { return this.connectors.updatePermission(r.authSession!.userId, slug, id, body); }
  @Post('connectors/:connectorInstanceId/sync-jobs') async connectorSync(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Body() body: QueueConnectorSyncDto) {
    const startedAt = Date.now(), requestId = r.requestId ?? 'unknown';
    const fields = { operation: 'connector.sync_job_create', connectorInstanceId: id, resourceType: body.resourceType, mode: body.mode };
    connectorSyncDebug(this.logger, '01_request_received', requestId, startedAt, fields);
    const result = await this.connectors.queueSync(r.authSession!.userId, slug, id, body, requestId);
    connectorSyncDebug(this.logger, '13_api_response_generated', requestId, startedAt, { ...fields, syncJobId: result.id, state: result.state });
    return result;
  }
  @Get('connectors/:connectorInstanceId/sync-jobs') connectorSyncHistory(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Query('before') before?: string, @Query('limit') limit?: string) { return this.connectors.syncHistory(r.authSession!.userId, slug, id, before, Number(limit ?? 25)); }
  @Patch('connectors/:connectorInstanceId/sync-schedule') connectorSyncSchedule(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Body() body: UpdateConnectorSyncScheduleDto) { return this.connectors.updateSyncSchedule(r.authSession!.userId, slug, id, body); }
  @Post('connectors/:connectorInstanceId/sync-jobs/:syncJobId/retry') connectorSyncRetry(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('connectorInstanceId', ParseUUIDPipe) id: string, @Param('syncJobId', ParseUUIDPipe) jobId: string) { return this.connectors.retrySyncJob(r.authSession!.userId, slug, id, jobId); }

  @Get('tickets') ticketsList(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Query() q: TicketListQueryDto) { return this.tickets.list(r.authSession!.userId, slug, q); }
  @Get('tickets/:ticketId') ticketDetail(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('ticketId') id: string, @Query() q: InboxMessagePageQueryDto) { return this.tickets.detail(r.authSession!.userId, slug, id, q.page, q.pageSize); }
  @Patch('tickets/:ticketId') updateTicket(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('ticketId') id: string, @Body() body: UpdateTicketDto) { return this.tickets.update(r.authSession!.userId, slug, id, body); }
  @Patch('tickets/:ticketId/assignment') assignTicket(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('ticketId') id: string, @Body() body: TicketAssignmentDto) { return this.tickets.assign(r.authSession!.userId, slug, id, body.assigneeUserId ?? null); }
  @Post('tickets/:ticketId/notes') addTicketNote(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('ticketId') id: string, @Body() body: TicketNoteDto) { return this.tickets.addNote(r.authSession!.userId, slug, id, body.content); }
  @Post('tickets/:ticketId/replies') replyToTicket(@Req() r: AuthenticatedRequest, @Param('slug') slug: string, @Param('ticketId') id: string, @Body() body: TicketReplyDto) { return this.tickets.reply(r.authSession!.userId, slug, id, body); }

  @Get('integrations')
  integrations(@Req() request: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.saas.listIntegrations(request.authSession!.userId, slug);
  }

  @Post('integrations')
  createIntegration(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Body() body: CreateIntegrationConnectionDto) {
    return this.saas.createIntegration(request.authSession!.userId, slug, body);
  }

  @Delete('integrations/:integrationId')
  revokeIntegration(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('integrationId', ParseUUIDPipe) integrationId: string) {
    return this.saas.disconnectIntegration(request.authSession!.userId, slug, integrationId);
  }

  @Get('products')
  products(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: CommerceListQueryDto) {
    return this.saas.products(request.authSession!.userId, slug, query);
  }

  @Get('orders')
  orders(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: CommerceListQueryDto) {
    return this.saas.orders(request.authSession!.userId, slug, query);
  }

  @Get('sales')
  sales(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.saas.sales(request.authSession!.userId, slug, from, to);
  }

  @Get('conversations')
  inbox(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Query() query: InboxListQueryDto) {
    return this.saas.inbox(request.authSession!.userId, slug, query);
  }

  @Get('support-summary')
  supportSummary(@Req() request: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.saas.supportSummary(request.authSession!.userId, slug);
  }

  @Get('billing-usage')
  billingUsage(@Req() request: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.saas.billingAndUsage(request.authSession!.userId, slug);
  }

  @Get('conversations/:conversationId')
  inboxConversation(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('conversationId', ParseUUIDPipe) id: string, @Query() query: InboxMessagePageQueryDto) {
    return this.saas.inboxConversation(request.authSession!.userId, slug, id, query.page, query.pageSize);
  }

  @Post('conversations/:conversationId/read')
  markInboxConversationRead(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('conversationId', ParseUUIDPipe) id: string) {
    return this.saas.markInboxConversationRead(request.authSession!.userId, slug, id);
  }

  @Post('conversations/:conversationId/notes')
  addConversationNote(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('conversationId', ParseUUIDPipe) id: string, @Body() body: TicketNoteDto) {
    return this.saas.addConversationNote(request.authSession!.userId, slug, id, body.content);
  }

  @Patch('conversations/:conversationId')
  updateInboxConversation(@Req() request: AuthenticatedRequest, @Param('slug') slug: string, @Param('conversationId', ParseUUIDPipe) id: string, @Body() body: UpdateInboxConversationDto) {
    return this.saas.updateInboxConversation(request.authSession!.userId, slug, id, body);
  }


}

@Controller('connectors/webhooks')
export class ConnectorWebhookController {
  constructor(private readonly connectors: ConnectorService) {}
  @Post('shopify/scopes-update') receiveShopifyScopesUpdate(@Req() request: Request & { rawBody?: Buffer }) {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    return this.connectors.receiveShopifyScopesUpdate(request.rawBody, headers, request.ip ?? 'unknown');
  }
  @Post(':webhookPublicId') receive(@Param('webhookPublicId') id: string, @Req() request: Request & { rawBody?: Buffer }) {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    return this.connectors.receiveWebhook(id, request.rawBody, headers, request.ip ?? 'unknown');
  }
}
