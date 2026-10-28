import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pages: vi.fn(), page: vi.fn(), settings: vi.fn(), createWebsite: vi.fn(), details: vi.fn(), crawl: vi.fn(), connectors: vi.fn(), permissions: vi.fn(), history: vi.fn(), queue: vi.fn(), retry: vi.fn() }));
vi.mock('../services/api/knowledge', async (load) => ({ ...(await load<typeof import('../services/api/knowledge')>()), listWebsitePages: mocks.pages, getWebsitePage: mocks.page, updateWebsiteSyncSettings: mocks.settings, createWebsiteSource: mocks.createWebsite, getWebsiteSourceDetails: mocks.details, crawlWebsiteSource: mocks.crawl }));
vi.mock('../services/api/connectors', async (load) => ({ ...(await load<typeof import('../services/api/connectors')>()), getConnectors: mocks.connectors, getConnectorPermissions: mocks.permissions, getConnectorSyncHistory: mocks.history, queueConnectorSync: mocks.queue, retryConnectorSync: mocks.retry }));

import { BusinessDataVisibility } from '../pages/knowledge/BusinessDataVisibility';

const siteData = { pages: [{ id: 'page-1', sourceId: 'site-1', website: 'Shop site', domain: 'shop.example', title: 'Returns', canonicalUrl: 'https://shop.example/returns', category: 'RETURNS', crawlStatus: 'READY', preview: 'Return policy text.', contentHash: 'abc123456789', sourceVersion: 2, generation: 4, crawledAt: '2026-01-01T00:00:00.000Z', indexedAt: '2026-01-01T00:01:00.000Z', indexedChunkCount: 2, searchReady: true, assignedAssistants: [{ id: 'assistant-1', name: 'Support', status: 'ACTIVE' }], availability: 'AI_READY', errorCode: null }], sources: [{ id: 'site-1', name: 'Shop site', url: 'https://shop.example', domain: 'shop.example', verificationStatus: 'VERIFIED', verifiedAt: '2026-01-01T00:00:00.000Z', syncPolicy: 'MANUAL', syncPaused: false, processingStatus: 'READY', pageCount: 1, lastAttemptAt: '2026-01-01T00:00:00.000Z', lastSuccessfulSyncAt: '2026-01-01T00:00:00.000Z', latestRun: null, errorCode: null, assignedAssistants: [] }], total: 1, page: 1, pageSize: 20, pageCount: 1 };
const emptyData = { ...siteData, pages: [], sources: [], total: 0, pageCount: 0 };

describe('BusinessDataVisibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pages.mockResolvedValue(siteData);
    mocks.page.mockResolvedValue({ ...siteData.pages[0], content: 'Full saved return policy.' });
    mocks.settings.mockResolvedValue({});
    mocks.createWebsite.mockResolvedValue({ id: 'site-new', name: 'carteio.in', sourceUrl: 'https://carteio.in', processingStatus: 'queued', syncPolicy: 'MANUAL' });
    mocks.details.mockResolvedValue({ sourceId: 'site-new', workerEnabled: true, verificationStatus: 'VERIFIED', verifiedAt: '2026-01-01T00:00:00.000Z', processingStatus: 'NOT_PROCESSED', processingErrorCode: null, crawlJobStatus: null, crawlStage: null, syncPolicy: 'MANUAL', paused: false, lastSyncAttemptAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null });
    mocks.crawl.mockResolvedValue({ sourceId: 'site-new', jobId: 'job-1', status: 'queued', sourceVersion: 1 });
    mocks.connectors.mockResolvedValue({ items: [{ id: 'connector-1', connectorId: 'shopify_v1', displayName: 'Shopify', state: 'CONNECTED', lastSyncAt: null, latestSyncJob: null }] });
    mocks.permissions.mockResolvedValue({ connectorInstanceId: 'connector-1', assistantId: 'assistant-1', categories: [{ category: 'PRODUCTS', providerGranted: true, syncEnabled: true, effective: true }], assistants: [{ id: 'assistant-1', name: 'Support', status: 'ACTIVE' }], shopifyScopeSnapshot: { shopDomain: 'shop.example', connectionState: 'CONNECTED', freshness: 'FRESH', lastSuccessfulSyncAt: null, operations: [{ category: 'PRODUCTS', operation: 'Product search', requiredScopes: ['read_products'], dataRecordCount: 1, eligible: true, blockedReason: null }], scopes: [{ handle: 'read_products', granted: true }] }, storedRecordCounts: { products: 1, variants: 2, productsWithPrices: 1, productsWithInventory: 0, categorizedProducts: 1, collections: 1, orders: 0, contentByCategory: {} } });
    mocks.history.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    mocks.queue.mockResolvedValue({ id: 'job-1' });
  });

  it('renders real saved website records and exposes stored content on authorized detail inspection', async () => {
    render(<BusinessDataVisibility slug="acme" manager/>);
    expect(await screen.findByText('https://shop.example/returns')).toBeInTheDocument();
    expect(screen.getByText('2 indexed chunks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect stored page' }));
    expect(await screen.findByText('Full saved return policy.')).toBeInTheDocument();
    expect(mocks.page).toHaveBeenCalledWith('acme', 'page-1');
  });

  it('shows linked assistants separately from widget eligibility', async () => {
    mocks.pages.mockResolvedValue({ ...siteData, pages: [{ ...siteData.pages[0], assignedAssistants: [], linkedAssistants: [{ id: 'assistant-1', name: 'Draft Support', status: 'draft' }], domainEligibleAssistants: [], searchReady: false, availability: 'BLOCKED_ASSISTANT_ELIGIBILITY' }] });
    render(<BusinessDataVisibility slug="acme" manager/>);
    expect(await screen.findByText(/Linked assistants: Draft Support · Domain matched: None/)).toBeInTheDocument();
    expect(screen.getByText(/verified domain matches this website/i)).toBeInTheDocument();
  });

  it('uses the existing manual crawl queue only for verified website sources', async () => {
    render(<BusinessDataVisibility slug="acme" manager/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh website' }));
    await waitFor(() => expect(mocks.crawl).toHaveBeenCalledWith('acme', 'site-1'));
  });

  it('registers a website and explains that the initial crawl is queued automatically without DNS verification', async () => {
    mocks.pages.mockResolvedValueOnce(emptyData).mockResolvedValue({ ...emptyData, sources: [{ ...siteData.sources[0], id: 'site-new', name: 'carteio.in', url: 'https://carteio.in', domain: 'carteio.in', verificationStatus: 'UNVERIFIED', processingStatus: 'QUEUED', pageCount: 0 }] });
    render(<BusinessDataVisibility slug="acme" manager/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Website' }));
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://carteio.in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Website & Start Training' }));
    expect(await screen.findByText(/initial crawl has been queued automatically/i)).toBeInTheDocument();
    expect(mocks.createWebsite).toHaveBeenCalledWith('acme', { sourceUrl: 'https://carteio.in' });
    expect(screen.queryByRole('button', { name: 'Verify domain' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Train AI / Crawl Now' })).not.toBeInTheDocument();
  });

  it('allows an owner to refresh public website content without source-level DNS verification', async () => {
    mocks.pages.mockResolvedValue({ ...emptyData, sources: [{ ...siteData.sources[0], id: 'unverified', verificationStatus: 'UNVERIFIED', pageCount: 0, processingStatus: 'READY' }] });
    render(<BusinessDataVisibility slug="acme" manager/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh website' }));
    await waitFor(() => expect(mocks.crawl).toHaveBeenCalledWith('acme', 'unverified'));
  });

  it('reports when the background worker is disabled after a manual crawl is queued', async () => {
    mocks.details.mockResolvedValue({ sourceId: 'site-1', workerEnabled: false, verificationStatus: 'VERIFIED', verifiedAt: '2026-01-01T00:00:00.000Z', processingStatus: 'QUEUED', processingErrorCode: null, crawlJobStatus: 'QUEUED', crawlStage: null, syncPolicy: 'MANUAL', paused: false, lastSyncAttemptAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null });
    render(<BusinessDataVisibility slug="acme" manager/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh website' }));
    expect(await screen.findByText(/Knowledge Processing worker is disabled/i)).toBeInTheDocument();
    expect(mocks.crawl).toHaveBeenCalledWith('acme', 'site-1');
  });

  it('offers authorized Shopify refresh using existing sync controls', async () => {
    render(<BusinessDataVisibility slug="acme" manager/>);
    fireEvent.click(screen.getByRole('tab', { name: 'Shopify data' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh products' }));
    await waitFor(() => expect(mocks.queue).toHaveBeenCalledWith('acme', 'connector-1', 'PRODUCTS', 'INCREMENTAL'));
  });
});
