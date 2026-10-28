import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsPage } from '../pages/saas/SaasPages';
import { getConversation, getConversations } from '../services/api/saas';

vi.mock('../services/api/saas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/saas')>();
  return { ...actual, getConversations: vi.fn(), getConversation: vi.fn(), updateConversation: vi.fn() };
});

const inbox = {
  items: [{ id: 'conversation-a', assistantId: 'assistant-a', channel: 'INTERNAL', state: 'OPEN', customerReference: 'Visitor abc123', lastMessageAt: '2026-10-14T10:00:00.000Z', lastMessagePreview: 'Hello', createdAt: '2026-10-14T10:00:00.000Z', unread: true, assistant: { name: 'Support assistant' }, _count: { messages: 1 } }],
  assistantOptions: [{ assistantId: 'assistant-a', assistant: { name: 'Support assistant' } }], channelOptions: ['INTERNAL'], page: 1, pageSize: 25, total: 1, unreadCount: 1, availability: 'AVAILABLE', note: '',
};
const detail = {
  id: 'conversation-a', assistantId: 'assistant-a', channel: 'INTERNAL', state: 'OPEN', customerReference: 'Visitor abc123', lastMessageAt: '2026-10-14T10:00:00.000Z', createdAt: '2026-10-14T10:00:00.000Z', assistant: { id: 'assistant-a', name: 'Support assistant' },
  messages: [{ id: 'message-a', kind: 'CUSTOMER', content: '<img src=x onerror=alert(1)>', provider: null, model: null, sourceRefs: null, createdAt: '2026-10-14T10:00:00.000Z', author: null }], messagePage: 1, messagePageSize: 50, messageTotal: 1, hasOlderMessages: false,
};

describe('ConversationsPage', () => {
  beforeEach(() => {
    vi.mocked(getConversations).mockResolvedValue(inbox);
    vi.mocked(getConversation).mockResolvedValue(detail);
  });

  it('renders persisted customer content as text without executing markup', async () => {
    render(<MemoryRouter initialEntries={['/workspace/example/conversations']}><Routes><Route path="/workspace/:slug/conversations" element={<ConversationsPage/>}/></Routes></MemoryRouter>);
    await screen.findByText('Visitor abc123');
    screen.getByRole('button', { name: /Visitor abc123/ }).click();
    await waitFor(() => expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument());
    expect(document.querySelector('img')).toBeNull();
  });
});
