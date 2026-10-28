import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../services/api/client';

const mocks = vi.hoisted(() => ({
  workspace: { slug: 'north', name: 'North Workspace', role: 'owner' },
  list: vi.fn(), createBase: vi.fn(), getBase: vi.fn(), sources: vi.fn(), available: vi.fn(), addSources: vi.fn(), updateBase: vi.fn(), websitePages: vi.fn(), crawlWebsite: vi.fn(), assistants: vi.fn(), effectiveKnowledge: vi.fn(), linkAssistant: vi.fn(), unlinkAssistant: vi.fn(), createFaqBatch: vi.fn(), createText: vi.fn(), previewSearch: vi.fn(),
}));
vi.mock('../layouts/DashboardLayout/DashboardLayout', () => ({ useWorkspaceRoute: () => ({ workspace: mocks.workspace }) }));
vi.mock('../services/api/knowledge-bases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/knowledge-bases')>();
  return {
    ...actual,
    listKnowledgeBases: mocks.list, createKnowledgeBase: mocks.createBase, getKnowledgeBase: mocks.getBase,
    listKnowledgeBaseSources: mocks.sources, listAvailableKnowledgeSources: mocks.available,
    getKnowledgeBaseAssistants: mocks.assistants,
    getEffectiveKnowledge: mocks.effectiveKnowledge,
    addKnowledgeBaseSources: mocks.addSources, removeKnowledgeBaseSources: vi.fn(), createKnowledgeBaseFaq: vi.fn(), createKnowledgeBaseFaqBatch: mocks.createFaqBatch, createKnowledgeBaseText: mocks.createText,
    knowledgeBaseFaqTemplateUrl: vi.fn(), previewKnowledgeBaseFaqImport: vi.fn(), importKnowledgeBaseFaqs: vi.fn(),
    updateKnowledgeBase: mocks.updateBase, archiveKnowledgeBase: vi.fn(), linkAssistantToKnowledgeBase: mocks.linkAssistant, unlinkAssistantFromKnowledgeBase: mocks.unlinkAssistant,
  };
});
vi.mock('../services/api/knowledge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/knowledge')>();
  return { ...actual, archiveKnowledge: vi.fn(), updateKnowledge: vi.fn(), listWebsitePages: mocks.websitePages, crawlWebsiteSource: mocks.crawlWebsite, previewKnowledgeSearch: mocks.previewSearch };
});
import { KnowledgeBaseDetailPage, KnowledgeBasePage } from '../pages/knowledge/KnowledgeBasePage';

const base = { id: 'base-a', organizationId: 'org-a', createdById: 'user-a', name: 'Company Information', description: null, status: 'active' as const, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', archivedAt: null, sourceCount: 0, linkedAssistantCount: 0 };
const knowledgePage = (name = 'Company Information') => ({ knowledgeBases: [{ ...base, name }], total: 1, page: 1, pageSize: 20, summary: { totalKnowledgeBases: 1, totalSources: 0, unassignedSources: 0, linkedAssistants: 0 } });
const source = { id: 'source-a', organizationId: 'org-a', createdById: 'user-a', type: 'faq' as const, status: 'registered' as const, processingStatus: 'not_processed' as const, name: 'Return policy?', description: null, sourceUrl: null, contentBody: 'Returns within seven days.', category: null, languageHint: null, sourceVersion: 1, visibility: 'INTERNAL_RESTRICTED' as const, lastSyncAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null, deletedAt: null, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' };
const websiteSource = { ...source, id: 'website-a', type: 'website' as const, processingStatus: 'ready' as const, name: 'carteio.in', sourceUrl: 'https://carteio.in', visibility: 'PUBLIC_REFERENCE' as const, pageCount: 7, activeIndexGeneration: 2 };
const explicitKnowledgeResolution = { mode: 'EXPLICIT_ASSIGNMENT_REQUIRED' as const, isDefault: false, activeKnowledgeBaseCount: 2 };
const sourcePage = (sources: Array<typeof source | typeof websiteSource> = []) => ({ sources, total: sources.length, page: 1, pageSize: 20, summary: { sourceCount: sources.length, byType: sources.length ? { faq: sources.filter((item) => item.type === 'faq').length, website: sources.filter((item) => item.type === 'website').length } : {}, byProcessingStatus: sources.length ? { not_processed: sources.filter((item) => item.processingStatus === 'not_processed').length, ready: sources.filter((item) => item.processingStatus === 'ready').length } : {} } });
const tree = () => <MemoryRouter initialEntries={[`/workspace/${mocks.workspace.slug}/knowledge`]}><Routes><Route path="/workspace/:slug/knowledge" element={<KnowledgeBasePage/>}/><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); mocks.workspace = { slug: 'north', name: 'North Workspace', role: 'owner' }; });
beforeEach(() => { mocks.effectiveKnowledge.mockResolvedValue({ organizationId: 'org-a', assistantId: 'assistant-a', resolution: 'SINGLE_ACTIVE_BASE_DEFAULT', defaultKnowledgeBaseId: 'base-a', knowledgeBases: [{ id: 'base-a', name: 'Company Information', status: 'active', assignment: 'WORKSPACE_DEFAULT', eligibleSourceCount: 1, retrievalEnabled: true }], sources: [], retrievalEnabled: true }); });

describe('Knowledge Base workspace UI', () => {
  it('renders the Knowledge Base summary including linked assistants', async () => {
    mocks.list.mockResolvedValue(knowledgePage());
    render(tree());

    expect(await screen.findByRole('region', { name: 'Knowledge Base summary' })).toBeInTheDocument();
    expect(screen.getByText('Linked assistants')).toBeInTheDocument();
  });

  it('creates a collection and exposes only supported knowledge entry methods', async () => {
    mocks.list.mockResolvedValue(knowledgePage());
    mocks.createBase.mockResolvedValue(base);
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage());
    mocks.assistants.mockResolvedValue({ linked: [], available: [] });
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('button', { name: /Create Knowledge Base/ }));
    await user.type(screen.getByLabelText('Name'), 'Support');
    await user.click(screen.getByRole('button', { name: /Create and open/ }));
    await user.click(await screen.findByRole('button', { name: /Add Knowledge/ }));
    expect(await screen.findByRole('button', { name: /Add Question & Answer/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import FAQs from Excel\/CSV/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Text Knowledge/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Website/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Website URL')).not.toBeInTheDocument();
  });

  it('selects all filtered available sources and assigns them to the current base in bounded bulk batches', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage());
    mocks.assistants.mockResolvedValue({ linked: [], available: [] });
    mocks.available.mockResolvedValue({ sources: [{ ...source, id: 'faq-1' }, { ...source, id: 'faq-2', name: 'Shipping?' }], total: 2, page: 1, pageSize: 100 });
    mocks.addSources.mockResolvedValue({ requested: 2, added: 2, alreadyPresent: 0, restrictedVisibility: 2, processingBlocked: 2, failedProcessing: 0, statusBlocked: 0 });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    await user.click(await screen.findByRole('tab', { name: 'All Sources' }));
    await user.click(await screen.findByRole('button', { name: /Add Existing Sources/ }));
    await user.click(await screen.findByRole('button', { name: 'Select all filtered' }));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add 2 sources' }));
    await waitFor(() => expect(mocks.addSources).toHaveBeenCalledWith('north', 'base-a', ['faq-1', 'faq-2']));
  });

  it('clears collection rows from the previous workspace and ignores its stale response', async () => {
    let resolveNorth: ((value: ReturnType<typeof knowledgePage>) => void) | undefined;
    mocks.list.mockImplementation((slug: string) => slug === 'north' ? new Promise((resolve) => { resolveNorth = resolve; }) : Promise.resolve(knowledgePage('South collection')));
    const view = render(tree());
    mocks.workspace = { slug: 'south', name: 'South Workspace', role: 'owner' };
    view.rerender(tree());
    expect(await screen.findByText('South collection')).toBeInTheDocument();
    resolveNorth?.(knowledgePage('North collection'));
    expect(screen.queryByText('North collection')).not.toBeInTheDocument();
  });

  it('adds multiple FAQs in one focused workflow', async () => {
    mocks.list.mockResolvedValue(knowledgePage()); mocks.createBase.mockResolvedValue(base); mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage()); mocks.assistants.mockResolvedValue({ linked: [], available: [] });
    mocks.createFaqBatch.mockResolvedValue({ created: 1, sourceIds: ['faq-a'] });
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('button', { name: /Create Knowledge Base/ }));
    await user.type(screen.getByLabelText('Name'), 'Support');
    await user.click(screen.getByRole('button', { name: /Create and open/ }));
    await user.click(await screen.findByRole('button', { name: /Add Knowledge/ }));
    await user.click(screen.getByRole('button', { name: /Add Question & Answer/ }));
    await user.type(screen.getByLabelText('Question'), 'What is the policy?');
    await user.type(screen.getByLabelText('Answer'), 'Please refer to the approved policy.');
    await user.click(screen.getByRole('button', { name: /Add another question/ }));
    const questions = screen.getAllByLabelText('Question');
    const answers = screen.getAllByLabelText('Answer');
    await user.type(questions[1]!, 'How can I contact support?');
    await user.type(answers[1]!, 'Use the verified support channel.');
    await user.click(screen.getByRole('button', { name: 'Save 2 FAQs' }));
    expect(mocks.createFaqBatch).toHaveBeenCalledWith('north', 'base-a', expect.arrayContaining([expect.objectContaining({ question: 'What is the policy?' }), expect.objectContaining({ question: 'How can I contact support?' })]));
  });

  it('saves an optional source language hint for Text Knowledge', async () => {
    mocks.list.mockResolvedValue(knowledgePage()); mocks.createBase.mockResolvedValue(base); mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage()); mocks.assistants.mockResolvedValue({ linked: [], available: [] });
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('button', { name: /Create Knowledge Base/ }));
    await user.type(screen.getByLabelText('Name'), 'Support');
    await user.click(screen.getByRole('button', { name: /Create and open/ }));
    await user.click(await screen.findByRole('button', { name: /Add Knowledge/ }));
    await user.click(screen.getByRole('button', { name: /Add Text Knowledge/ }));
    await user.type(screen.getByLabelText('Title'), 'Arabic support details');
    await user.type(screen.getByLabelText('Content'), 'يمكن إرجاع المنتجات خلال سبعة أيام.');
    await user.type(screen.getByLabelText(/Language hint/), 'ar');
    await user.click(screen.getByRole('button', { name: 'Save text source' }));
    expect(mocks.createText).toHaveBeenCalledWith('north', 'base-a', expect.objectContaining({ title: 'Arabic support details', languageHint: 'ar' }));
  });

  it('connects an assistant from Overview and confirms the persisted relationship after refresh', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage([websiteSource]));
    const linked = { id: 'assistant-a', name: 'Store Assistant', status: 'active' };
    mocks.assistants.mockResolvedValueOnce({ linked: [], available: [linked], knowledgeResolution: explicitKnowledgeResolution }).mockResolvedValue({ linked: [linked], available: [], knowledgeResolution: explicitKnowledgeResolution });
    mocks.websitePages.mockResolvedValue({ pages: [{ id: 'page-a', sourceId: websiteSource.id, website: websiteSource.name, domain: 'carteio.in', title: 'Home', canonicalUrl: 'https://carteio.in/', category: null, crawlStatus: 'SAVED', preview: 'Welcome', contentHash: 'hash', sourceVersion: 1, generation: 2, crawledAt: '2026-10-10T00:00:00.000Z', indexedAt: '2026-10-10T00:00:00.000Z', indexedChunkCount: 8, freshness: 'FRESH', searchReady: true, assignedAssistants: [linked], linkedAssistants: [linked], domainEligibleAssistants: [linked], availability: 'AI_READY', errorCode: null }], sources: [{ id: websiteSource.id, name: websiteSource.name, url: websiteSource.sourceUrl, domain: 'carteio.in', verificationStatus: 'VERIFIED', verifiedAt: '2026-10-10T00:00:00.000Z', syncPolicy: 'MANUAL', syncPaused: false, processingStatus: 'READY', pageCount: 7, lastAttemptAt: '2026-10-10T00:00:00.000Z', lastSuccessfulSyncAt: '2026-10-10T00:00:00.000Z', freshness: 'FRESH', latestRun: { status: 'SUCCEEDED_WITH_WARNINGS', discoveredPages: 9, changedPages: 7, unchangedPages: 0, removedPages: 0, failedPages: 2, skippedPages: 0, errorCode: 'CRAWL_SNAPSHOT_INCOMPLETE', startedAt: '2026-10-10T00:00:00.000Z', finishedAt: '2026-10-10T00:00:00.000Z' }, errorCode: null, assignedAssistants: [linked], linkedAssistants: [linked], domainEligibleAssistants: [linked] }], total: 1, page: 1, pageSize: 50, pageCount: 1 });
    mocks.linkAssistant.mockResolvedValue({ assistantId: 'assistant-a', knowledgeBaseId: 'base-a', linked: true });
    const user = userEvent.setup();
    const route = () => <MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>;
    const view = render(route());
    expect(await screen.findByRole('heading', { name: 'Connected AI Assistants' })).toBeInTheDocument();
    expect(await screen.findAllByText('carteio.in')).not.toHaveLength(0);
    expect(screen.getByText(/Latest crawl: SUCCEEDED_WITH_WARNINGS · 2 failed page\(s\)/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Assistants' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Search active assistants' }), 'Store');
    await screen.findByRole('combobox', { name: 'Available assistants' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Available assistants' }), 'assistant-a');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(mocks.linkAssistant).toHaveBeenCalledWith('north', 'base-a', 'assistant-a');
    expect(await screen.findByText('Store Assistant connected to this Knowledge Base.')).toBeInTheDocument();
    expect(await screen.findByText('Explicit Knowledge Base connection: Connected · Assistant status: active')).toBeInTheDocument();
    expect(await screen.findByText('All active assistants are already connected.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Available assistants' })).not.toBeInTheDocument();
    expect(mocks.assistants).toHaveBeenCalledTimes(2);
    expect(mocks.websitePages).toHaveBeenCalledWith('north', { page: 1, pageSize: 1 }, expect.anything());
    expect(mocks.crawlWebsite).not.toHaveBeenCalled();
    view.unmount();
    render(route());
    expect(await screen.findByText('Explicit Knowledge Base connection: Connected · Assistant status: active')).toBeInTheDocument();
    expect(mocks.linkAssistant).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate connection submissions while waiting for server confirmation', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage());
    const linked = { id: 'assistant-a', name: 'Store Assistant', status: 'active' };
    mocks.assistants.mockResolvedValueOnce({ linked: [], available: [linked], knowledgeResolution: explicitKnowledgeResolution }).mockResolvedValue({ linked: [linked], available: [], knowledgeResolution: explicitKnowledgeResolution });
    let resolveLink: ((value: { assistantId: string; knowledgeBaseId: string; linked: boolean }) => void) | undefined;
    mocks.linkAssistant.mockImplementation(() => new Promise((resolve) => { resolveLink = resolve; }));
    const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Connected AI Assistants' });
    const availableAssistants = await screen.findByRole('combobox', { name: 'Available assistants' });
    await waitFor(() => expect(availableAssistants).toBeEnabled());
    await user.selectOptions(availableAssistants, 'assistant-a');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.click(screen.getByRole('button', { name: 'Connecting…' }));
    expect(mocks.linkAssistant).toHaveBeenCalledTimes(1);
    resolveLink?.({ assistantId: 'assistant-a', knowledgeBaseId: 'base-a', linked: true });
    expect(await screen.findByText('Store Assistant connected to this Knowledge Base.')).toBeInTheDocument();
  });

  it('shows a permission error returned by the assignment API without claiming success', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage());
    mocks.assistants.mockResolvedValue({ linked: [], available: [{ id: 'assistant-a', name: 'Store Assistant', status: 'active' }], knowledgeResolution: explicitKnowledgeResolution });
    mocks.linkAssistant.mockRejectedValue(new ApiError('Only workspace owners can connect assistants.', 'http', 403));
    const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Connected AI Assistants' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Available assistants' }), 'assistant-a');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only workspace owners can connect assistants.');
    expect(screen.queryByText('Store Assistant connected to this Knowledge Base.')).not.toBeInTheDocument();
  });

  it('shows an empty assistant state and a retryable assistant-list error', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage());
    mocks.assistants.mockRejectedValueOnce(new ApiError('Workspace access denied.', 'http', 403)).mockResolvedValue({ linked: [], available: [], knowledgeResolution: explicitKnowledgeResolution });
    const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load assistant connections');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No assistants are explicitly connected.')).toBeInTheDocument();
    expect(await screen.findByText('No active assistants are available in this workspace.')).toBeInTheDocument();
  });

  it('shows existing connections and excludes connected assistants from available choices', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage());
    mocks.assistants.mockResolvedValue({ linked: [{ id: 'assistant-a', name: 'Already linked', status: 'active' }], available: [{ id: 'assistant-b', name: 'Available assistant', status: 'active' }], knowledgeResolution: explicitKnowledgeResolution });
    render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText('Already linked')).toBeInTheDocument();
    const availableAssistants = within(screen.getByRole('combobox', { name: 'Available assistants' }));
    expect(availableAssistants.getByRole('option', { name: 'Available assistant' })).toBeInTheDocument();
    expect(availableAssistants.queryByRole('option', { name: 'Already linked' })).not.toBeInTheDocument();
  });

  it('uses the workspace default without manual linking and lets the knowledge preview choose an active assistant', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage([websiteSource]));
    mocks.websitePages.mockResolvedValue({ pages: [], sources: [], total: 0, page: 1, pageSize: 50, pageCount: 0 });
    mocks.assistants.mockResolvedValue({ linked: [], available: [{ id: 'assistant-a', name: 'Store Assistant', status: 'active' }], knowledgeResolution: { mode: 'WORKSPACE_DEFAULT', isDefault: true, activeKnowledgeBaseCount: 1 } });
    mocks.previewSearch.mockResolvedValue({ mode: 'lexical_only', context: 'authenticated_workspace_preview', results: [] });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText(/available automatically to active assistants/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Assistant for search preview' })).toHaveValue('assistant-a');
    await user.type(screen.getByRole('textbox', { name: 'Knowledge search query' }), 'shipping policy');
    await user.click(screen.getByRole('button', { name: 'Search knowledge' }));
    expect(mocks.previewSearch).toHaveBeenCalledWith('north', 'assistant-a', 'shipping policy');
    expect(mocks.linkAssistant).not.toHaveBeenCalled();
    expect(mocks.crawlWebsite).not.toHaveBeenCalled();
  });

  it('uses server effective eligibility instead of a stale page diagnostic and keeps partial crawl warnings', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage([websiteSource]));
    const assistant = { id: 'assistant-a', name: 'Carteio', status: 'active' };
    mocks.assistants.mockResolvedValue({ linked: [assistant], available: [], knowledgeResolution: explicitKnowledgeResolution });
    mocks.effectiveKnowledge.mockResolvedValue({ organizationId: 'org-a', assistantId: assistant.id, resolution: 'EXPLICIT_ASSIGNMENTS', defaultKnowledgeBaseId: null, knowledgeBases: [{ id: 'base-a', name: 'Company Information', status: 'active', assignment: 'EXPLICIT', eligibleSourceCount: 1, retrievalEnabled: true }], sources: [{ id: websiteSource.id, type: 'WEBSITE', sourceVersion: 1, visibility: 'PUBLIC_REFERENCE', semanticIndexStatus: 'READY', sourceOrigin: 'PUBLIC_WEBSITE' }], retrievalEnabled: true });
    mocks.websitePages.mockResolvedValue({ pages: [{ id: 'page-a', sourceId: websiteSource.id, website: websiteSource.name, domain: 'carteio.in', title: 'Home', canonicalUrl: 'https://carteio.in/', category: null, crawlStatus: 'SAVED', preview: 'Welcome', contentHash: 'hash', sourceVersion: 1, generation: 2, crawledAt: '2026-10-10T00:00:00.000Z', indexedAt: null, indexedChunkCount: 0, freshness: 'FRESH', searchReady: false, assignedAssistants: [], linkedAssistants: [assistant], domainEligibleAssistants: [], availability: 'BLOCKED_ASSISTANT_ELIGIBILITY', errorCode: null }], sources: [{ id: websiteSource.id, name: websiteSource.name, url: websiteSource.sourceUrl, domain: 'carteio.in', verificationStatus: 'UNVERIFIED', verifiedAt: null, syncPolicy: 'MANUAL', syncPaused: false, processingStatus: 'READY', pageCount: 7, lastAttemptAt: '2026-10-10T00:00:00.000Z', lastSuccessfulSyncAt: '2026-10-10T00:00:00.000Z', freshness: 'FRESH', latestRun: { status: 'SUCCEEDED_WITH_WARNINGS', discoveredPages: 9, changedPages: 7, unchangedPages: 0, removedPages: 0, failedPages: 2, skippedPages: 0, errorCode: 'CRAWL_SNAPSHOT_INCOMPLETE', startedAt: '2026-10-10T00:00:00.000Z', finishedAt: '2026-10-10T00:00:00.000Z' }, errorCode: null, assignedAssistants: [], linkedAssistants: [assistant], domainEligibleAssistants: [] }], total: 1, page: 1, pageSize: 50, pageCount: 1 });
    render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText(/Eligible in the server-resolved public knowledge set/)).toBeInTheDocument();
    expect(screen.queryByText(/Blocked for at least one saved page/)).not.toBeInTheDocument();
    expect(screen.getByText(/Partial crawl retained: 2 failed page\(s\)/)).toBeInTheDocument();
    expect(mocks.effectiveKnowledge).toHaveBeenCalledWith('north', assistant.id, expect.anything());
  });

  it('disconnects only the Knowledge Base relationship and confirms it in the refreshed list', async () => {
    mocks.getBase.mockResolvedValue(base);
    mocks.sources.mockResolvedValue(sourcePage());
    const linked = { id: 'assistant-a', name: 'Store Assistant', status: 'active' };
    mocks.assistants.mockResolvedValueOnce({ linked: [linked], available: [], knowledgeResolution: explicitKnowledgeResolution }).mockResolvedValue({ linked: [], available: [{ id: 'assistant-a', name: 'Store Assistant', status: 'active' }], knowledgeResolution: explicitKnowledgeResolution });
    mocks.unlinkAssistant.mockResolvedValue({ assistantId: 'assistant-a', knowledgeBaseId: 'base-a', unlinked: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/workspace/north/knowledge/base-a']}><Routes><Route path="/workspace/:slug/knowledge/:baseId" element={<KnowledgeBaseDetailPage/>}/></Routes></MemoryRouter>);
    await screen.findByText('Explicit Knowledge Base connection: Connected · Assistant status: active');
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(mocks.unlinkAssistant).toHaveBeenCalledWith('north', 'base-a', 'assistant-a');
    expect(await screen.findByText('Store Assistant disconnected from this Knowledge Base.')).toBeInTheDocument();
    expect(await screen.findByText('No assistants are explicitly connected.')).toBeInTheDocument();
  });
});
