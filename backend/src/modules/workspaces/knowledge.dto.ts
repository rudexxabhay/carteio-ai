import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateWebsiteSourceDto {
  @Transform(trim) @IsString() @MinLength(8) @MaxLength(2048)
  sourceUrl!: string;

  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(200)
  name?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  description?: string;
}

export class CreateFaqSourceDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200)
  question!: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(20000)
  answer!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @Transform(trim) @IsOptional() @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  languageHint?: string;
}

export class CreateTextSourceDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  title!: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(50000)
  content!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @Transform(trim) @IsOptional() @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  languageHint?: string;
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

  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(20000)
  answer?: string;

  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(50000)
  content?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  category?: string;

  @Transform(trim) @IsOptional() @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  languageHint?: string;
}

export class KnowledgeListQueryDto {
  @Transform(trim) @IsOptional() @IsString() @IsIn(['WEBSITE', 'FAQ', 'TEXT'])
  type?: 'WEBSITE' | 'FAQ' | 'TEXT';
}
