import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ASSISTANT_SYSTEM_INSTRUCTIONS_MAX_LENGTH, CreateAssistantDto, UpdateAssistantDto } from '../src/modules/workspaces/assistant.dto';

describe('assistant systemInstructions length contract', () => {
  it.each([
    ['create', CreateAssistantDto, (systemInstructions: string) => ({ name: 'Support', systemInstructions })],
    ['update', UpdateAssistantDto, (systemInstructions: string) => ({ systemInstructions })],
  ] as const)('accepts exactly the database-backed maximum for %s without changing instruction formatting', async (_label, dto, input) => {
    const submitted = ` \n${'x'.repeat(ASSISTANT_SYSTEM_INSTRUCTIONS_MAX_LENGTH - 4)}\n `;
    const instance = plainToInstance(dto, input(submitted));
    const errors = await validate(instance);
    expect(errors.find(({ property }) => property === 'systemInstructions')).toBeUndefined();
    expect(instance.systemInstructions).toBe(submitted);
  });

  it.each([
    ['create', CreateAssistantDto, (systemInstructions: string) => ({ name: 'Support', systemInstructions })],
    ['update', UpdateAssistantDto, (systemInstructions: string) => ({ systemInstructions })],
  ] as const)('rejects instructions beyond the database-backed maximum for %s with a safe actionable constraint', async (_label, dto, input) => {
    const instance = plainToInstance(dto, input('x'.repeat(ASSISTANT_SYSTEM_INSTRUCTIONS_MAX_LENGTH + 1)));
    const errors = await validate(instance);
    expect(errors.find(({ property }) => property === 'systemInstructions')?.constraints).toMatchObject({
      maxLength: 'Assistant instructions must be 10,000 characters or fewer.',
    });
  });
});
