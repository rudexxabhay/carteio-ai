import { IsBoolean, IsByteLength, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { UpdateAssistantDto } from './assistant.dto';
// Match the Playground textarea's 2,000 UTF-16-unit limit. Eight KiB also
// bounds the UTF-8 representation while leaving headroom for multilingual input.
export const PLAYGROUND_MESSAGE_MAX_CHARS = 2_000;
export const PLAYGROUND_MESSAGE_MAX_BYTES = 8_000;

export class UpdateAssistantPlaygroundDto extends UpdateAssistantDto {}

export class PlaygroundChatDto {
  @IsOptional() @IsBoolean()
  diagnosticCapture?: boolean;

  @IsString()
  @Matches(/\S/u, { message: 'Enter a message containing at least one non-whitespace character.' })
  @MinLength(1)
  @MaxLength(PLAYGROUND_MESSAGE_MAX_CHARS)
  @IsByteLength(1, PLAYGROUND_MESSAGE_MAX_BYTES)
  message!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  sessionId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  clientTurnId?: string;
}

export class PlaygroundDiagnosticCaptureDto {
  @IsBoolean()
  enabled!: boolean;
}
