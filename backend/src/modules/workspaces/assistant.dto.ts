import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const tones = ['professional', 'friendly', 'concise', 'empathetic'] as const;

export class CreateAssistantDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  name!: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(500)
  businessPurpose?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000)
  systemInstructions?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  defaultLanguage?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @IsIn(tones)
  responseTone?: typeof tones[number];

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(500)
  fallbackMessage?: string;
}

export class UpdateAssistantDto {
  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(2) @MaxLength(200)
  name?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(1000)
  description?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(500)
  businessPurpose?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(10000)
  systemInstructions?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/) @MaxLength(35)
  defaultLanguage?: string;

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @IsIn(tones)
  responseTone?: typeof tones[number];

  @Transform(trim) @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(500)
  fallbackMessage?: string;
}
