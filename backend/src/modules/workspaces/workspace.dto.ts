import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateWorkspaceDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  name!: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120)
  slug!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(2048)
  websiteUrl?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(80)
  businessType?: string;
}

export class UpdateWorkspaceDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(200)
  name?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(2048)
  websiteUrl?: string | null;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(80)
  businessType?: string | null;
}

export class WorkspacePaginationDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(10000)
  page = 1;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize = 25;
}
