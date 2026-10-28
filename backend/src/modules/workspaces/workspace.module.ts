import { Module, type DynamicModule } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { KnowledgeController } from './knowledge.controller';
import { AssistantKnowledgeController } from './assistant-knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { LocalKnowledgeStorage } from './local-knowledge-storage';
import { PrivateKnowledgeStorage } from './private-knowledge-storage';
import { KnowledgeProcessingService } from './knowledge-processing.service';
import { ConversationProviderService } from './conversation-provider.service';
import { ConversationOrchestrator } from './conversation-orchestrator.service';
import { SaasController } from './saas.controller';
import { SaasService } from './saas.service';
import { SupportDeliveryService } from './support-delivery.service';
import { TicketingService } from './ticketing.service';
import { TicketOutboxWorker } from './ticket-outbox-worker.service';
import { PlatformAdminController, PlatformAdminService, PlatformOperatorGuard } from './platform-admin';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';
import { WidgetRetentionWorker } from './widget-retention-worker.service';
import { ConnectorService } from './connectors/connector.service';
import { ConnectorWebhookController } from './saas.controller';
import { ConnectorRegistry } from './connectors/connector.registry';
import { ConnectorCredentialVault } from './connectors/connector-credential-vault';
import { GenericRestConnectorAdapter } from './connectors/generic-rest-connector.adapter';
import { SafeOutboundHttpService } from './connectors/safe-outbound-http.service';
import { ConnectorSyncWorker } from './connectors/connector-sync-worker.service';
import { ShopifyConnectorAdapter, WooCommerceConnectorAdapter } from './connectors/shopify.adapter';
import { ShopifyOAuthController } from './connectors/shopify-oauth.controller';
import { ShopifyOAuthService } from './connectors/shopify-oauth.service';
import { ShopifyGrantedScopeDiscoveryService } from './connectors/shopify-granted-scope-discovery.service';
import { CommerceReadContracts } from './connectors/commerce-read-contracts.service';
import { UniversalBusinessApiAdapter } from './connectors/universal-business-api.adapter';
import { WebsiteVerificationService } from './website-verification.service';
import { ShopifyWebsiteDiscoveryService } from './shopify-website-discovery.service';
import { FlowController } from './flow.controller';
import { FlowService } from './flow.service';

@Module({})
export class WorkspaceModule {
  static register(authModule: DynamicModule, databaseModule: DynamicModule): DynamicModule {
    return {
      module: WorkspaceModule,
      imports: [authModule, databaseModule],
      controllers: [WorkspaceController, AssistantController, FlowController, KnowledgeController, AssistantKnowledgeController, KnowledgeBaseController, SaasController, ConnectorWebhookController, ShopifyOAuthController, PlatformAdminController, WidgetController],
      providers: [WorkspaceService, AssistantService, FlowService, ConversationOrchestrator, KnowledgeService, KnowledgeBaseService, KnowledgeProcessingService, WebsiteVerificationService, ShopifyWebsiteDiscoveryService, ConversationProviderService, SaasService, TicketingService, TicketOutboxWorker, WidgetRetentionWorker, SupportDeliveryService, WidgetService, PlatformAdminService, PlatformOperatorGuard, SafeOutboundHttpService, GenericRestConnectorAdapter, ShopifyConnectorAdapter, WooCommerceConnectorAdapter,
        { provide: 'MERN_BUSINESS_API', inject: [SafeOutboundHttpService], useFactory: (http: SafeOutboundHttpService) => new UniversalBusinessApiAdapter(http, 'mern_business_api_v1', 'MERN Business API', 'MERN') },
        { provide: 'PHP_BUSINESS_API', inject: [SafeOutboundHttpService], useFactory: (http: SafeOutboundHttpService) => new UniversalBusinessApiAdapter(http, 'php_business_api_v1', 'PHP Business API', 'PHP') },
        { provide: 'NEXTJS_BUSINESS_API', inject: [SafeOutboundHttpService], useFactory: (http: SafeOutboundHttpService) => new UniversalBusinessApiAdapter(http, 'nextjs_business_api_v1', 'Next.js Business API', 'NEXTJS') },
        { provide: 'WORDPRESS_BUSINESS_API', inject: [SafeOutboundHttpService], useFactory: (http: SafeOutboundHttpService) => new UniversalBusinessApiAdapter(http, 'wordpress_business_api_v1', 'WordPress Business API', 'WORDPRESS') },
        ConnectorCredentialVault, ShopifyGrantedScopeDiscoveryService, { provide: ConnectorRegistry, inject: [GenericRestConnectorAdapter, ShopifyConnectorAdapter, WooCommerceConnectorAdapter, 'MERN_BUSINESS_API', 'PHP_BUSINESS_API', 'NEXTJS_BUSINESS_API', 'WORDPRESS_BUSINESS_API'], useFactory: (generic: GenericRestConnectorAdapter, shopify: ShopifyConnectorAdapter, woo: WooCommerceConnectorAdapter, mern: UniversalBusinessApiAdapter, php: UniversalBusinessApiAdapter, nextjs: UniversalBusinessApiAdapter, wordpress: UniversalBusinessApiAdapter) => new ConnectorRegistry([generic, shopify, woo, mern, php, nextjs, wordpress]) }, ConnectorService, ShopifyOAuthService, ConnectorSyncWorker, CommerceReadContracts, { provide: PrivateKnowledgeStorage, useClass: LocalKnowledgeStorage }],
      exports: [WorkspaceService, AssistantService, ConversationOrchestrator, KnowledgeService, KnowledgeBaseService, KnowledgeProcessingService, SaasService, TicketingService, ConnectorService, ConnectorRegistry, CommerceReadContracts],
    };
  }
}
