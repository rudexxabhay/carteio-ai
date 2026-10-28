import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaygroundChat } from '../pages/training/PlaygroundChat';
import { ApiError } from '../services/api/client';
import { getPlaygroundConversation, getProviderConfigurationStatus, sendPlaygroundMessage, updateAssistant, type Assistant } from '../services/api/assistants';

vi.mock('../services/api/assistants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/assistants')>();
  return {
    ...actual,
    getPlaygroundConversation: vi.fn().mockResolvedValue({ sessionId: 'session-1', messages: [] }),
    getProviderConfigurationStatus: vi.fn().mockResolvedValue({
      groq: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      gemini: { keyConfigured: true, status: 'READY_FOR_TESTING', supportedModels: [] },
      openai: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      openrouter: { keyConfigured: true, status: 'READY_FOR_TESTING', modelValidation: null },
      effective: { provider: 'groq', model: 'openai/gpt-oss-20b', status: 'READY_FOR_TESTING', configurationValid: true, keyConfigured: true, ready: true },
    }),
    sendPlaygroundMessage: vi.fn(),
    updateAssistant: vi.fn(),
  };
});

const assistant = {
  id: 'assistant-1', organizationId: 'org-1', createdById: 'user-1', name: 'Support', description: null,
  aiProvider: 'groq', aiModel: 'test-model', businessPurpose: null, systemInstructions: null,
  effectiveProviderConfiguration: { provider: 'groq', model: 'openai/gpt-oss-20b', status: 'READY_FOR_TESTING', configurationValid: true, keyConfigured: true, ready: true },
  defaultLanguage: 'auto', responseTone: 'friendly', responseStyle: 'balanced', fallbackMessage: 'Contact support.',
  greetingMessage: null, escalationMessage: null, status: 'active', createdAt: '', updatedAt: '',
} as Assistant;

describe('PlaygroundChat', () => {
  let clipboardWrite: ReturnType<typeof vi.fn>;
  afterEach(() => cleanup());

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionStorage.clear();
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    vi.mocked(getPlaygroundConversation).mockResolvedValue({ sessionId: 'session-1', messages: [] });
    vi.mocked(getProviderConfigurationStatus).mockResolvedValue({
      groq: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      gemini: { keyConfigured: true, status: 'READY_FOR_TESTING', supportedModels: [] },
      openai: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      openrouter: { keyConfigured: true, status: 'READY_FOR_TESTING', modelValidation: null },
      effective: { provider: 'groq', model: 'openai/gpt-oss-20b', status: 'READY_FOR_TESTING', configurationValid: true, keyConfigured: true, ready: true },
    });
  });

  it('requests the newest persisted page after refresh and keeps chronological display', async () => {
    const sessionId = '99999999-9999-4999-8999-999999999999';
    sessionStorage.setItem('carteio-playground-session:acme:assistant-1', sessionId);
    vi.mocked(getPlaygroundConversation).mockResolvedValue({ sessionId, latest: true, messages: [
      { id: 'latest-user', role: 'user', content: 'The latest customer correction', sources: [], createdAt: '2026-10-26T00:00:00Z' },
      { id: 'latest-ai', role: 'assistant', content: 'The latest assistant answer', sources: [], responseType: 'social', createdAt: '2026-10-26T00:00:01Z' },
    ] });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    const question = await screen.findByText('The latest customer correction');
    const answer = await screen.findByText('The latest assistant answer');
    expect(question.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getPlaygroundConversation).toHaveBeenCalledWith('acme', 'assistant-1', sessionId, expect.any(AbortSignal), { latest: true });
    expect(sessionStorage.getItem('carteio-playground-session:acme:assistant-1')).toBe(sessionId);
  });

  it('copies all paginated history in order from the header and Copy History actions', async () => {
    const sessionId = '55555555-5555-4555-8555-555555555555';
    sessionStorage.setItem('carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]', sessionId);
    const first = { id: 'u1', role: 'user' as const, content: 'Tumhare paas products?', sources: [], createdAt: '2026-10-23T10:15:00Z' };
    const second = { id: 'a1', role: 'assistant' as const, content: 'Theek hai.\nदूसरी पंक्ति', sources: [], provenance: 'SYSTEM_RESPONSE' as const, responseType: 'social', createdAt: '2026-10-23T10:16:00Z' };
    vi.mocked(getPlaygroundConversation).mockImplementation(async (_slug, _assistantId, id, _signal, page) => ({
      sessionId: id,
      offset: page?.offset ?? 0,
      limit: page?.limit ?? 40,
      hasMore: page?.offset === 1 ? false : true,
      nextOffset: page?.offset === 1 ? null : 1,
      messages: page?.offset === 1 ? [second] : [first],
    }));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText('Tumhare paas products?');
    await screen.findByRole('button', { name: 'Copy History' });
    await user.click(screen.getByRole('button', { name: 'Copy entire conversation' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    const headerCopy = clipboardWrite.mock.calls[0]?.[0] as string;
    expect(headerCopy.indexOf('Tumhare paas')).toBeLessThan(headerCopy.indexOf('Theek hai.'));
    expect(headerCopy).toContain('Response origin: System response');
    expect(headerCopy).toContain('दूसरी पंक्ति');
    expect(getPlaygroundConversation).toHaveBeenCalledWith('acme', 'assistant-1', sessionId, expect.any(AbortSignal), { offset: 1, limit: 100 });

    await user.click(screen.getByRole('button', { name: 'Copy History' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(2));
    expect(String(clipboardWrite.mock.calls[1]?.[0]).replace(/^Exported:.*$/m, '')).toBe(headerCopy.replace(/^Exported:.*$/m, ''));
  });

  it('clearly warns when a conversation exceeds the safe 1000-message export cap', async () => {
    const sessionId = '66666666-6666-4666-8666-666666666666';
    sessionStorage.setItem('carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]', sessionId);
    const initialMessage = { id: 'visible-1', role: 'user' as const, content: 'Visible message', sources: [], createdAt: '2026-10-23T10:15:00Z' };
    vi.mocked(getPlaygroundConversation).mockImplementation(async (_slug, _assistantId, id, _signal, page) => {
      const offset = page?.offset ?? 0;
      if (!page || page.latest) return { sessionId: id, messages: [initialMessage] };
      const batch = Array.from({ length: 100 }, (_, index) => ({ id: `m-${offset + index}`, role: 'user' as const, content: `Turn ${offset + index}`, sources: [], createdAt: '2026-10-23T10:15:00Z' }));
      return { sessionId: id, offset, limit: 100, hasMore: true, nextOffset: offset + batch.length, messages: batch };
    });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText('Visible message');
    await user.click(await screen.findByRole('button', { name: 'Copy History' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    expect(clipboardWrite.mock.calls[0]?.[0]).toContain('EXPORT INCOMPLETE');
    expect(await screen.findByRole('status')).toHaveTextContent('export incomplete at the safe limit');
    expect(vi.mocked(getPlaygroundConversation).mock.calls.filter((call) => call[4]?.limit === 100)).toHaveLength(10);
  });

  it('does not copy a pending export after switching to another assistant conversation', async () => {
    const sessionId = '77777777-7777-4777-8777-777777777777';
    sessionStorage.setItem('carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]', sessionId);
    vi.mocked(getPlaygroundConversation).mockResolvedValue({ sessionId, messages: [{ id: 'visible', role: 'user', content: 'Current chat only', sources: [], createdAt: '2026-10-23T10:15:00Z' }] });
    let resolvePage: ((value: Awaited<ReturnType<typeof getPlaygroundConversation>>) => void) | undefined;
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    const view = render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText('Current chat only');
    vi.mocked(getPlaygroundConversation).mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }));
    const callsBeforeCopy = vi.mocked(getPlaygroundConversation).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Copy entire conversation' }));
    await user.click(screen.getByRole('button', { name: 'Copy History' }));
    expect(getPlaygroundConversation).toHaveBeenCalledTimes(callsBeforeCopy + 1);
    view.rerender(<PlaygroundChat workspaceSlug="acme" assistant={{ ...assistant, id: 'assistant-2' }} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    resolvePage?.({ sessionId, offset: 0, limit: 100, hasMore: false, nextOffset: null, messages: [{ id: 'visible', role: 'user', content: 'Current chat only', sources: [], createdAt: '2026-10-23T10:15:00Z' }] });
    await waitFor(() => expect(getPlaygroundConversation).toHaveBeenCalled());
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it('copies only the selected message text and reports clipboard failure', async () => {
    clipboardWrite.mockRejectedValueOnce(new Error('clipboard denied'));
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'session-copy', messageId: 'reply-copy', reply: 'Reply only\nदूसरी पंक्ति', retrievalMode: 'not_required', responseLanguage: 'Hinglish', sources: [], provenance: 'AI_GENERATED' });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Question to keep separate');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Reply only', { exact: false });
    const copyButtons = screen.getAllByRole('button', { name: 'Copy message' });
    await user.click(copyButtons[1]!);
    expect(clipboardWrite).toHaveBeenCalledWith('Reply only\nदूसरी पंक्ति');
    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard access failed');
  });

  it('offers diagnostic export only when an authorized manager has trace data', async () => {
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({
      sessionId: 'session-diagnostics', messageId: 'diagnostic-message', reply: 'Done.', retrievalMode: 'not_required', responseLanguage: 'English', sources: [], provenance: 'AI_GENERATED', providerUsed: 'openrouter', modelUsed: 'google/gemini-2.5-flash',
      diagnostics: { traceId: 'trace-copy-1', startedAt: '', finishedAt: '', totalLatencyMs: 90, finalSource: 'AI_GENERATED', events: [{ sequence: 1, at: '', operation: 'ANSWER_GENERATION', outcome: 'COMPLETED', status: 'completed', durationMs: 90, provider: 'openrouter', model: 'google/gemini-2.5-flash' }], retrieval: { attempted: false, queryHash: null, mode: 'not_required', audience: null, eligibilityStatus: 'NOT_EVALUATED', eligibleSourceCount: 0, resultCount: 0 }, tools: [], evidence: [] },
    });
    vi.mocked(getPlaygroundConversation).mockResolvedValue({ sessionId: 'session-diagnostics', messages: [{ id: 'diagnostic-message', role: 'assistant', content: 'Done.', createdAt: '2026-10-23T10:16:00Z', sources: [], provenance: 'AI_GENERATED' }] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    const view = render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Copy Chat + Diagnostics' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    expect(clipboardWrite.mock.calls[0]?.[0]).toContain('trace-copy-1');
    expect(clipboardWrite.mock.calls[0]?.[0]).toContain('ANSWER_GENERATION');

    view.rerender(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager={false} onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.queryByRole('button', { name: 'Copy Chat + Diagnostics' })).toBeNull();
  });

  it('sends a real chat request and displays the returned answer and source citation', async () => {
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'session-1', reply: 'Delivery takes three days.', retrievalMode: 'lexical_only', responseLanguage: 'English', sources: [{ reference: 'S1', title: 'Delivery FAQ', type: 'FAQ', locator: 'Delivery FAQ' }] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'How long is delivery?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Delivery takes three days.')).toBeTruthy();
    expect(screen.getByText('[S1] Delivery FAQ')).toBeTruthy();
    expect(screen.getByText('FAQ · Delivery FAQ')).toBeTruthy();
    expect(screen.getByText('Delivery takes three days.').getAttribute('dir')).toBe('auto');
    expect(screen.getByRole('textbox', { name: 'Message your assistant' }).getAttribute('dir')).toBe('auto');
    expect(getPlaygroundConversation).not.toHaveBeenCalled();
    expect(sendPlaygroundMessage).toHaveBeenCalledWith('acme', 'assistant-1', 'How long is delivery?', undefined, expect.any(String), expect.any(AbortSignal));
  });

  it.each([
    ['AI_GENERATED', 'AI generated'],
    ['KNOWLEDGE_GROUNDED', 'Source unavailable'],
    ['SYSTEM_RESPONSE', 'System response'],
  ] as const)('renders trusted %s response provenance', async (provenance, label) => {
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'session-1', reply: 'A response.', retrievalMode: 'not_required', responseLanguage: 'English', sources: [], provenance });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Please help');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it('shows neutral provenance for legacy history without trusted provenance metadata', async () => {
    const storageKey = 'carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]';
    const sessionId = '11111111-1111-4111-8111-111111111111';
    sessionStorage.setItem(storageKey, sessionId);
    vi.mocked(getPlaygroundConversation).mockResolvedValue({ sessionId, messages: [{ id: 'legacy-message', role: 'assistant', content: 'Older saved response.', sources: [], responseType: 'social', createdAt: '2026-10-12T00:00:00.000Z' }] });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    expect(await screen.findByText('Older saved response.')).toBeTruthy();
    expect(screen.getByText('Source unavailable')).toBeTruthy();
    expect(screen.queryByText('AI generated')).toBeNull();
    expect(screen.queryByText('System response')).toBeNull();
  });

  it('keeps no-match feedback inside the assistant answer instead of appending retrieval diagnostics', async () => {
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'session-1', reply: 'I could not confirm that from the store information. What product can I help you find?', retrievalMode: 'lexical_only', responseLanguage: 'English', sources: [], responseType: 'knowledge_fallback', fallbackReason: 'no_relevant_match', provenance: 'AI_GENERATED' });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'What is the weather?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('I could not confirm that from the store information. What product can I help you find?')).toBeTruthy();
    expect(screen.queryByText('No matching public, ready source was found for this question.')).toBeNull();
  });

  it('restores trusted response provenance with the saved chat history', async () => {
    const storageKey = 'carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]';
    const sessionId = '22222222-2222-4222-8222-222222222222';
    sessionStorage.setItem(storageKey, sessionId);
    vi.mocked(getPlaygroundConversation).mockResolvedValue({ sessionId, messages: [{ id: 'grounded-history', role: 'assistant', content: 'Saved public answer.', sources: [{ reference: 'S1', title: 'Returns FAQ', type: 'FAQ', locator: null }], responseType: 'grounded_answer', provenance: 'KNOWLEDGE_GROUNDED', providerUsed: 'gemini', modelUsed: 'gemini-2.5-flash', createdAt: '2026-10-12T00:00:00.000Z' }] });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    expect(await screen.findByText('Saved public answer.')).toBeTruthy();
    expect(screen.getByText('AI generated · Knowledge Base')).toBeTruthy();
    expect(screen.getByText(/Returns FAQ/)).toBeTruthy();
    expect(screen.getByText('Generated by Google Gemini · gemini-2.5-flash')).toBeTruthy();
  });

  it('restores the same authorized session after provider configuration changes', async () => {
    const sessionId = '33333333-3333-4333-8333-333333333333';
    sessionStorage.setItem('carteio-playground-session:acme:assistant-1:groq:old-model:MANUAL:[]', sessionId);
    vi.mocked(getPlaygroundConversation).mockResolvedValue({ sessionId, messages: [{ id: 'restored-session-message', role: 'assistant', content: 'Existing saved conversation.', sources: [], responseType: 'social', createdAt: '2026-10-12T00:00:00.000Z' }] });
    render(<PlaygroundChat workspaceSlug="acme" assistant={{ ...assistant, effectiveProviderConfiguration: { provider: 'gemini', model: 'gemini-2.5-flash', status: 'READY_FOR_TESTING', configurationValid: true, keyConfigured: true, ready: true } }} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await waitFor(() => expect(getPlaygroundConversation).toHaveBeenCalledWith('acme', 'assistant-1', sessionId, expect.any(AbortSignal), { latest: true }));
    expect(await screen.findByText('Existing saved conversation.')).toBeTruthy();
    expect(sessionStorage.getItem('carteio-playground-session:acme:assistant-1')).toBe(sessionId);
  });

  it('shows the actual provider on a newly generated reply instead of relying on current settings', async () => {
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'session-1', messageId: 'generated-1', reply: 'Generated answer.', retrievalMode: 'not_required', responseLanguage: 'English', sources: [], provenance: 'AI_GENERATED', providerUsed: 'openai', modelUsed: 'gpt-4o-mini' });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Please help');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Generated by OpenAI · gpt-4o-mini')).toBeTruthy();
  });

  it('shows a truthful pending state while a chat request is unresolved', async () => {
    let resolveReply: (value: Awaited<ReturnType<typeof sendPlaygroundMessage>>) => void = () => undefined;
    vi.mocked(sendPlaygroundMessage).mockImplementation(() => new Promise((resolve) => { resolveReply = resolve; }));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Please help');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Working on your response');
    resolveReply({ sessionId: 'session-1', reply: 'Done.', retrievalMode: 'not_required', responseLanguage: 'English', sources: [], provenance: 'AI_GENERATED' });
    expect(await screen.findByText('Done.')).toBeTruthy();
  });

  it('ignores malformed stored session IDs instead of requesting their history', async () => {
    const storageKey = 'carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]';
    sessionStorage.setItem(storageKey, '00000000-0000-0000-0000-not-a-uuid');
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'server-session', reply: 'Hello.', retrievalMode: 'not_required', responseLanguage: 'English', sources: [] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    expect(getPlaygroundConversation).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Hello.')).toBeTruthy();
    expect(sendPlaygroundMessage).toHaveBeenCalledWith('acme', 'assistant-1', 'Hello', undefined, expect.any(String), expect.any(AbortSignal));
  });

  it('renders an unknown API failure safely without exposing internal response text', async () => {
    vi.mocked(sendPlaygroundMessage).mockRejectedValue(new ApiError('private-provider-response-marker', 'http', 503, undefined, 'UNRECOGNIZED_INTERNAL_CODE'));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('We could not complete that request. Please try again.')).toBeTruthy();
    expect(screen.queryByText('private-provider-response-marker')).toBeNull();
  });

  it('clears an expired stored session but waits for explicit New Chat before sending without it', async () => {
    const storageKey = 'carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]';
    const staleSessionId = '11111111-1111-4111-8111-111111111111';
    sessionStorage.setItem(storageKey, staleSessionId);
    vi.mocked(getPlaygroundConversation).mockRejectedValueOnce(new ApiError('Resource not found', 'http', 404, undefined, 'PLAYGROUND_SESSION_NOT_FOUND'));
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'server-session', reply: 'Hello.', retrievalMode: 'not_required', responseLanguage: 'English', sources: [] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);

    expect(await screen.findByText('This saved conversation is no longer available. Select New Chat to continue.')).toBeTruthy();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    const composer = screen.getByRole('textbox', { name: 'Message your assistant' });
    expect(composer).toBeDisabled();
    expect(getPlaygroundConversation).toHaveBeenCalledWith('acme', 'assistant-1', staleSessionId, expect.any(AbortSignal), { latest: true });
    expect(sendPlaygroundMessage).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Start a new chat' }));
    await user.type(composer, 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Hello.')).toBeTruthy();
    expect(sendPlaygroundMessage).toHaveBeenCalledWith('acme', 'assistant-1', 'Hello', undefined, expect.any(String), expect.any(AbortSignal));
  });

  it('clears a session that expires during chat and waits for explicit New Chat', async () => {
    const storageKey = 'carteio-playground-session:acme:assistant-1:groq:test-model:MANUAL:[]';
    const expiredSessionId = '11111111-1111-4111-8111-111111111111';
    sessionStorage.setItem(storageKey, expiredSessionId);
    vi.mocked(sendPlaygroundMessage)
      .mockRejectedValueOnce(new ApiError('Request could not be completed.', 'http', 409, undefined, 'PLAYGROUND_SESSION_EXPIRED'))
      .mockResolvedValueOnce({ sessionId: 'fresh-server-session', reply: 'Hello.', retrievalMode: 'not_required', responseLanguage: 'English', sources: [] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);

    const composer = screen.getByRole('textbox', { name: 'Message your assistant' });
    await user.type(composer, 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('This saved conversation is no longer available. Select New Chat to continue.')).toBeTruthy();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(composer).toBeDisabled();
    expect(sendPlaygroundMessage).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Start a new chat' }));
    await user.type(composer, 'Hello again');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Hello.')).toBeTruthy();
    expect(sendPlaygroundMessage).toHaveBeenLastCalledWith('acme', 'assistant-1', 'Hello again', undefined, expect.any(String), expect.any(AbortSignal));
  });

  it('shows a safe sign-in recovery message after authentication expires', async () => {
    vi.mocked(sendPlaygroundMessage).mockRejectedValueOnce(new ApiError('Authentication is required', 'http', 401, undefined, 'UNAUTHORIZED'));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Your sign-in has expired. Sign in again, then reopen Playground.')).toBeTruthy();
  });

  it('resets conversation messages when New Chat is selected', async () => {
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'session-2', reply: 'Thanks for asking.', retrievalMode: 'lexical_only', responseLanguage: 'English', sources: [] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Message your assistant' }), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Thanks for asking.');
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    await waitFor(() => expect(screen.queryByText('Thanks for asking.')).toBeNull());
    expect(screen.getByText('Send a test message to Support.')).toBeTruthy();
  });

  it('uses automatic text direction for right-to-left replies and customer input', async () => {
    vi.mocked(sendPlaygroundMessage).mockResolvedValue({ sessionId: 'session-ar', reply: 'سياسة الإرجاع خلال سبعة أيام.', retrievalMode: 'lexical_only', responseLanguage: 'Arabic', sources: [] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    const composer = screen.getByRole('textbox', { name: 'Message your assistant' });
    await user.type(composer, 'ما سياسة الإرجاع؟');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const reply = await screen.findByText('سياسة الإرجاع خلال سبعة أيام.');
    expect(reply).toHaveAttribute('dir', 'auto');
    expect(composer).toHaveAttribute('dir', 'auto');
  });

  it('shows the server-managed provider read-only and saves only explicit routing policy', async () => {
    vi.mocked(getProviderConfigurationStatus).mockResolvedValue({
      groq: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      gemini: { keyConfigured: false, status: 'MISSING_API_KEY', supportedModels: ['gemini-3.8-flash', 'gemini-3.7-flash'] },
      openai: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      openrouter: { keyConfigured: true, status: 'READY_FOR_TESTING', modelValidation: null },
      effective: { provider: 'gemini', model: 'gemini-2.5-flash', status: 'MISSING_API_KEY', configurationValid: true, keyConfigured: false, ready: false },
    });
    vi.mocked(updateAssistant).mockResolvedValue({ ...assistant, providerMode: 'MANUAL', providerFallbacks: [] });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    render(<PlaygroundChat workspaceSlug="acme" assistant={assistant} manager onAssistantUpdated={vi.fn()} onClose={vi.fn()}/>);
    await user.click(screen.getByRole('button', { name: 'Provider settings' }));
    expect(screen.getByText('Google Gemini · gemini-2.5-flash', { selector: '#playground-settings-panel .workspace-field > span' })).toBeTruthy();
    expect(screen.getByText('Provider and model are managed by the server configuration.')).toBeTruthy();
    expect(screen.queryByLabelText('Provider')).toBeNull();
    expect(screen.queryByLabelText('Model name')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Selection mode'), 'MANUAL');
    await user.click(screen.getByRole('button', { name: 'Save routing settings' }));
    await waitFor(() => expect(updateAssistant).toHaveBeenCalledWith('acme', 'assistant-1', { providerMode: 'MANUAL', providerFallbacks: [] }));
  });
});
