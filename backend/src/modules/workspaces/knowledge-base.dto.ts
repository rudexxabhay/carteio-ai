import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { KNOWLEDGE_SECTIONS } from './knowledge-sections';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class KnowledgeBaseListQueryDto {
  @Transform(trim) @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @Transform(trim) @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED', 'ALL'])
  status: 'ACTIVE' | 'ARCHIVED' | 'ALL' = 'ACTIVE';

  @Transform(trim) @IsOptional() @IsIn(['name', 'updatedAt', 'createdAt'])
  sort: 'name' | 'updatedAt' | 'createdAt' = 'updatedAt';

  @Transform(trim) @IsOptional() @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';

  @Type(() => Number) @IsOptional() @IsInt() @Min(1)
  page = 1;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize = 20;

  @Transform(({ value }) => value === 'false' ? false : value === 'true' ? true : value) @IsOptional() @IsBoolean()
  includeLinked = true;
}

export class CreateKnowledgeBaseDto {
  @Transform(trim) @IsString() @Matches(/\S/) @MinLength(2) @MaxLength(200)
  name!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  description?: string;
}

export class UpdateKnowledgeBaseDto {
  @Transform(trim) @IsOptional() @IsString() @Matches(/\S/) @MinLength(2) @MaxLength(200)
  name?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsBoolean()
  autoAddEligibleSources?: boolean;
}

export class KnowledgeBaseSourceQueryDto {
  @Transform(trim) @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @Transform(trim) @IsOptional() @IsIn(KNOWLEDGE_SECTIONS)
  knowledgeSection?: (typeof KNOWLEDGE_SECTIONS)[number];

  @Transform(trim) @IsOptional() @IsIn(['WEBSITE', 'FAQ', 'TEXT'])
  type?: 'WEBSITE' | 'FAQ' | 'TEXT';

  @Transform(trim) @IsOptional() @IsIn(['REGISTERED', 'DISABLED', 'ARCHIVED'])
  status?: 'REGISTERED' | 'DISABLED' | 'ARCHIVED';

  @Transform(trim) @IsOptional() @IsIn(['NOT_PROCESSED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'])
  processingStatus?: 'NOT_PROCESSED' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

  @Type(() => Number) @IsOptional() @IsInt() @Min(1)
  page = 1;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize = 20;

  @Transform(trim) @IsOptional() @IsIn(['name', 'updatedAt', 'createdAt'])
  sort: 'name' | 'updatedAt' | 'createdAt' = 'updatedAt';

  @Transform(trim) @IsOptional() @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';
}

export class BulkKnowledgeBaseSourcesDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  sourceIds!: string[];
}

export class ReplaceAssistantKnowledgeBasesDto {
  @IsArray() @IsUUID('4', { each: true })
  knowledgeBaseIds!: string[];
}
