import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ listAssistants: vi.fn(), sendPlaygroundMessageStream: vi.fn(), getPlaygroundConversation: vi.fn(), listPlaygroundSessions: vi.fn(), deletePlaygroundSession: vi.fn(), getPlaygroundDiagnosticTraces: vi.fn(), setPlaygroundDiagnosticCapture: vi.fn(), listWidgetDiagnosticSessions: vi.fn(), getWidgetDiagnosticTraces: vi.fn(), setWidgetDiagnosticCapture: vi.fn() }));
vi.mock('../services/api/assistants', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api/assistants')>();
  return { ...actual, listAssistants: mocks.listAssistants, sendPlaygroundMessageStream: mocks.sendPlaygroundMessageStream, getPlaygroundConversation: mocks.getPlaygroundConversation, listPlaygroundSessions: mocks.listPlaygroundSessions, deletePlaygroundSession: mocks.deletePlaygroundSession, getPlaygroundDiagnosticTraces: mocks.getPlaygroundDiagnosticTraces, setPlaygroundDiagnosticCapture: mocks.setPlaygroundDiagnosticCapture, listWidgetDiagnosticSessions: mocks.listWidgetDiagnosticSessions, getWidgetDiagnosticTraces: mocks.getWidgetDiagnosticTraces, setWidgetDiagnosticCapture: mocks.setWidgetDiagnosticCapture };
});

import Pages from '../dashboard-source/pages';

const assistant = {
  id: 'assistant-1', name: 'Support', status: 'ACTIVE',
  effectiveProviderConfiguration: { ready: true, provider: 'openrouter', model: 'google/gemini-2.5-flash', status: 'READY_FOR_TESTING' },
};

const writeText = vi.fn();
let mockMessageIndex = 0;
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  mockMessageIndex = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
  mocks.listAssistants.mockResolvedValue({ assistants: [assistant] });
  mocks.listPlaygroundSessions.mockResolvedValue({ items: [], hasMore: false, nextOffset: null, captureAvailable: true });
  mocks.deletePlaygroundSession.mockImplementation(async (_slug: string, _assistant: string, sessionId: string) => ({ conversationId: sessionId, deleted: true }));
  mocks.getPlaygroundDiagnosticTraces.mockResolvedValue({ items: [], captureEnabled: false, hasMore: false, nextOffset: null });
  mocks.listWidgetDiagnosticSessions.mockResolvedValue({ items: [], hasMore: false, nextOffset: null });
  mocks.getWidgetDiagnosticTraces.mockResolvedValue({ items: [], messages: [], hasMore: false, nextOffset: null });
  mocks.setWidgetDiagnosticCapture.mockImplementation(async (_slug: string, _assistant: string, conversationId: string, enabled: boolean) => ({ conversationId, enabled }));
  mocks.setPlaygroundDiagnosticCapture.mockImplementation(async (_slug: string, _assistant: string, _session: string, enabled: boolean) => ({ enabled }));
  mocks.sendPlaygroundMessageStream.mockImplementation(async (...args: any[]) => {
    const handlers = args[7];
    handlers.onReady();
    handlers.onEvent({ traceId: args[6], sequence: 1, operation: 'MESSAGE_RECEIVED', outcome: 'COMPLETED', status: 'completed', at: new Date().toISOString(), durationMs: 0 });
    handlers.onTerminal({ status: 'SUCCEEDED', lastSequence: 1 });
    mockMessageIndex += 1;
    return { sessionId: 'session-1', messageId: `message-${mockMessageIndex}`, reply: 'Hello there.', sources: [], retrievalMode: 'not_attempted', responseLanguage: 'en' };
  });
});

describe('active dashboard Playground', () => {
  it('renders sanitized real model-call output and exact validation issues in the all-message terminal and LLM inspector', async () => {
    const now = new Date().toISOString();
    const modelCall = { requestId: 'request-raw-1', traceId: 'trace-raw-1', providerCallIndex: 1, purpose: 'intent_interpretation', provider: 'openrouter', model: 'vendor/model', stage: 'query_interpretation', requestedInput: { requestDispatched: true }, response: { representation: 'SANITIZED_PROVIDER_CONTENT', status: 'RECEIVED', content: '{"answerAspects":[{"questionSpan":"bad span"}]}', responseLength: 49, truncated: false, finishReason: 'stop', durationMs: 31 }, outcome: 'RECEIVED', at: now, parsing: { parsed: true, parsedJson: { answerAspects: [{ questionSpan: 'bad span' }] } }, validation: { accepted: false, code: 'invalid_answer_aspect', issues: [{ path: '$.answerAspects[0].questionSpan', expected: 'Exact substring of current user message', received: 'bad span' }] }, backendDecision: { status: 'REPAIR_REQUIRED' } };
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'raw-session', captureEnabled: true, messageCount: 1, traceCount: 1, preview: 'Raw output case', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'raw-session', diagnosticCaptureEnabled: true, messages: [{ id: 'raw-message', clientTurnId: 'raw-turn', role: 'user', content: 'Question with actual phrase', sources: [], createdAt: now }] });
    mocks.getPlaygroundDiagnosticTraces.mockResolvedValue({ sessionId: 'raw-session', captureEnabled: true, items: [{ id: 'raw-attempt', requestId: 'request-raw-1', clientTurnId: 'raw-turn', attempt: 1, outcome: 'FAILED', payload: { traceId: 'trace-raw-1', events: [], protectedResponseDebug: { expiresAt: new Date(Date.now() + 60000).toISOString(), records: [], modelCalls: [modelCall] }, evidence: [], tools: [], retrieval: { attempted: false, mode: 'not_attempted' } }, createdAt: now }], hasMore: false, nextOffset: null });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const terminal = await screen.findByRole('log', { name: 'All conversation execution JSON' });
    expect(terminal).toHaveTextContent('bad span');
    expect(terminal).toHaveTextContent('REPAIR_REQUIRED');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'LLM & Tools' }));
    expect(screen.getByText('$.answerAspects[0].questionSpan')).toBeInTheDocument();
    expect(screen.getByText('Exact substring of current user message')).toBeInTheDocument();
  });
  it('appends authorized protected model output and validation SSE events while a Playground turn is running', async () => {
    mocks.sendPlaygroundMessageStream.mockImplementationOnce(async (...args: any[]) => {
      const handlers = args[7]; handlers.onReady();
      handlers.onEvent({ traceId: args[6], sequence: 1, operation: 'PROTECTED_MODEL_OUTPUT', outcome: 'COMPLETED', status: 'completed', at: new Date().toISOString(), durationMs: 0, output: { modelCall: { providerCallIndex: 1, response: { content: '{"invalid":true}' } } } });
      handlers.onEvent({ traceId: args[6], sequence: 2, operation: 'PROTECTED_MODEL_VALIDATION', outcome: 'FAILED', status: 'failed', at: new Date().toISOString(), durationMs: 0, output: { validation: { accepted: false, issues: [{ path: '$.answerAspects' }] } } });
      return { sessionId: 'live-session', messageId: 'live-answer', reply: 'Repaired response', sources: [], retrievalMode: 'not_attempted', responseLanguage: 'en' };
    });
    const user = userEvent.setup();
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    await user.type(input, 'Check output'); await user.keyboard('{Enter}');
    const terminal = await screen.findByRole('log', { name: 'All conversation execution JSON' });
    await waitFor(() => expect(terminal).toHaveTextContent('PROTECTED_MODEL_OUTPUT'));
    expect(terminal).toHaveTextContent('{"invalid":true}');
    expect(terminal).toHaveTextContent('$.answerAspects');
  });
  it('keeps the right terminal pure black and constrained to one flexing internal scroll viewport', () => {
    const css = readFileSync(new URL('../dashboard-source/playground-dev-console.css', import.meta.url), 'utf8');
    expect(css).toContain('background:#000000');
    expect(css).toContain('grid-template-rows:minmax(0,1fr) minmax(0,1fr)');
    expect(css).toContain('min-width:0');
    expect(css).toContain('min-height:0');
    expect(css).toContain('flex:1 1 0');
    expect(css).toContain('overflow: auto');
    expect(css).toContain('grid-template-columns:minmax(0,1.48fr) minmax(0,1fr)');
    expect(css).toContain('grid-template-rows:auto minmax(0,1fr)');
    expect(css).toContain('grid-column:2;grid-row:1/span 2');
    expect(css).toContain('.playground-page .playground-grid>.chat-card{grid-column:1;grid-row:2}');
    expect(css).toContain('.playground-session-menu{box-sizing:border-box;position:absolute');
    expect(css).toContain('left:0;width:min(320px,calc(100vw - 24px))');
    expect(css).toContain('max-height:min(300px,calc(100dvh - 96px))');
    expect(css).toContain('background-color:var(--surface);opacity:1');
    expect(css).toContain('overflow-x:hidden;overflow-y:auto');
    expect(css).toContain('display:contents');
    expect(css).toContain('grid-template-rows:minmax(0,1fr) minmax(0,1fr)');
    expect(css).toContain('.source-dashboard .playground-visual-inspector,.source-dashboard .playground-terminal-panel');
    expect(css).toContain('overflow:hidden');
    expect(css).toContain('grid-template-columns:minmax(0,1fr) auto auto auto');
    expect(css).toContain('@media(max-width:1440px) and (min-width:821px)');
    const pageCss = readFileSync(new URL('../dashboard-source/source-dashboard.css', import.meta.url), 'utf8');
    expect(pageCss).toContain('padding:6px clamp(10px,1.2vw,18px) 8px');
    expect(pageCss).toContain('gap:6px;width:100%;min-width:0;min-height:0');
    const pageSource = readFileSync(new URL('../dashboard-source/pages.tsx', import.meta.url), 'utf8');
    expect(pageSource).not.toContain('Developer mode');
    expect(pageSource).toContain('className="terminal-collapse"');
  });

  it('mounts delete confirmation in a fixed body portal with viewport-bounded styling', () => {
    const css = readFileSync(new URL('../dashboard-source/playground-dev-console.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../dashboard-source/pages.tsx', import.meta.url), 'utf8');
    expect(source).toContain('createPortal(');
    expect(source).toContain("document.body.style.overflow = 'hidden'");
    expect(source).toContain("event.key !== 'Tab'");
    expect(css).toContain('.playground-delete-backdrop{position:fixed;z-index:10000;inset:0');
    expect(css).toContain('width:min(410px,100%)');
    expect(css).toContain('max-height:calc(100dvh - 40px)');
  });

  it('keeps metadata capture enabled for every subsequent request in the Playground session', async () => {
    const user = userEvent.setup();
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    const optIn = screen.getByRole('checkbox', { name: 'Capture Metadata' });
    await waitFor(() => expect(optIn).toBeEnabled());
    expect(optIn).not.toBeChecked();
    await user.click(optIn);
    expect(document.querySelector('.playground-inspector')).toHaveClass('is-mobile-open');
    expect(screen.getByText('Capture ON')).toBeInTheDocument();
    await user.type(input, 'Hi'); await user.keyboard('{Enter}');
    await screen.findByText('Hello there.');
    expect(mocks.sendPlaygroundMessageStream.mock.calls[0]?.[8]).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Capture Metadata' })).toBeChecked();
    await user.type(input, 'Continue'); await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.sendPlaygroundMessageStream).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('Hello there.')).toHaveLength(2));
    expect(mocks.sendPlaygroundMessageStream.mock.calls[1]?.[8]).toBe(true);
    for (let index = 2; index < 10; index += 1) {
      await user.type(input, `Message ${index + 1}`); await user.keyboard('{Enter}');
      await waitFor(() => expect(mocks.sendPlaygroundMessageStream).toHaveBeenCalledTimes(index + 1));
      expect(mocks.sendPlaygroundMessageStream.mock.calls[index]?.[8]).toBe(true);
    }
    await user.click(screen.getByRole('checkbox', { name: 'Capture Metadata' }));
    await user.type(input, 'Eleventh message'); await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.sendPlaygroundMessageStream).toHaveBeenCalledTimes(11));
    expect(mocks.sendPlaygroundMessageStream.mock.calls[10]?.[8]).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: 'Capture Metadata' }));
    await user.click(screen.getByRole('button', { name: /New chat/i }));
    expect(screen.getByRole('checkbox', { name: 'Capture Metadata' })).not.toBeChecked();
  });

  it('restores a saved conversation capture preference when the authorized session is reopened', async () => {
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'saved-session', captureEnabled: true, messageCount: 3, traceCount: 3, preview: 'Shipping question', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'saved-session', diagnosticCaptureEnabled: true, messages: [] });
    mocks.getPlaygroundDiagnosticTraces.mockResolvedValue({ sessionId: 'saved-session', captureEnabled: true, items: [], hasMore: false, nextOffset: null });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Capture Metadata' })).toBeChecked());
    expect(mocks.getPlaygroundConversation).toHaveBeenCalledWith('north', 'assistant-1', 'saved-session', expect.any(AbortSignal), { offset: 0, limit: 40 });
  });

  it('loads every retained successful and failed attempt into the terminal without message selection', async () => {
    const now = new Date().toISOString();
    const event = (sequence: number, operation: string, outcome: string) => ({ traceId: `trace-${sequence}`, sequence, operation, outcome, status: outcome.toLowerCase(), at: now, durationMs: 12 });
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'saved-session', captureEnabled: true, messageCount: 1, traceCount: 2, preview: 'Shipping policy?', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'saved-session', diagnosticCaptureEnabled: true, messages: [{ id: 'user-1', clientTurnId: 'turn-1', role: 'user', content: 'Shipping policy?', sources: [], createdAt: now }] });
    mocks.getPlaygroundDiagnosticTraces.mockResolvedValue({ sessionId: 'saved-session', captureEnabled: true, offset: 0, limit: 40, items: [
      { id: 'attempt-1', requestId: 'request-1', clientTurnId: 'turn-1', attempt: 1, outcome: 'FAILED', payload: { traceId: 'trace-1', events: [event(1, 'MESSAGE_RECEIVED', 'COMPLETED'), event(2, 'ANSWER_GENERATION', 'FAILED')], evidence: [], tools: [], retrieval: { attempted: false, mode: 'not_attempted' } }, createdAt: now },
      { id: 'attempt-2', requestId: 'request-2', clientTurnId: 'turn-1', attempt: 2, outcome: 'COMPLETED', payload: { traceId: 'trace-2', events: [event(3, 'ANSWER_GENERATION', 'COMPLETED')], evidence: [], tools: [], retrieval: { attempted: false, mode: 'not_attempted' } }, createdAt: now },
    ], hasMore: false, nextOffset: null });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const terminal = await screen.findByRole('log', { name: 'All conversation execution JSON' });
    await waitFor(() => expect(terminal).toHaveTextContent('Attempt 1'));
    expect(terminal).toHaveTextContent('Attempt 2');
    expect(terminal).toHaveTextContent('ANSWER GENERATION');
    expect(terminal).toHaveTextContent('FAILED');
    expect(terminal).toHaveTextContent('COMPLETED');
    const attemptPicker = screen.getByRole('combobox', { name: 'Select diagnostic attempt' });
    expect(attemptPicker).toHaveTextContent('Attempt 1');
    expect(attemptPicker).toHaveTextContent('Attempt 2');
    await userEvent.setup().selectOptions(attemptPicker, 'attempt-1');
    expect(screen.getByRole('region', { name: 'Visual Inspector' })).toHaveTextContent('FAILED');
    await userEvent.setup().click(screen.getByRole('button', { name: 'View ANSWER_GENERATION JSON' }));
    expect(screen.getByRole('region', { name: 'Recorded stage JSON' })).toHaveTextContent('ANSWER_GENERATION');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear View' }));
    expect(terminal).toHaveTextContent('ANSWER GENERATION');
  });

  it('opens the selected recorded stage JSON while keeping prior failed attempts inspectable', async () => {
    const now = new Date().toISOString();
    const event = { traceId: 'trace-flow', sequence: 1, operation: 'ANSWER_GENERATION', outcome: 'FAILED', status: 'failed', at: now, durationMs: 21, errorCategory: 'PROVIDER_ERROR', output: { reason: 'recorded failure' } };
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'flow-session', captureEnabled: true, messageCount: 1, traceCount: 1, preview: 'Inspect this flow', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'flow-session', diagnosticCaptureEnabled: true, messages: [{ id: 'user-flow', clientTurnId: 'turn-flow', role: 'user', content: 'Inspect this flow', sources: [], createdAt: now }] });
    mocks.getPlaygroundDiagnosticTraces.mockResolvedValue({ sessionId: 'flow-session', captureEnabled: true, items: [{ id: 'attempt-flow-1', requestId: 'request-flow', clientTurnId: 'turn-flow', attempt: 1, outcome: 'FAILED', payload: { traceId: 'trace-flow', events: [event], evidence: [], tools: [], retrieval: { attempted: false, mode: 'not_attempted' } }, createdAt: now }], hasMore: false, nextOffset: null });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await screen.findByText('Inspect this flow');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'View ANSWER_GENERATION JSON' }));
    const json = screen.getByRole('region', { name: 'Recorded stage JSON' });
    expect(json).toHaveTextContent('recorded failure');
    expect(json.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByRole('log', { name: 'All conversation execution JSON' })).toHaveTextContent('FAILED');
  });


  it('keeps the conversation popover anchored, bounded, keyboard usable, and closable outside', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    const longName = 'A very long conversation title that should truncate without pushing the delete action outside the popover';
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'saved-long', captureEnabled: false, messageCount: 2, traceCount: 0, preview: longName, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'saved-long', diagnosticCaptureEnabled: false, messages: [] });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const trigger = await screen.findByRole('button', { name: 'Open conversation' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Saved Playground conversations' });
    expect(listbox.parentElement).toHaveClass('playground-session-picker');
    expect(screen.getByRole('option', { name: new RegExp(longName) })).toHaveAttribute('title', expect.stringContaining(longName));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: new RegExp(longName) })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Saved Playground conversations' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox', { name: 'Saved Playground conversations' })).not.toBeInTheDocument();
  });

  it('renders conversation history before a slow Inspector trace request completes', async () => {
    const now = new Date().toISOString();
    let resolveTraces!: (value: any) => void;
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'fast-history', captureEnabled: true, messageCount: 1, traceCount: 1, preview: 'Fast history appears', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'fast-history', diagnosticCaptureEnabled: true, messages: [{ id: 'fast-user', role: 'user', content: 'Fast history appears', sources: [], createdAt: now }] });
    mocks.getPlaygroundDiagnosticTraces.mockImplementationOnce(() => new Promise(resolve => { resolveTraces = resolve; }));
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const chatLog = screen.getByRole('log', { name: 'Chat messages' });
    await waitFor(() => expect(chatLog).toHaveTextContent('Fast history appears'));
    expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toBeEnabled();
    expect(mocks.getPlaygroundConversation).toHaveBeenCalledTimes(1);
    expect(mocks.getPlaygroundConversation).toHaveBeenCalledWith('north', 'assistant-1', 'fast-history', expect.any(AbortSignal), { offset: 0, limit: 40 });
    resolveTraces({ sessionId: 'fast-history', captureEnabled: true, items: [], hasMore: false, nextOffset: null });
  });

  it('closes on selection and ignores a stale history response after a rapid conversation switch', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    const saved = (id: string, preview: string) => ({ id, captureEnabled: false, messageCount: 1, traceCount: 0, preview, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [saved('conversation-a', 'Conversation A'), saved('conversation-b', 'Conversation B')], hasMore: false, nextOffset: null, captureAvailable: true });
    let resolveA!: (value: any) => void;
    let resolveB!: (value: any) => void;
    mocks.getPlaygroundConversation.mockImplementation((_slug, _assistant, id) => new Promise(resolve => { if (id === 'conversation-a') resolveA = resolve; else resolveB = resolve; }));
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const trigger = await screen.findByRole('button', { name: 'Open conversation' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: /Conversation B/ }));
    expect(screen.queryByRole('listbox', { name: 'Saved Playground conversations' })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.getPlaygroundConversation).toHaveBeenCalledTimes(2));
    resolveB({ sessionId: 'conversation-b', diagnosticCaptureEnabled: false, messages: [{ id: 'message-b', role: 'user', content: 'History B', sources: [], createdAt: now }] });
    const chatLog = screen.getByRole('log', { name: 'Chat messages' });
    await waitFor(() => expect(chatLog).toHaveTextContent('History B'));
    resolveA({ sessionId: 'conversation-a', diagnosticCaptureEnabled: false, messages: [{ id: 'message-a', role: 'user', content: 'Stale History A', sources: [], createdAt: now }] });
    await waitFor(() => expect(chatLog).not.toHaveTextContent('Stale History A'));
  });

  it('offers a retry when the saved conversation list request fails without blocking chat', async () => {
    const user = userEvent.setup();
    mocks.listPlaygroundSessions.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], hasMore: false, nextOffset: null, captureAvailable: true });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const trigger = await screen.findByRole('button', { name: 'Open conversation' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved conversations could not be loaded.');
    expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.listPlaygroundSessions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No saved conversations.')).toBeInTheDocument();
  });

  it('does not reload the conversation list after a reply to an already listed conversation', async () => {
    const now = new Date().toISOString();
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'session-1', captureEnabled: false, messageCount: 1, traceCount: 0, preview: 'Existing conversation', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'session-1', diagnosticCaptureEnabled: false, messages: [{ id: 'existing-user', role: 'user', content: 'Existing conversation', sources: [], createdAt: now }] });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await waitFor(() => expect(screen.getByRole('log', { name: 'Chat messages' })).toHaveTextContent('Existing conversation'));
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    await userEvent.setup().type(input, 'One more question'); await userEvent.setup().keyboard('{Enter}');
    await screen.findByText('Hello there.');
    expect(mocks.listPlaygroundSessions).toHaveBeenCalledTimes(1);
  });

  it('confirms deletion, keeps the conversation on Cancel, then clears an active conversation only after server confirmation', async () => {
    const user = userEvent.setup();
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'saved-session', captureEnabled: true, messageCount: 2, traceCount: 1, preview: 'Shipping question', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'saved-session', diagnosticCaptureEnabled: true, messages: [{ id: 'saved-user', role: 'user', content: 'Shipping question', sources: [], createdAt: new Date().toISOString() }] });
    const { container } = render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await screen.findByText('Shipping question');
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.click(screen.getByRole('button', { name: 'Delete conversation: Shipping question' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete conversation?' });
    expect(dialog.closest('.playground-delete-backdrop')?.parentElement).toBe(document.body);
    expect(container.querySelector('.playground-delete-backdrop')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Saved Playground conversations' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('region', { name: 'Visual Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'JSON Terminal' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.deletePlaygroundSession).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open conversation' })).toHaveFocus());
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(screen.getByRole('checkbox', { name: 'Capture Metadata' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.click(screen.getByRole('button', { name: 'Delete conversation: Shipping question' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.deletePlaygroundSession).toHaveBeenCalledTimes(1));
    expect(mocks.deletePlaygroundSession).toHaveBeenCalledWith('north', 'assistant-1', 'saved-session');
    await waitFor(() => expect(screen.getByText('New Playground session')).toBeInTheDocument());
    expect(screen.queryByText('Shipping question')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Capture Metadata' })).not.toBeChecked();
  });

  it('prevents duplicate confirmation and exposes the pending delete state', async () => {
    const user = userEvent.setup();
    let resolveDelete!: () => void;
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'pending-session', captureEnabled: false, messageCount: 1, traceCount: 0, preview: 'Pending deletion', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'pending-session', diagnosticCaptureEnabled: false, messages: [{ id: 'pending-user', role: 'user', content: 'Pending deletion', sources: [], createdAt: new Date().toISOString() }] });
    mocks.deletePlaygroundSession.mockImplementationOnce(() => new Promise<void>(resolve => { resolveDelete = resolve; }));
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await screen.findByText('Pending deletion');
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.click(screen.getByRole('button', { name: 'Delete conversation: Pending deletion' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(mocks.deletePlaygroundSession).toHaveBeenCalledTimes(1);
    resolveDelete();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete conversation?' })).not.toBeInTheDocument());
  });

  it('keeps the selected conversation and selector row when the delete API rejects the request', async () => {
    const user = userEvent.setup();
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'saved-session', captureEnabled: false, messageCount: 1, traceCount: 0, preview: 'Keep this chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'saved-session', diagnosticCaptureEnabled: false, messages: [{ id: 'saved-user', role: 'user', content: 'Keep this chat', sources: [], createdAt: new Date().toISOString() }] });
    mocks.deletePlaygroundSession.mockRejectedValueOnce(new Error('denied'));
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await screen.findByText('Keep this chat');
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.click(screen.getByRole('button', { name: 'Delete conversation: Keep this chat' }));
    expect(await screen.findByRole('dialog', { name: 'Delete conversation?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Delete conversation?' })).not.toBeInTheDocument();
    expect(mocks.deletePlaygroundSession).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.click(screen.getByRole('button', { name: 'Delete conversation: Keep this chat' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation could not be deleted.');
    expect(screen.getByText('Keep this chat')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Delete conversation?' })).toBeInTheDocument();
  });

  it('adjusts the paginated conversation offset after deleting a row from the loaded page', async () => {
    const user = userEvent.setup();
    const sessions = Array.from({ length: 20 }, (_, index) => ({ id: `saved-${index}`, captureEnabled: false, messageCount: 1, traceCount: 0, preview: `Conversation ${index}`, createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - index * 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    mocks.listPlaygroundSessions.mockResolvedValueOnce({ items: sessions, hasMore: true, nextOffset: 20, captureAvailable: true })
      .mockResolvedValueOnce({ items: [{ ...sessions[19]!, id: 'saved-20', preview: 'Conversation 20' }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'saved-0', diagnosticCaptureEnabled: false, messages: [{ id: 'active', role: 'user', content: 'Current chat', sources: [], createdAt: new Date().toISOString() }] });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await screen.findByText('Current chat');
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.click(screen.getByRole('button', { name: 'Delete conversation: Conversation 1' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.deletePlaygroundSession).toHaveBeenCalledWith('north', 'assistant-1', 'saved-1'));
    await user.click(screen.getByRole('button', { name: 'Open conversation' }));
    await user.click(screen.getByRole('button', { name: 'Load more conversations' }));
    await waitFor(() => expect(mocks.listPlaygroundSessions).toHaveBeenLastCalledWith('north', 'assistant-1', undefined, { offset: 19, limit: 20 }));
    expect(screen.getByText('Current chat')).toBeInTheDocument();
  });

  it('renders the visual inspector above the independent black terminal', async () => {
    const { container } = render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="owner"/>);
    expect(await screen.findByText('Authorized role')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Assistant chat' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Developer Workspace' })).toHaveTextContent('Developer Workspace');
    expect(screen.getByRole('region', { name: 'Visual Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'JSON Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Visual Inspector views' })).toHaveTextContent('Live Flow');
    expect(screen.getByRole('tablist', { name: 'Visual Inspector views' })).toHaveTextContent('Events');
    expect(screen.getByRole('tablist', { name: 'Visual Inspector views' })).toHaveTextContent('Knowledge');
    expect(screen.getByRole('tablist', { name: 'Visual Inspector views' })).toHaveTextContent('LLM & Tools');
    expect(await screen.findByText('Capture OFF')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'All conversation execution JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy All JSON' })).toBeDisabled();
    expect(container.querySelector('.playground-grid')).toBeInTheDocument();
    expect(container.querySelector('.playground-developer-panels')).toBeInTheDocument();
    expect(container.querySelector('.playground-visual-inspector + .playground-terminal-panel')).toBeInTheDocument();
    expect(screen.queryByText('Owner/admin access required')).not.toBeInTheDocument();
  });
  it('keeps flow selection and detailed views independent from the all-message terminal', async () => {
    const user = userEvent.setup();
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    await screen.findByRole('region', { name: 'JSON Terminal' });
    const tabs = screen.getByRole('tablist', { name: 'Visual Inspector views' });
    await user.click(within(tabs).getByRole('tab', { name: 'Knowledge' }));
    expect(screen.getByRole('region', { name: 'JSON Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(tabs).getByRole('tab', { name: 'LLM & Tools' }));
    expect(screen.getByRole('region', { name: 'JSON Terminal' })).toBeInTheDocument();
  });

  it('shows observed live JSON automatically without selecting a message or changing views', async () => {
    const user = userEvent.setup();
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    await user.type(input, 'Check the recorded trace'); await user.keyboard('{Enter}');
    await screen.findByText('Hello there.');
    const terminal = screen.getByRole('log', { name: 'All conversation execution JSON' });
    expect(terminal).toHaveTextContent('MESSAGE #1');
    expect(terminal).toHaveTextContent('MESSAGE RECEIVED');
    expect(terminal).toHaveTextContent('"operation": "MESSAGE_RECEIVED"');
    expect(screen.getByRole('tablist', { name: 'Visual Inspector views' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'JSON Terminal' })).toBeInTheDocument();
  });
  it('copies complete authorized retained attempt JSON with one action', async () => {
    const user = userEvent.setup();
    const event = { traceId: 'trace-a', sequence: 1, operation: 'ANSWER_GENERATION', outcome: 'FAILED', status: 'failed', at: new Date().toISOString(), durationMs: 9, errorCategory: 'PROVIDER_ERROR' };
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'session-1', captureEnabled: true, messageCount: 1, traceCount: 1, preview: 'Copy this trace', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'session-1', diagnosticCaptureEnabled: true, messages: [{ id: 'user-1', clientTurnId: 'turn-1', role: 'user', content: 'Copy this trace', createdAt: new Date().toISOString(), sources: [] }] });
    mocks.getPlaygroundDiagnosticTraces.mockResolvedValue({ sessionId: 'session-1', captureEnabled: true, items: [{ id: 'record-a', requestId: 'request-a', clientTurnId: 'turn-1', attempt: 2, outcome: 'FAILED', payload: { traceId: 'trace-a', events: [event], evidence: [], tools: [], retrieval: { attempted: false, mode: 'not_attempted' } }, createdAt: new Date().toISOString() }], hasMore: false, nextOffset: null });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    await screen.findByRole('log', { name: 'All conversation execution JSON' });
    expect(screen.getByRole('log', { name: 'All conversation execution JSON' })).toHaveTextContent('ANSWER GENERATION');
    await user.click(screen.getByRole('button', { name: 'Copy All JSON' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = JSON.parse(writeText.mock.calls.at(-1)?.[0] as string);
    expect(copied.attempts).toHaveLength(1);
    expect(copied.attempts[0].attempt).toBe(2);
    expect(copied.attempts[0].trace.events[0].errorCategory).toBe('PROVIDER_ERROR');
  });
  it('collapses and expands the desktop console without losing the selected trace', async () => {
    const user = userEvent.setup();
    const { container } = render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    const grid = container.querySelector('.playground-grid');
    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(grid).toHaveClass('console-collapsed');
    expect(screen.queryByRole('log', { name: 'All conversation execution JSON' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Visual Inspector' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show execution inspector' }));
    expect(grid).not.toHaveClass('console-collapsed');
    expect(screen.getByRole('log', { name: 'All conversation execution JSON' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Visual Inspector' })).toBeInTheDocument();
  });

  it('pauses Follow Live when the reader scrolls upward and resumes at Jump to Latest', async () => {
    const user = userEvent.setup();
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    const terminal = await screen.findByRole('log', { name: 'All conversation execution JSON' });
    Object.defineProperties(terminal, { scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 250 }, scrollTop: { configurable: true, writable: true, value: 0 } });
    fireEvent.scroll(terminal);
    expect(screen.getByRole('checkbox', { name: 'Follow Live' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Jump to Latest' }));
    expect(screen.getByRole('checkbox', { name: 'Follow Live' })).toBeChecked();
  });

  it('opens the console as a usable drawer at the small-screen breakpoint', async () => {
    const user = userEvent.setup();
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true, media: '(max-width: 820px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) });
    const { container, unmount } = render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    await user.click(screen.getByRole('button', { name: 'Show execution inspector' }));
    expect(container.querySelector('.playground-inspector')).toHaveClass('is-mobile-open');
    unmount();
    if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor);
    else Reflect.deleteProperty(window, 'matchMedia');
  });

  it('keeps the empty terminal explicit when no trace has been captured', async () => {
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    expect(await screen.findByText(/No recorded trace for this conversation/)).toBeInTheDocument();
    expect(screen.queryByText('MESSAGE_RECEIVED')).not.toBeInTheDocument();
  });
  it('keeps authorized chat history visible when the diagnostic trace endpoint fails', async () => {
    const now = new Date().toISOString();
    mocks.listPlaygroundSessions.mockResolvedValue({ items: [{ id: 'saved-session', captureEnabled: true, messageCount: 1, traceCount: 1, preview: 'Retained message', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60000).toISOString() }], hasMore: false, nextOffset: null, captureAvailable: true });
    mocks.getPlaygroundConversation.mockResolvedValue({ sessionId: 'saved-session', diagnosticCaptureEnabled: true, messages: [{ id: 'user-1', role: 'user', content: 'Retained message', sources: [], createdAt: now }] });
    mocks.getPlaygroundDiagnosticTraces.mockRejectedValueOnce(new Error('trace endpoint unavailable'));
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    await waitFor(() => expect(screen.getByRole('log', { name: 'Chat messages' })).toHaveTextContent('Retained message'));
    expect(screen.getByRole('log', { name: 'All conversation execution JSON' })).toHaveTextContent('could not be loaded');
  });
  it('loads protected Widget conversation history and exposes each attempt JSON in the channel Inspector', async () => {
    const trace = { schemaVersion: 1, traceId: 'widget-request-1', channel: 'PUBLIC_WIDGET', events: [{ sequence: 1, operation: 'INTENT_INTERPRETATION', outcome: 'FAILED', status: 'failed', at: new Date().toISOString(), durationMs: 9, output: { validationAccepted: false }, decision: { decisionOwner: 'BACKEND_VALIDATOR' } }], evidence: [], tools: [], retrieval: { attempted: false, mode: 'not_attempted' } };
    mocks.listWidgetDiagnosticSessions.mockResolvedValue({ channel: 'Widget', items: [{ id: 'widget-conversation-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), preview: 'Widget question', messageCount: 1, traceCount: 1 }], hasMore: false, nextOffset: null });
    mocks.getWidgetDiagnosticTraces.mockResolvedValue({ channel: 'Widget', sessionId: 'widget-conversation-1', messages: [{ id: 'visitor-1', role: 'user', content: 'Widget question', createdAt: new Date().toISOString() }], items: [{ id: 'trace-row-1', requestId: 'widget-request-1', clientTurnId: null, attempt: 1, outcome: 'FAILED', payload: trace, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 1_000).toISOString() }], hasMore: false, nextOffset: null });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    await userEvent.setup().selectOptions(await screen.findByRole('combobox', { name: 'Diagnostic source' }), 'WIDGET');
    expect(await screen.findByText('Widget question')).toBeInTheDocument();
    expect(await screen.findByText(/ATTEMPT 1 · widget-request-1/)).toBeInTheDocument();
    expect(mocks.listWidgetDiagnosticSessions).toHaveBeenCalledWith('north', 'assistant-1', expect.any(AbortSignal), { offset: 0, limit: 20 });
    expect(mocks.getWidgetDiagnosticTraces).toHaveBeenCalledWith('north', 'assistant-1', 'widget-conversation-1', expect.any(AbortSignal), { offset: 0, limit: 40 });
    expect(screen.getByText(/Expired/)).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Authorized Widget conversation JSON' })).toHaveTextContent('INTENT INTERPRETATION');
  });

  it('preserves Shift+Enter and submits with Enter while rendering only observed backend stages', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: writeText } });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    await user.type(input, 'Hi{shift>}{enter}{/shift}there');
    expect((input as HTMLTextAreaElement).value).toBe('Hi\nthere');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } });
    expect(await screen.findByText('Hello there.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.sendPlaygroundMessageStream).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('log', { name: 'All conversation execution JSON' })).toHaveTextContent('MESSAGE RECEIVED');
  });

  it('mounts Copy History and header Copy entire conversation in the active workspace route, fetching paginated history chronologically', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: writeText } });
    mocks.getPlaygroundConversation.mockImplementation(async (_slug, _assistant, _session, _signal, page) => page.offset === 0
      ? { sessionId: 'session-1', messages: [{ id: 'u1', role: 'user', content: 'Tumhare paas products?\nदूसरी पंक्ति', createdAt: '2026-10-23T10:15:00Z', sources: [] }], hasMore: true, nextOffset: 1 }
      : { sessionId: 'session-1', messages: [{ id: 'message-1', role: 'assistant', content: 'Catalog unavailable.', createdAt: '2026-10-23T10:16:00Z', provenance: 'SYSTEM_RESPONSE', sources: [] }], hasMore: false, nextOffset: null });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    await user.type(input, 'Tumhare paas products?'); await user.keyboard('{Enter}');
    await screen.findByText('Hello there.');
    await user.click(screen.getByRole('button', { name: 'Copy History' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied.indexOf('Tumhare paas products?')).toBeLessThan(copied.indexOf('Catalog unavailable.'));
    expect(copied).toContain('Response origin: System response');
    expect(copied).toContain('दूसरी पंक्ति');
    expect(mocks.getPlaygroundConversation).toHaveBeenNthCalledWith(1, 'north', 'assistant-1', 'session-1', expect.any(AbortSignal), { offset: 0, limit: 100 });
    expect(mocks.getPlaygroundConversation).toHaveBeenNthCalledWith(2, 'north', 'assistant-1', 'session-1', expect.any(AbortSignal), { offset: 1, limit: 100 });
    await user.click(screen.getByRole('button', { name: 'Copy entire conversation' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const nextExport = writeText.mock.calls[1]![0] as string;
    expect(nextExport).toMatch(/^Exported: \d{4}-\d{2}-\d{2}T/m);
    expect(nextExport.replace(/^Exported: .+$/m, 'Exported: <timestamp>')).toBe(copied.replace(/^Exported: .+$/m, 'Exported: <timestamp>'));
    expect(screen.getByRole('button', { name: 'Copy Chat + Diagnostics' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy Chat + Diagnostics' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(writeText.mock.calls[2]![0]).toContain('CARTEIO AI — SAFE DIAGNOSTICS');
    expect(writeText.mock.calls[2]![0]).toContain('MESSAGE_RECEIVED');
  });

  it('copies only the selected individual message and reports clipboard failures', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: writeText } });
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    await user.type(input, 'Hinglish नमस्ते'); await user.keyboard('{Enter}');
    await screen.findByText('Hello there.');
    await user.click(screen.getByRole('button', { name: 'Copy user message' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Hinglish नमस्ते'));
    expect(writeText.mock.calls[0]![0]).not.toContain('Hello there.');
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    await user.click(screen.getByRole('button', { name: 'Copy assistant message' }));
    expect(await screen.findByText('Clipboard access failed. Allow clipboard access and try again.')).toBeInTheDocument();
  });

  it('does not expose copy/history diagnostics controls to a non-manager workspace role', async () => {
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="MEMBER"/>);
    await screen.findByText('Owner/admin access required');
    expect(screen.queryByRole('button', { name: 'Copy History' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy entire conversation' })).not.toBeInTheDocument();
  });

  it('shows an explicit error when authorized history loading fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: writeText } });
    mocks.getPlaygroundConversation.mockRejectedValue(new Error('network unavailable'));
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="ADMIN"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    await user.type(input, 'Hello'); await user.keyboard('{Enter}');
    await screen.findByText('Hello there.');
    await user.click(screen.getByRole('button', { name: 'Copy History' }));
    expect(await screen.findByText('Conversation history could not be loaded. Try again.')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});
