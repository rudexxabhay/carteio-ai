import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connectors: vi.fn(), permissions: vi.fn(), history: vi.fn(), queue: vi.fn(), retry: vi.fn() }));
vi.mock('../services/api/connectors', async (load) => ({ ...(await load<typeof import('../services/api/connectors')>()), getConnectors: mocks.connectors, getConnectorPermissions: mocks.permissions, getConnectorSyncHistory: mocks.history, queueConnectorSync: mocks.queue, retryConnectorSync: mocks.retry }));
import { BusinessDataVisibility } from '../pages/knowledge/BusinessDataVisibility';

describe('BusinessDataVisibility Shopify section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectors.mockResolvedValue({ items: [{ id: 'connector-1', connectorId: 'shopify_v1', displayName: 'Shopify', state: 'CONNECTED', lastSyncAt: null, latestSyncJob: null }] });
    mocks.permissions.mockResolvedValue({ connectorInstanceId: 'connector-1', assistantId: 'assistant-1', categories: [{ category: 'PRODUCTS', providerGranted: true, syncEnabled: true, effective: true }], assistants: [{ id: 'assistant-1', name: 'Support', status: 'ACTIVE' }], shopifyScopeSnapshot: { shopDomain: 'shop.example', connectionState: 'CONNECTED', freshness: 'FRESH', lastSuccessfulSyncAt: null, operations: [{ category: 'PRODUCTS', operation: 'Product search', requiredScopes: ['read_products'], dataRecordCount: 1, eligible: true, blockedReason: null }], scopes: [{ handle: 'read_products', granted: true }] }, storedRecordCounts: { products: 1, variants: 2, productsWithPrices: 1, productsWithInventory: 0, categorizedProducts: 1, collections: 1, orders: 0, contentByCategory: {} } });
    mocks.history.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  });

  it('offers authorized Shopify refresh using existing sync controls', async () => {
    render(<BusinessDataVisibility slug="acme" manager/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh products' }));
    await waitFor(() => expect(mocks.queue).toHaveBeenCalledWith('acme', 'connector-1', 'PRODUCTS', 'INCREMENTAL'));
  });
});
