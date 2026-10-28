import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
export const integrationPlatforms = ['SHOPIFY', 'WOOCOMMERCE', 'WORDPRESS', 'CUSTOM_API', 'STATIC_WEBSITE'] as const;
export type IntegrationPlatformInput = typeof integrationPlatforms[number];
export const connectorDataCategories = ['PRODUCTS', 'PRICES', 'INVENTORY', 'CATEGORIES', 'SERVICES', 'WEBSITE_PAGES', 'FAQ_POLICIES', 'ORDERS', 'CUSTOMER_PII', 'SHOPIFY_LOCATIONS', 'SHOPIFY_SHIPPING', 'SHOPIFY_LEGAL_POLICIES', 'SHOPIFY_ONLINE_STORE_PAGES', 'SHOPIFY_MARKETS', 'SHOPIFY_DISCOUNTS', 'SHOPIFY_METAOBJECT_DEFINITIONS', 'SHOPIFY_METAOBJECTS'] as const;

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class UpdateConnectorDataPermissionDto {
  @IsIn(connectorDataCategories)
  category!: typeof connectorDataCategories[number];

  @IsOptional() @IsIn(['SYNC', 'AI'])
  scope?: 'SYNC' | 'AI';

  @IsBoolean()
  enabled!: boolean;

  @IsOptional() @IsUUID()
  assistantId?: string;
}

export class CreateIntegrationConnectionDto {
  @IsEnum(Object.fromEntries(integrationPlatforms.map((platform) => [platform, platform])))
  platform!: IntegrationPlatformInput;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  displayName!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(2048)
  siteUrl?: string;
}

export class CommerceListQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(1000000)
  page = 1;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize = 25;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(80)
  status?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(255)
  integrationId?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(255)
  externalId?: string;
}

export class InboxListQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(1000000)
  page = 1;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize = 25;
  @Transform(trim) @IsOptional() @IsIn(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'])
  state?: string;
  @Transform(trim) @IsOptional() @IsUUID()
  assistantId?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(80)
  search?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(32)
  channel?: string;
  @Transform(trim) @IsOptional() @IsIn(['ALL', 'READ', 'UNREAD'])
  read?: string;
  @Transform(trim) @IsOptional() @IsISO8601()
  from?: string;
  @Transform(trim) @IsOptional() @IsISO8601()
  to?: string;
  @Transform(trim) @IsOptional() @IsIn(['latest', 'oldest'])
  sort?: string;
  @Transform(trim) @IsOptional() @IsIn(['ALL', 'ASSIGNED_TO_ME', 'RESOLVED'])
  queue?: string;
}

export class UpdateInboxConversationDto {
  @IsOptional() @IsIn(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'])
  state?: string;
}

export class InboxMessagePageQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(1000000)
  page = 1;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize = 50;
}

export class CreateInternalNoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000)
  content!: string;
}

export class SupportTimelineQueryDto extends InboxMessagePageQueryDto {}

export class TicketListQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) pageSize = 25;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(120) search?: string;
  @Transform(trim) @IsOptional() @IsIn(['OPEN', 'ACTIVE', 'PENDING', 'CLOSED']) status?: string;
  @Transform(trim) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(80) category?: string;
  @Transform(trim) @IsOptional() @IsUUID() assistantId?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(40) assigneeId?: string;
  @Transform(trim) @IsOptional() @IsISO8601() from?: string;
  @Transform(trim) @IsOptional() @IsISO8601() to?: string;
  @Transform(trim) @IsOptional() @IsIn(['latest', 'oldest']) sort?: string;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(['OPEN', 'ACTIVE', 'PENDING', 'CLOSED']) status?: string;
  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(2000) resolutionRemarks?: string;
}

export class TicketAssignmentDto { @IsOptional() @IsUUID() assigneeUserId?: string | null; }
export class TicketNoteDto { @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) content!: string; }
export class TicketReplyDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(8000) content!: string;
  @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9._:-]{8,160}$/) idempotencyKey!: string;
}

export class CreateConnectorDto {
  @Transform(trim) @IsString() @Matches(/^[a-z0-9][a-z0-9_.-]{2,79}$/) connectorId!: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) displayName!: string;
  @IsObject() configuration!: Record<string, unknown>;
  @IsOptional() @IsObject() credentials?: Record<string, unknown>;
}
export class ShopifyInstallDto {
  @Transform(trim) @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/) shopDomain!: string;
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(160) displayName?: string;
}
export class UpdateConnectorDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(160) displayName?: string;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}
export class UpdateConnectorSyncScheduleDto {
  @IsIn(['PRODUCTS', 'ORDERS', 'CONTENT']) resourceType!: 'PRODUCTS' | 'ORDERS' | 'CONTENT';
  @IsIn(['FULL', 'INCREMENTAL']) mode!: 'FULL' | 'INCREMENTAL';
  @IsBoolean() enabled!: boolean;
  @IsBoolean() paused!: boolean;
  @Type(() => Number) @IsInt() @Min(60) @Max(10080) intervalMinutes!: number;
}
export class ConnectorCredentialsDto { @IsObject() credentials!: Record<string, unknown>; }
export class QueueConnectorSyncDto {
  @Transform(trim) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,63}$/) resourceType!: string;
  @IsIn(['FULL', 'INCREMENTAL']) mode!: 'FULL' | 'INCREMENTAL';
  @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9._:-]{8,160}$/) idempotencyKey!: string;
}
