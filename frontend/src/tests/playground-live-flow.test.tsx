import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ listAssistants: vi.fn(), sendPlaygroundMessageStream: vi.fn(), getPlaygroundConversation: vi.fn() }));
vi.mock('../services/api/assistants', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api/assistants')>();
  return { ...actual, listAssistants: mocks.listAssistants, sendPlaygroundMessageStream: mocks.sendPlaygroundMessageStream, getPlaygroundConversation: mocks.getPlaygroundConversation };
});

import Pages from '../dashboard-source/pages';

const assistant = {
  id: 'assistant-1', name: 'Support', status: 'ACTIVE',
  effectiveProviderConfiguration: { ready: true, provider: 'gemini', model: 'gemini-2.5-flash', status: 'READY' },
};

const writeText = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
  mocks.listAssistants.mockResolvedValue({ assistants: [assistant] });
  mocks.sendPlaygroundMessageStream.mockImplementation(async (...args: any[]) => {
    const handlers = args[7];
    handlers.onReady();
    handlers.onEvent({ traceId: args[6], sequence: 1, operation: 'MESSAGE_RECEIVED', outcome: 'COMPLETED', status: 'completed', at: new Date().toISOString(), durationMs: 0 });
    handlers.onTerminal({ status: 'SUCCEEDED', lastSequence: 1 });
    return { sessionId: 'session-1', messageId: 'message-1', reply: 'Hello there.', sources: [], retrievalMode: 'not_attempted', responseLanguage: 'en' };
  });
});

describe('active dashboard Playground', () => {
  it('opts an owner into metadata capture for exactly the next request', async () => {
    const user = userEvent.setup();
    render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    const input = await screen.findByRole('textbox', { name: 'Message the assistant' });
    const optIn = screen.getByRole('checkbox', { name: 'Capture validation metadata for the next message' });
    expect(optIn).not.toBeChecked();
    await user.click(optIn);
    await user.type(input, 'Hi'); await user.keyboard('{Enter}');
    await screen.findByText('Hello there.');
    expect(mocks.sendPlaygroundMessageStream.mock.calls[0]?.[8]).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Capture validation metadata for the next message' })).not.toBeChecked();
    await user.type(input, 'Continue'); await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.sendPlaygroundMessageStream).toHaveBeenCalledTimes(2));
    expect(mocks.sendPlaygroundMessageStream.mock.calls[1]?.[8]).toBe(false);
  });

  it('passes lowercase owner role to the Inspector and renders the compact four-tab workspace', async () => {
    const { container } = render(<Pages page="playground" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="owner"/>);

    expect(await screen.findByText('Authorized role')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Assistant chat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Live Flow' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'LLM & Tools' })).toBeInTheDocument();
    expect(container.querySelector('.playground-grid')).toBeInTheDocument();
    expect(screen.queryByText('Owner/admin access required')).not.toBeInTheDocument();
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
    expect(screen.getByText('Agent Builder flow not active for this conversation.')).toBeInTheDocument();
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
