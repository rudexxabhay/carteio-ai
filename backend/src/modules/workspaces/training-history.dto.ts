import { Transform, Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class TrainingHistoryQueryDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1)
  page = 1;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize = 25;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(120)
  action?: string;

  @Transform(trim) @IsOptional() @IsDateString()
  from?: string;

  @Transform(trim) @IsOptional() @IsDateString()
  to?: string;
}
