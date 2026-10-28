import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConversationOrchestrator } from './conversation-orchestrator.service';

describe('ConversationOrchestrator trusted customer adapter', () => {
  const organizationId = '10000000-0000-4000-8000-000000000001';
  const assistantId = '20000000-0000-4000-8000-000000000002';
  const conversationId = '30000000-0000-4000-8000-000000000003';
  const visitorSessionId = 'trusted-session-token-long-enough-0123456789';
  const turnKey = 'customer-turn-key-0001';
  let db: any;
  let engine: ConversationOrchestrator;

  beforeEach(() => {
    const supportMessage = {
      findFirst: jest.fn(async ({ where }: any) => where.kind === 'CUSTOMER'
        ? { id: 'customer-message', content: 'What is your return policy?', createdAt: new Date('2026-10-14T10:00:00Z') }
        : null),
      findMany: jest.fn().mockResolvedValue([{ id: 'customer-message', kind: 'CUSTOMER', content: 'What is your return policy?', idempotencyKey: turnKey, createdAt: new Date('2026-10-14T10:00:00Z') }]),
    };
    const supportConversation = { findFirst: jest.fn().mockResolvedValue({ id: conversationId, messageCount: 1 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    db = {
      supportConversation,
      supportMessage,
      chatbot: { findFirst: jest.fn().mockResolvedValue({ id: assistantId, organizationId, status: 'ACTIVE', name: 'Carteio', businessPurpose: 'Customer support', systemInstructions: 'Use a warm Hinglish tone.', defaultLanguage: 'auto', responseTone: 'friendly', responseStyle: 'concise', fallbackMessage: 'Please contact support.', greetingMessage: 'Namaste', escalationMessage: 'A support teammate can help.', updatedAt: new Date('2026-10-23T00:00:00Z') }) },
      organizationMembership: { findFirst: jest.fn().mockResolvedValue({ userId: 'workspace-owner', organization: { slug: 'workspace' } }) },
      $transaction: jest.fn(async (callback: any) => callback({
        supportMessage: {
          createMany: jest.fn().mockImplementation(({ data }: any) => { (db.persistedAI ??= []).push(...data); return { count: 1 }; }),
          findFirst: jest.fn().mockImplementation(async ({ where }: any) => ({ id: 'ai-message', content: 'Our policy allows returns within 30 days.', createdAt: new Date('2026-10-14T10:00:01Z'), where })),
        },
        supportConversation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      })),
    };
    engine = new ConversationOrchestrator(db as any, {} as any, undefined, {} as any, { handleInterpretedCustomerTurn: jest.fn() } as any);
    jest.spyOn(engine as any, 'enforcePlaygroundRate').mockResolvedValue(undefined);
    jest.spyOn(engine, 'executeSharedAI').mockImplementation(async (input: any) => {
      expect(input.context.channel).toBe('CUSTOMER_INTERNAL');
      expect(input.assistant).toMatchObject({ systemInstructions: 'Use a warm Hinglish tone.', defaultLanguage: 'auto', responseTone: 'friendly', responseStyle: 'concise' });
      const saved = await input.persistTurn({ reply: 'Our policy allows returns within 30 days.', responseCategory: 'grounded_answer', answerOrigin: 'MODEL_GENERATED', sources: [{ reference: 'S1' }], providerUsed: 'groq', modelUsed: 'model-x' });
      return { sessionId: conversationId, messageId: saved.id, reply: 'Our policy allows returns within 30 days.' } as any;
    });
  });

  it('reuses shared execution and persists an AI message in the canonical support conversation', async () => {
    const result = await engine.processTrustedCustomerTurn({ organizationId, assistantId, conversationId, visitorSessionId, channel: 'INTERNAL', idempotencyKey: turnKey, content: 'What is your return policy?' });
    expect(result).toMatchObject({ conversationId, reply: 'Our policy allows returns within 30 days.' });
    expect(engine.executeSharedAI).toHaveBeenCalledTimes(1);
    expect(db.persistedAI[0]).toMatchObject({ organizationId, conversationId, kind: 'AI', provider: 'groq', model: 'model-x', answerOrigin: 'MODEL_GENERATED', responseCategory: 'grounded_answer' });
    expect(db.supportMessage.findMany.mock.calls[0][0].where.kind.in).toEqual(['CUSTOMER', 'AI']);
  });

  it('rejects messages that are not persisted CUSTOMER messages, including business-team replies', async () => {
    db.supportMessage.findFirst.mockResolvedValue(null);
    await expect(engine.processTrustedCustomerTurn({ organizationId, assistantId, conversationId, visitorSessionId, channel: 'INTERNAL', idempotencyKey: turnKey, content: 'Owner reply' })).rejects.toBeInstanceOf(NotFoundException);
    expect(engine.executeSharedAI).not.toHaveBeenCalled();
    expect(db.supportConversation.updateMany).not.toHaveBeenCalled();
  });

  it('returns the persisted AI response without running inference again for a duplicate turn', async () => {
    db.supportMessage.findFirst.mockImplementationOnce(async () => ({ id: 'customer-message', content: 'What is your return policy?', createdAt: new Date() })).mockImplementationOnce(async () => ({ id: 'ai-message', content: 'Already answered.', provider: 'groq', model: 'model-x', responseCategory: 'grounded_answer', answerOrigin: 'MODEL_GENERATED', sourceRefs: [], createdAt: new Date() }));
    const replay = await engine.processTrustedCustomerTurn({ organizationId, assistantId, conversationId, visitorSessionId, channel: 'INTERNAL', idempotencyKey: turnKey, content: 'What is your return policy?' });
    expect(replay).toMatchObject({ messageId: 'ai-message', reply: 'Already answered.', replay: true });
    expect(engine.executeSharedAI).not.toHaveBeenCalled();
    expect(db.supportConversation.updateMany).not.toHaveBeenCalled();
  });

  it('serializes concurrent customer turns with the support conversation lease', async () => {
    db.supportConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(engine.processTrustedCustomerTurn({ organizationId, assistantId, conversationId, visitorSessionId, channel: 'INTERNAL', idempotencyKey: turnKey, content: 'What is your return policy?' })).rejects.toBeInstanceOf(ConflictException);
    expect(engine.executeSharedAI).not.toHaveBeenCalled();
  });

  it('preserves the original execution failure when trusted-turn lease cleanup also fails', async () => {
    const executionError = new Error('execution failed');
    const cleanupError = Object.assign(new Error('private database detail'), { code: 'P2022' });
    db.supportConversation.updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(cleanupError);
    (engine.executeSharedAI as jest.Mock).mockRejectedValue(executionError);
    const errorLog = jest.spyOn((engine as any).logger, 'error').mockImplementation(() => undefined);

    await expect(engine.processTrustedCustomerTurn({ organizationId, assistantId, conversationId, visitorSessionId, channel: 'INTERNAL', idempotencyKey: turnKey, content: 'What is your return policy?', requestId: 'trace-cleanup' })).rejects.toBe(executionError);

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"failureOperation":"SESSION_RELEASE"'));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private database detail');
  });

  it('carries persisted clarification metadata into chronological widget context without duplicating the current turn', async () => {
    const previousKey = 'previous-turn-key-0001';
    const previousAnswer = `ai:${createHash('sha256').update(previousKey).digest('hex')}`;
    db.supportMessage.findMany.mockResolvedValue([
      { id: 'current-user', kind: 'CUSTOMER', content: 'What is your return policy?', idempotencyKey: turnKey, createdAt: new Date('2026-10-14T10:00:00Z') },
      { id: 'prior-answer', kind: 'AI', content: 'Which item?', responseCategory: 'source_clarification', idempotencyKey: previousAnswer, createdAt: new Date('2026-10-14T09:59:59Z') },
      { id: 'prior-user', kind: 'CUSTOMER', content: 'A question about an item', idempotencyKey: previousKey, createdAt: new Date('2026-10-14T09:59:58Z') },
    ]);
    await engine.processTrustedCustomerTurn({ organizationId, assistantId, conversationId, visitorSessionId, channel: 'INTERNAL', idempotencyKey: turnKey, content: 'What is your return policy?' });
    const input = (engine.executeSharedAI as jest.Mock).mock.calls[0][0];
    expect(input.session.turns).toEqual([
      { role: 'user', content: 'A question about an item' },
      { role: 'assistant', content: 'Which item?', responseCategory: 'source_clarification' },
    ]);
    expect((engine as any).enforcePlaygroundRate).toHaveBeenCalledWith(organizationId, createHash('sha256').update(visitorSessionId).digest('hex'), 'visitor');
  });
});
