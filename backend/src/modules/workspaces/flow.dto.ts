import { Transform } from 'class-transformer';
import { IsByteLength, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { PLAYGROUND_MESSAGE_MAX_BYTES, PLAYGROUND_MESSAGE_MAX_CHARS } from './playground.dto';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateFlowDto {
  @IsUUID('4') assistantId!: string;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  name!: string;

  @IsObject() graph!: Record<string, unknown>;
}

export class UpdateFlowDto {
  @IsInt() @Min(1)
  expectedVersion!: number;

  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(200)
  name?: string;

  @IsOptional() @IsObject()
  graph?: Record<string, unknown>;
}

export class FlowRunDto {
  @IsString() @Matches(/\S/u) @MinLength(1) @MaxLength(PLAYGROUND_MESSAGE_MAX_CHARS) @IsByteLength(1, PLAYGROUND_MESSAGE_MAX_BYTES)
  message!: string;

  @IsOptional() @IsUUID('4')
  clientTurnId?: string;
}
