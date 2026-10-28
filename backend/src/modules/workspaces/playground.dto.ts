import { ArrayMaxSize, IsArray, IsBoolean, IsByteLength, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateAssistantDto } from './assistant.dto';
import type { ConversationProvider } from './conversation-provider.service';

const providers = ['groq', 'gemini', 'openai', 'openrouter'] as const;
// Match the Playground textarea's 2,000 UTF-16-unit limit. Eight KiB also
// bounds the UTF-8 representation while leaving headroom for multilingual input.
export const PLAYGROUND_MESSAGE_MAX_CHARS = 2_000;
export const PLAYGROUND_MESSAGE_MAX_BYTES = 8_000;

export class ProviderFallbackDto {
  @IsIn(providers)
  provider!: ConversationProvider;

  @IsString() @MaxLength(120) @Matches(/^(?!.*(?:gsk_|sk-|sk_|AIza|sess-|Bearer\s))[A-Za-z0-9._:/-]+$/i)
  model!: string;
}

export class UpdateAssistantPlaygroundDto extends UpdateAssistantDto {
  @IsOptional() @IsIn(['MANUAL', 'AUTO_FALLBACK'])
  providerMode?: 'MANUAL' | 'AUTO_FALLBACK';

  @IsOptional() @IsArray() @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => ProviderFallbackDto)
  providerFallbacks?: ProviderFallbackDto[];
}

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
