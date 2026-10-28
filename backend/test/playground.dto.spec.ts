import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlaygroundChatDto, UpdateAssistantPlaygroundDto } from '../src/modules/workspaces/playground.dto';

describe('PlaygroundChatDto', () => {
  it.each([{}, { message: '' }, { message: ' \t\n\u00a0' }])('rejects a missing or non-meaningful message', async (payload) => {
    const dto = plainToInstance(PlaygroundChatDto, payload);
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts bounded multilingual UTF-8 text including emoji and combining marks', async () => {
    const dto = plainToInstance(PlaygroundChatDto, { message: 'Café नमस्ते مرحبا 中文 😀 e\u0301'.repeat(70) });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects messages above the existing Playground character limit', async () => {
    const dto = plainToInstance(PlaygroundChatDto, { message: '漢'.repeat(2001) });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('requires v4 identifiers when session or turn identifiers are supplied', async () => {
    const validId = '11111111-1111-4111-8111-111111111111';
    const freshChat = plainToInstance(PlaygroundChatDto, { message: 'Hello' });
    const validRetry = plainToInstance(PlaygroundChatDto, { message: 'Hello', sessionId: validId, clientTurnId: validId });
    const invalidRetry = plainToInstance(PlaygroundChatDto, { message: 'Hello', sessionId: 'session-one', clientTurnId: null });
    expect(await validate(freshChat)).toHaveLength(0);
    expect(await validate(validRetry)).toHaveLength(0);
    expect(await validate(invalidRetry)).not.toHaveLength(0);
  });

  it('rejects client authorization fields before controller work and does not echo submitted content', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } });
    const rejected = await pipe.transform({ message: 'private text must not be echoed', organizationId: 'foreign-tenant' }, { type: 'body', metatype: PlaygroundChatDto }).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(rejected)).not.toContain('private text must not be echoed');
    expect(JSON.stringify(rejected)).not.toContain('foreign-tenant');
  });
});

describe('assistant provider fallback DTO', () => {
  it('accepts an explicitly configured OpenRouter model route without restricting model IDs', async () => {
    const dto = plainToInstance(UpdateAssistantPlaygroundDto, { providerMode: 'AUTO_FALLBACK', providerFallbacks: [{ provider: 'openrouter', model: 'vendor/model-v9:free' }] });
    expect(await validate(dto)).toHaveLength(0);
  });
});
