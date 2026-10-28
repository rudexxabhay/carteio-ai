import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketsPage } from '../pages/saas/SaasPages';
import { getTicket, getTickets, replyToTicket, type TicketDetail, type TicketRow } from '../services/api/saas';

vi.mock('../services/api/saas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/saas')>();
  return { ...actual, getTickets: vi.fn(), getTicket: vi.fn(), replyToTicket: vi.fn(), updateTicket: vi.fn(), assignTicket: vi.fn(), addTicketNote: vi.fn() };
});
const ticketRow: TicketRow = { id: 'ticket-id', reference: 'TKT-ABC123', title: 'Refund status', category: 'BILLING', priority: 'MEDIUM', status: 'OPEN', customerReference: 'Visitor abc123', createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', assistant: { id: 'assistant', name: 'Store assistant' }, conversation: { channel: 'WEB', lastMessageAt: null, lastMessagePreview: null } };
const ticketPage = { items: [ticketRow], page: 1, pageSize: 25, total: 1, summary: { total: 1, OPEN: 1, ACTIVE: 0, PENDING: 0, CLOSED: 0 }, assistantOptions: [], assigneeOptions: [], categoryOptions: ['BILLING'] };
const ticketDetail: TicketDetail = { ...ticketRow, description: 'Customer refund is delayed.', resolutionRemarks: null, version: 1, expiresAt: '2026-11-14T10:00:00.000Z', assignee: null, conversation: { id: 'conversation-id', channel: 'WEB', lastMessageAt: null }, messages: [{ id: 'customer-message', kind: 'CUSTOMER', content: 'Where is my refund?', createdAt: '2026-10-14T10:00:00.000Z', author: null, outboundDelivery: null }], messagePage: 1, messagePageSize: 50, messageTotal: 1, hasOlderMessages: false, notes: [], events: [], members: [] };

describe('TicketsPage', () => {
  beforeEach(() => { vi.mocked(getTickets).mockResolvedValue(ticketPage); vi.mocked(getTicket).mockResolvedValue(ticketDetail); vi.mocked(replyToTicket).mockResolvedValue({ id: 'business-message', kind: 'BUSINESS_TEAM', content: 'We are checking.', deliveryState: 'UNSUPPORTED_CHANNEL', idempotent: false }); });
  it('shows persisted ticket data and never presents unsupported transport as delivered', async () => {
    render(<MemoryRouter initialEntries={['/workspace/acme/tickets']}><Routes><Route path="/workspace/:slug/tickets" element={<TicketsPage/>}/><Route path="/workspace/:slug/tickets/:ticketId" element={<TicketsPage/>}/></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /TKT-ABC123 Refund status/ }));
    await screen.findByText('Where is my refund?');
    fireEvent.change(screen.getByLabelText('Reply to customer'), { target: { value: 'We are checking.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/customer delivery is unsupported/i);
    expect(screen.queryByText(/delivery confirmed/i)).toBeNull();
  });
});
