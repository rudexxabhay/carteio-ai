import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ listKnowledge: vi.fn(), listKnowledgeBases: vi.fn(), preview: vi.fn(), importFaqs: vi.fn(), activate: vi.fn(), listAssistants: vi.fn(), getWorkspace: vi.fn(), effectiveKnowledge: vi.fn() }));
vi.mock('../services/api/knowledge', async importOriginal => ({ ...(await importOriginal<typeof import('../services/api/knowledge')>()), listKnowledge: mocks.listKnowledge, activateCustomerKnowledge: mocks.activate, getDocumentCapabilities: vi.fn().mockResolvedValue({ uploadAvailable: false, blockedReason: 'DOCUMENTS_DISABLED' }) }));
vi.mock('../services/api/knowledge-bases', async importOriginal => ({ ...(await importOriginal<typeof import('../services/api/knowledge-bases')>()), listKnowledgeBases: mocks.listKnowledgeBases, getEffectiveKnowledge: mocks.effectiveKnowledge, previewKnowledgeBaseFaqImport: mocks.preview, importKnowledgeBaseFaqs: mocks.importFaqs }));
vi.mock('../services/api/assistants', async importOriginal => ({ ...(await importOriginal<typeof import('../services/api/assistants')>()), listAssistants: mocks.listAssistants }));
vi.mock('../services/api/workspaces', async importOriginal => ({ ...(await importOriginal<typeof import('../services/api/workspaces')>()), getWorkspace: mocks.getWorkspace }));

import Pages from '../dashboard-source/pages';

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
beforeEach(() => {
  mocks.effectiveKnowledge.mockResolvedValue({ useAllEligibleWorkspaceKnowledge: false, retrievalEnabled: false, effectiveSourceCount: 0 });
  mocks.listKnowledge.mockResolvedValue({ sources: [], total: 0 });
  mocks.listAssistants.mockResolvedValue({ assistants: [{ id: 'assistant-1', name: 'Carteio', status: 'ACTIVE' }], page: 1, pageSize: 100, total: 1 });
  mocks.getWorkspace.mockResolvedValue({ id: 'workspace-1', slug: 'north', name: 'North', role: 'owner', currentUserRole: 'owner' });
  mocks.listKnowledgeBases.mockResolvedValue({ knowledgeBases: [{ id: 'base-1', name: 'Support', status: 'active' }], total: 1, page: 1, pageSize: 100, summary: {} });
});

describe('active dashboard FAQ file import', () => {
  it('filters saved sections without reclassifying legacy sources and keeps large controls closed', async () => {
    const user = userEvent.setup();
    const sourceFixtures = [
      { id: 'shipping', type: 'faq', name: 'Delivery conditions', processingStatus: 'ready', knowledgeSection: 'SHIPPING_DELIVERY' },
      { id: 'returns', type: 'text', name: 'Refund conditions', processingStatus: 'processing', knowledgeSection: 'RETURNS_REFUNDS' },
      { id: 'legacy', type: 'faq', name: 'Legacy information', processingStatus: 'ready', knowledgeSection: null },
    ];
    mocks.listKnowledge.mockImplementation((_slug: string, _signal: AbortSignal, query: { section?: string }) => Promise.resolve({ sources: sourceFixtures.filter(source => !query.section || (query.section === 'UNCLASSIFIED' ? source.knowledgeSection === null : source.knowledgeSection === query.section)), total: 3, pageCount: 1, counts: [] }));
    render(<Pages page="knowledge" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="owner"/>);
    expect(screen.queryByRole('button', { name: 'Delivery conditions' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Excel workbook or CSV (.xlsx, .csv)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assistant for customer knowledge activation')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Shipping & Delivery/ }));
    expect(await screen.findByRole('button', { name: 'Delivery conditions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refund conditions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Legacy information' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Legacy \/ Unclassified/ }));
    expect(await screen.findByRole('button', { name: 'Legacy information' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delivery conditions' })).not.toBeInTheDocument();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('keeps a failed file selected, retries that same file, imports only after preview, and reports indexing as queued', async () => {
    const user = userEvent.setup();
    const file = new File(['xlsx bytes'], 'support-faqs.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    mocks.preview.mockRejectedValueOnce(new Error('temporary preview error')).mockResolvedValueOnce({ total: 1, valid: 1, invalid: 0, duplicates: 0, rows: [{ rowNumber: 2, question: 'How can I contact support?', answer: 'Use the official channel.', errors: [], duplicateInFile: false, duplicateExisting: false }] });
    mocks.importFaqs.mockResolvedValue({ created: 1, skipped: 0, failed: 0, updated: 0, duplicateRowsInFile: 0 });

    render(<Pages page="knowledge" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await user.click(screen.getByRole('button', { name: /^Business Introduction/ }));
    await user.click(screen.getByRole('button', { name: '+ Add Knowledge' }));
    await user.click(screen.getByRole('button', { name: 'Import Excel / CSV' }));
    const input = await screen.findByLabelText('Excel workbook or CSV (.xlsx, .csv)') as HTMLInputElement;
    await user.upload(input, file);
    expect(await screen.findByText('Selected file: support-faqs.xlsx')).toBeInTheDocument();
    expect(await screen.findByText('Excel file could not be validated.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry validation' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Import valid FAQ rows' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry validation' }));
    expect(await screen.findByText('1 valid')).toBeInTheDocument();
    expect(screen.getByText('Selected file: support-faqs.xlsx')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Default visibility for rows without a visibility column/), 'PUBLIC_REFERENCE');
    await user.click(screen.getByRole('button', { name: 'Import valid FAQ rows' }));
    await waitFor(() => expect(mocks.importFaqs).toHaveBeenCalledWith('north', 'base-1', file, 'SKIP_EXISTING', 'PUBLIC_REFERENCE', 'BUSINESS_INTRODUCTION'));
    expect(await screen.findByText(/1 created, 0 skipped, 0 failed, 0 updated/)).toBeInTheDocument();
    expect(screen.getByText(/Indexing is queued separately/)).toBeInTheDocument();
  });

  it('clears the selected file and blocks import when the user removes it', async () => {
    const user = userEvent.setup();
    mocks.preview.mockResolvedValue({ total: 1, valid: 1, invalid: 0, duplicates: 0, rows: [{ rowNumber: 2, question: 'Q?', answer: 'A.', errors: [], duplicateInFile: false, duplicateExisting: false }] });
    render(<Pages page="knowledge" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="owner"/>);
    await user.click(screen.getByRole('button', { name: /^Business Introduction/ }));
    await user.click(screen.getByRole('button', { name: '+ Add Knowledge' }));
    await user.click(screen.getByRole('button', { name: 'Import Excel / CSV' }));
    const input = await screen.findByLabelText('Excel workbook or CSV (.xlsx, .csv)') as HTMLInputElement;
    await user.upload(input, new File(['csv'], 'faqs.csv', { type: 'text/csv' }));
    expect(await screen.findByText('Selected file: faqs.csv')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove file' }));
    expect(screen.queryByText('Selected file: faqs.csv')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import valid FAQ rows' })).not.toBeInTheDocument();
  });

  it('renders owner bulk visibility review in the active dashboard and persists only selected FAQ IDs', async () => {
    const user = userEvent.setup();
    mocks.listKnowledge.mockResolvedValue({ sources: [
      { id: 'faq-a', type: 'faq', status: 'registered', processingStatus: 'ready', visibility: 'INTERNAL_RESTRICTED', name: 'Shipping FAQ' },
      { id: 'faq-b', type: 'faq', status: 'registered', processingStatus: 'ready', visibility: 'PUBLIC_REFERENCE', name: 'Public FAQ' },
      { id: 'text-a', type: 'text', status: 'registered', processingStatus: 'ready', visibility: 'INTERNAL_RESTRICTED', name: 'Internal notes' },
    ], total: 3 });
    mocks.activate.mockResolvedValue({ assistantId: 'assistant-1', useAllEligibleWorkspaceKnowledge: true, requested: 1, changedToPublic: 1, alreadyPublic: 0, blocked: 0, blockedReasons: {} });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Pages page="knowledge" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="OWNER"/>);
    await user.click(screen.getByRole('button', { name: 'Assistant Access' }));
    expect(await screen.findByText(/1 public FAQ\(s\) · 1 restricted FAQ\(s\)/)).toBeInTheDocument();
    expect(await screen.findByText(/Automatic customer knowledge: Disabled/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Shipping FAQ/ }));
    await user.click(screen.getByRole('button', { name: /Enable customer knowledge for assistant/ }));
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith('north', 'assistant-1', ['faq-a']));
    expect(mocks.activate).not.toHaveBeenCalledWith('north', 'assistant-1', expect.arrayContaining(['text-a']));
    expect(await screen.findByText(/Assistant-wide knowledge access enabled/)).toBeInTheDocument();
  });

  it('does not render the visibility mutation control for non-owners', async () => {
    mocks.getWorkspace.mockResolvedValueOnce({ id: 'workspace-1', slug: 'north', name: 'North', role: 'member', currentUserRole: 'member' });
    render(<Pages page="knowledge" go={vi.fn()} notify={vi.fn()} workspaceSlug="north" workspaceRole="member"/>);
    await userEvent.click(screen.getByRole('button', { name: 'Assistant Access' }));
    expect(await screen.findByText(/Only an owner can enable workspace-wide customer knowledge/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enable customer knowledge for assistant/ })).not.toBeInTheDocument();
  });
});
