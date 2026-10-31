import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { WorkspacePaginationDto } from './workspace.dto';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const tones = ['professional', 'friendly', 'casual', 'supportive', 'concise', 'empathetic'] as const;
const responseStyles = ['short', 'balanced', 'detailed'] as const;

export class AssistantListQueryDto extends WorkspacePaginationDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @ValidateIf((_object, value) => value !== undefined) @IsString() @IsIn(['ALL', 'DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: 'ALL' | 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' = 'ALL';
}

export class CreateAssistantDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  name!: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(500)
  businessPurpose?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000)
  systemInstructions?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^(?:auto|[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*)$/) @MaxLength(35)
  defaultLanguage?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @IsIn(tones)
  responseTone?: typeof tones[number];

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @IsIn(responseStyles)
  responseStyle?: typeof responseStyles[number];

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(500)
  fallbackMessage?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(500)
  greetingMessage?: string | null;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(500)
  escalationMessage?: string | null;

}

export class UpdateAssistantDto {
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  useAllEligibleWorkspaceKnowledge?: boolean;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(2) @MaxLength(200)
  name?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(500)
  businessPurpose?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000)
  systemInstructions?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^(?:auto|[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*)$/) @MaxLength(35)
  defaultLanguage?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @IsIn(tones)
  responseTone?: typeof tones[number];

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @IsIn(responseStyles)
  responseStyle?: typeof responseStyles[number];

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(500)
  fallbackMessage?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(500)
  greetingMessage?: string | null;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(500)
  escalationMessage?: string | null;

}

export class AssistantBusinessRuleDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160)
  title!: string;

  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000)
  instruction!: string;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  enabled?: boolean;
}

export class UpdateAssistantBusinessRuleDto {
  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(2) @MaxLength(160)
  title?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(3) @MaxLength(2000)
  instruction?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  enabled?: boolean;
}
