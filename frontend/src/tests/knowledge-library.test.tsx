import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeLibrary } from '../dashboard-source/KnowledgeLibrary';

const mocks = vi.hoisted(() => ({
  listKnowledge: vi.fn(),
  listAssistants: vi.fn(),
  getEffectiveKnowledge: vi.fn(),
  listKnowledgeBases: vi.fn(),
  createKnowledgeBase: vi.fn(),
  getDocumentCapabilities: vi.fn(),
  uploadKnowledgePdf: vi.fn(),
  getKnowledgeSource: vi.fn(),
  getKnowledgeProcessing: vi.fn(),
  reindexKnowledge: vi.fn(),
  archiveKnowledge: vi.fn(),
  getKnowledgeDeleteImpact: vi.fn(),
  permanentlyDeleteKnowledge: vi.fn(),
}));
vi.mock('../services/api/knowledge', () => ({
  listKnowledge: mocks.listKnowledge,
  getDocumentCapabilities: mocks.getDocumentCapabilities,
  uploadKnowledgePdf: mocks.uploadKnowledgePdf,
  getKnowledgeSource: mocks.getKnowledgeSource,
  getKnowledgeProcessing: mocks.getKnowledgeProcessing,
  reindexKnowledge: mocks.reindexKnowledge,
  archiveKnowledge: mocks.archiveKnowledge,
  getKnowledgeDeleteImpact: mocks.getKnowledgeDeleteImpact,
  permanentlyDeleteKnowledge: mocks.permanentlyDeleteKnowledge,
}));
vi.mock('../services/api/assistants', () => ({ listAssistants: mocks.listAssistants }));
vi.mock('../services/api/knowledge-bases', () => ({ getEffectiveKnowledge: mocks.getEffectiveKnowledge, listKnowledgeBases: mocks.listKnowledgeBases, createKnowledgeBase: mocks.createKnowledgeBase }));
vi.mock('../pages/knowledge/BusinessDataVisibility', () => ({ BusinessDataVisibility: () => <div>Shopify connector view</div> }));

const empty = { sources: [], total: 0, page: 1, pageSize: 100, counts: [], pdfCounts: [] };

describe('KnowledgeLibrary', () => {
  beforeEach(() => {
    mocks.listKnowledge.mockReset().mockResolvedValue(empty);
    mocks.listAssistants.mockReset().mockResolvedValue({ assistants: [{ id: 'assistant-1', name: 'Store assistant', status: 'active' }] });
    mocks.getEffectiveKnowledge.mockReset().mockResolvedValue({ sources: [], searchableSourceCount: 0, effectiveSourceCount: 0 });
    mocks.listKnowledgeBases.mockReset().mockResolvedValue({ knowledgeBases: [{ id: 'base-1', name: 'Business Knowledge', status: 'active' }] });
    mocks.createKnowledgeBase.mockReset();
    mocks.getDocumentCapabilities.mockReset().mockResolvedValue({ uploadAvailable: true, maxBytes: 10 * 1024 * 1024, maxPages: 200, workerEnabled: true, blockedReason: null });
    mocks.getKnowledgeSource.mockReset().mockResolvedValue({ id: 'source-new', name: 'shipping.pdf', status: 'registered', processingStatus: 'ready', knowledgeSection: 'SHIPPING_DELIVERY', visibility: 'INTERNAL_RESTRICTED', updatedAt: '2026-01-01T00:00:00.000Z', document: { filename: 'shipping.pdf', bytes: 100, hash: 'hash', contentHash: 'content-hash', sourceLanguage: 'en', extracted: true, pages: [{ page: 1, start: 0, end: 24, heading: null, contentHash: 'page-hash', wordCount: 4, extractionWarnings: [] }], pageCount: 1, characterCount: 24, wordCount: 4, warnings: [] }, contentBody: 'Dispatch within 2 days.' });
    mocks.getKnowledgeProcessing.mockReset().mockResolvedValue({ processingStatus: 'READY', documentProgress: { stage: 'READY', pagesExtracted: 1, pagesPersisted: 1, chunksIndexed: 1 } , jobs: [], chunkCount: 1 });
    mocks.uploadKnowledgePdf.mockReset().mockResolvedValue({ id: 'source-new' });
    mocks.reindexKnowledge.mockReset(); mocks.archiveKnowledge.mockReset(); mocks.getKnowledgeDeleteImpact.mockReset(); mocks.permanentlyDeleteKnowledge.mockReset();
  });

  it('shows real source counts, five static sections, Shopify navigation, and no invented documents', async () => {
    mocks.listKnowledge.mockResolvedValue({ ...empty, counts: [
      { section: 'SHIPPING_DELIVERY', status: 'ready', count: 2 },
      { section: 'BUSINESS_INTRODUCTION', status: 'failed', count: 1 },
    ], pdfCounts: [
      { section: 'SHIPPING_DELIVERY', status: 'ready', count: 2 },
      { section: 'BUSINESS_INTRODUCTION', status: 'failed', count: 1 },
    ] });
    render(<KnowledgeLibrary slug="north-overview" role="owner"/>);
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Business Introduction/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Shipping & Delivery/ })).toHaveTextContent('2 PDFs');
    expect(screen.getByRole('button', { name: /Products & Collections/ })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getEffectiveKnowledge).toHaveBeenCalledWith('north-overview', 'assistant-1', expect.any(AbortSignal)));
  });

  it('opens a section document view with an honest empty state and the real PDF upload action', async () => {
    render(<KnowledgeLibrary slug="north-section" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload PDF/ })).toBeEnabled();
    expect(mocks.listKnowledge).toHaveBeenLastCalledWith('north-section', expect.any(AbortSignal), expect.objectContaining({ section: 'SHIPPING_DELIVERY', pdfOnly: true }));
  });

  it('uses persisted PDF-only counts when legacy Knowledge sources are also present', async () => {
    mocks.listKnowledge.mockResolvedValue({ ...empty, total: 159, counts: [{ section: 'BUSINESS_INTRODUCTION', status: 'ready', count: 159 }], pdfCounts: [{ section: 'BUSINESS_INTRODUCTION', status: 'ready', count: 1 }] });
    render(<KnowledgeLibrary slug="north-pdf-counts" role="owner"/>);
    const pdfMetric = screen.getByText('PDF documents').closest('.knowledge-metric');
    await waitFor(() => expect(pdfMetric).toHaveTextContent('1'));
    expect(screen.getByRole('button', { name: /Business Introduction/ })).toHaveTextContent('1 PDFs');
  });

  it('uploads an English PDF to the selected section and opens persisted page details', async () => {
    render(<KnowledgeLibrary slug="north-upload" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Upload PDF/ }));
    expect(screen.getByText(/Original PDF bytes are discarded/)).toBeInTheDocument();
    const file = new File(['bounded pdf bytes'], 'shipping.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('PDF file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload & Process' }));
    await waitFor(() => expect(mocks.uploadKnowledgePdf).toHaveBeenCalledWith('north-upload', file, expect.objectContaining({ knowledgeBaseId: 'base-1', knowledgeSection: 'SHIPPING_DELIVERY', visibility: 'INTERNAL_RESTRICTED' }), undefined));
    expect(await screen.findByText('Extracted pages')).toBeInTheDocument();
    expect(await screen.findByText('Dispatch within 2 days.')).toBeInTheDocument();
  });

  it('searches within the selected section and opens the Shopify-only connector view', async () => {
    render(<KnowledgeLibrary slug="north-filter" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Returns & Refunds/ }));
    const search = await screen.findByRole('textbox', { name: 'Search documents in section' });
    fireEvent.change(search, { target: { value: 'refund policy' } });
    await waitFor(() => expect(mocks.listKnowledge).toHaveBeenLastCalledWith('north-filter', expect.any(AbortSignal), expect.objectContaining({ section: 'RETURNS_REFUNDS', search: 'refund policy' })));
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge Base' }));
    fireEvent.click(screen.getByRole('button', { name: /Products & Collections/ }));
    expect(await screen.findByText('Shopify connector view')).toBeInTheDocument();
  });

  it('keeps the drawer in a loading state until Knowledge Bases finish loading', async () => {
    let resolveBases!: (value: { knowledgeBases: Array<{ id: string; name: string; status: string }> }) => void;
    mocks.listKnowledgeBases.mockReturnValueOnce(new Promise(resolve => { resolveBases = resolve; }));
    render(<KnowledgeLibrary slug="north-loading" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Upload PDF/ }));
    expect(await screen.findByText('Loading your Knowledge Bases…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a Knowledge Base' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Knowledge Base' })).toBeDisabled();
    resolveBases({ knowledgeBases: [{ id: 'carteio-base', name: 'Carteio', status: 'ACTIVE' }] });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Knowledge Base' })).toHaveValue('carteio-base'));
    expect(screen.queryByRole('button', { name: 'Create a Knowledge Base' })).not.toBeInTheDocument();
  });

  it('retains a manually selected Knowledge Base when reopening the drawer without refetching', async () => {
    mocks.listKnowledgeBases.mockResolvedValueOnce({ knowledgeBases: [
      { id: 'base-a', name: 'Store Policies', status: 'ACTIVE' },
      { id: 'base-b', name: 'Support Library', status: 'ACTIVE' },
    ] });
    render(<KnowledgeLibrary slug="north-multiple" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Upload PDF/ }));
    const select = await screen.findByRole('combobox', { name: 'Knowledge Base' });
    await waitFor(() => expect(select).toHaveValue(''));
    fireEvent.change(select, { target: { value: 'base-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close document dialog' }));
    fireEvent.click(screen.getByRole('button', { name: /Upload PDF/ }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Knowledge Base' })).toHaveValue('base-b'));
    expect(mocks.listKnowledgeBases).toHaveBeenCalledTimes(1);
  });

  it('offers Knowledge Base creation only after the loaded empty state and after an explicit click', async () => {
    mocks.listKnowledgeBases.mockResolvedValueOnce({ knowledgeBases: [] });
    render(<KnowledgeLibrary slug="north-no-base" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Upload PDF/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create a Knowledge Base' }));
    expect(screen.getByLabelText('Knowledge Base name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Knowledge Base' })).toBeInTheDocument();
  });

  it('shows a friendly capability message with the diagnostic code disclosed only on expansion', async () => {
    mocks.getDocumentCapabilities.mockResolvedValueOnce({ uploadAvailable: false, maxBytes: 0, maxPages: 0, workerEnabled: false, blockedReason: 'DOCUMENTS_DISABLED' });
    render(<KnowledgeLibrary slug="north-disabled" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Upload PDF/ }));
    expect(await screen.findByText(/PDF uploads are paused by server configuration/)).toBeInTheDocument();
    const details = screen.getByText('Technical details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('DOCUMENTS_DISABLED');
  });

  it('keeps Knowledge Base API failures distinct from an empty list and can retry', async () => {
    mocks.listKnowledgeBases.mockRejectedValueOnce(new Error('temporary API failure'));
    render(<KnowledgeLibrary slug="north-base-error" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Upload PDF/ }));
    expect(await screen.findByText(/Could not load Knowledge Bases/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a Knowledge Base' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Knowledge Base' })).toHaveValue('base-1'));
    expect(mocks.listKnowledgeBases).toHaveBeenCalledTimes(2);
  });

  it('surfaces capability transport failure as retryable and keeps its diagnostic behind expansion', async () => {
    mocks.getDocumentCapabilities.mockRejectedValueOnce(new Error('temporary capability failure'));
    render(<KnowledgeLibrary slug="north-capability-error" role="owner"/>);
    fireEvent.click(await screen.findByRole('button', { name: /Shipping & Delivery/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Upload PDF/ }));
    expect(await screen.findByText(/Could not check PDF processing availability/)).toBeInTheDocument();
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.getDocumentCapabilities).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('PDF file')).toBeEnabled());
  });
});
