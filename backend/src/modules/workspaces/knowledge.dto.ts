import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { KNOWLEDGE_SECTIONS } from './knowledge-sections';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateWebsiteSourceDto {
  @Transform(trim) @IsString() @MinLength(8) @MaxLength(2048)
  sourceUrl!: string;

  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(200)
  name?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @IsOptional() @IsIn(['INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE'])
  visibility?: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';

  @Transform(trim) @IsOptional() @IsIn(KNOWLEDGE_SECTIONS)
  knowledgeSection?: (typeof KNOWLEDGE_SECTIONS)[number];
}

export class CreateFaqSourceDto {
  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(200)
  question!: string;

  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(20000)
  answer!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @Transform(trim) @IsOptional() @IsIn(KNOWLEDGE_SECTIONS)
  knowledgeSection?: (typeof KNOWLEDGE_SECTIONS)[number];

  @Transform(trim) @IsOptional() @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  languageHint?: string;

  @Transform(trim) @IsOptional() @IsIn(['INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE'])
  visibility?: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';
}

export class CreateFaqBatchDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CreateFaqSourceDto)
  faqs!: CreateFaqSourceDto[];
}

export class FaqImportCommitDto {
  @Transform(trim) @IsIn(['SKIP_EXISTING', 'REJECT_DUPLICATES'])
  duplicatePolicy!: 'SKIP_EXISTING' | 'REJECT_DUPLICATES';

  @Transform(trim) @IsOptional() @IsIn(['INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE'])
  defaultVisibility?: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';

  @Transform(trim) @IsOptional() @IsIn(KNOWLEDGE_SECTIONS)
  knowledgeSection?: (typeof KNOWLEDGE_SECTIONS)[number];
}

export class BulkArchiveSourcesDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  sourceIds!: string[];
}

export class BulkPublicFaqSourcesDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  sourceIds!: string[];
}

export class ActivateCustomerKnowledgeDto {
  @IsUUID('4')
  assistantId!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  sourceIds?: string[];
}

export class CreateTextSourceDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  title!: string;

  @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(50000)
  content!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @Transform(trim) @IsOptional() @IsIn(KNOWLEDGE_SECTIONS)
  knowledgeSection?: (typeof KNOWLEDGE_SECTIONS)[number];

  @Transform(trim) @IsOptional() @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  languageHint?: string;

  @Transform(trim) @IsOptional() @IsIn(['INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE'])
  visibility?: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';
}

export class UpdateKnowledgeSourceDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(200)
  name?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @IsOptional() @IsString() @MinLength(8) @MaxLength(2048)
  sourceUrl?: string;

  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
  question?: string;

  @IsOptional() @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(20000)
  answer?: string;

  @IsOptional() @IsString() @Matches(/\S/) @MinLength(1) @MaxLength(50000)
  content?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @Transform(trim) @IsOptional() @IsIn(KNOWLEDGE_SECTIONS)
  knowledgeSection?: (typeof KNOWLEDGE_SECTIONS)[number];

  @Transform(trim) @IsOptional() @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  languageHint?: string;

  @Transform(trim) @IsOptional() @IsIn(['INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE'])
  visibility?: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';
}

export class KnowledgeListQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100000)
  page?: number;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize?: number;
  @IsOptional() @IsString() @MaxLength(200)
  search?: string;
  @IsOptional() @IsIn([...KNOWLEDGE_SECTIONS, 'UNCLASSIFIED'])
  section?: string;
  @IsOptional() @IsIn(['NOT_PROCESSED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'])
  processingStatus?: string;
  @Transform(trim) @IsOptional() @IsString() @IsIn(['WEBSITE', 'FAQ', 'TEXT'])
  type?: 'WEBSITE' | 'FAQ' | 'TEXT';
}

export class UploadKnowledgePdfDto {
  @IsUUID('4') knowledgeBaseId!: string;
  @IsIn(KNOWLEDGE_SECTIONS) knowledgeSection!: (typeof KNOWLEDGE_SECTIONS)[number];
  @IsIn(['INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE']) visibility!: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';
}

export class KnowledgeSearchPreviewDto {
  @IsUUID('4') assistantId!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) query!: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) limit?: number;
}

export class WebsitePagesQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(10000)
  page?: number;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(50)
  pageSize?: number;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @Transform(trim) @IsOptional() @IsUUID('4')
  sourceId?: string;
}

export class KnowledgeChunksQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(10000)
  page?: number;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(50)
  pageSize?: number;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(200)
  search?: string;
}

export class WebsiteSyncSettingsDto {
  @Transform(trim) @IsOptional() @IsIn(['MANUAL', 'DAILY', 'WEEKLY'])
  syncPolicy?: 'MANUAL' | 'DAILY' | 'WEEKLY';

  @IsOptional() @IsBoolean()
  paused?: boolean;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(2048) @Matches(/^\/(?!\/)[^?#]*$/)
  pathPrefix?: string | null;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  maxPages?: number;

  @IsOptional() @IsInt() @Min(0) @Max(8)
  maxDepth?: number;
}
