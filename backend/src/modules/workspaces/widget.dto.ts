import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class WidgetAppearanceDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) welcomeMessage?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-f]{6}$/i) color?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-f]{6}$/i) userBubbleColor?: string;
  @IsOptional() @IsIn(['right', 'left']) position?: 'right'|'left';
  @IsOptional() @IsIn(['system','inter','arial','georgia','verdana']) fontFamily?: 'system'|'inter'|'arial'|'georgia'|'verdana';
  @IsOptional() @IsIn(['small','medium','large','custom']) desktopSize?: 'small'|'medium'|'large'|'custom';
  @IsOptional() @IsInt() @Min(320) @Max(560) width?: number;
  @IsOptional() @IsInt() @Min(420) @Max(900) height?: number;
  @IsOptional() @IsInt() @Min(280) @Max(600) mobileWidth?: number;
  @IsOptional() @IsInt() @Min(360) @Max(900) mobileHeight?: number;
  @IsOptional() @IsInt() @Min(12) @Max(32) cornerRadius?: number;
  @IsOptional() @IsInt() @Min(48) @Max(80) launcherSize?: number;
  @IsOptional() @IsString() @MaxLength(2048) avatarUrl?: string|null;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(120, { each: true }) suggestions?: string[];
}
export class UpdateWidgetDto {
  @IsBoolean() enabled!: boolean;
  @Transform(trim) @IsUUID('4') assistantId!: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(253, { each: true }) allowedDomains!: string[];
  @IsOptional() @IsObject() @ValidateNested() @Type(() => WidgetAppearanceDto) appearance?: WidgetAppearanceDto;
}
export class WidgetBootstrapDto { @IsString() @Matches(/^[A-Za-z0-9_-]{20,80}$/) widgetId!: string; @IsOptional() @IsString() @MaxLength(4096) resumeToken?: string; }
export class WidgetMessageDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) content!: string;
  @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9._:-]{8,160}$/) idempotencyKey!: string;
}
export class WidgetHistoryQueryDto { @IsOptional() @IsString() @MaxLength(64) before?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 30; }
export class WidgetAckDto { @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) messageIds!: string[]; }
export class WidgetTicketConfirmationDto { @IsIn(['CONFIRM_TICKET_DRAFT']) action!: 'CONFIRM_TICKET_DRAFT'; @Type(() => Number) @IsInt() @Min(1) @Max(100000) version!: number; }
export class WidgetTicketStatusDto { @Transform(trim) @IsString() @Matches(/^TKT-[A-Fa-f0-9]{10}$/) reference!: string; }
