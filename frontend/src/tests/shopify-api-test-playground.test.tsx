import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRun = vi.hoisted(() => vi.fn());
vi.mock('../services/api/connectors', async importOriginal => ({ ...(await importOriginal<typeof import('../services/api/connectors')>()), runShopifyApiTest: mockRun }));
import { ShopifyApiTestPlayground } from '../pages/saas/ShopifyApiTestPlayground';
import type { ConnectorInstance, ConnectorPermissions } from '../services/api/connectors';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const connector = { id: 'connector-a', connectorId: 'shopify_v1', connectorType: 'SHOPIFY', connectorVersion: '1', displayName: 'Store', configuration: { shopDomain: 'store.myshopify.com' }, state: 'CONNECTED', verifiedCapabilities: [], lastVerifiedAt: null, lastErrorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hasCredentials: true } as ConnectorInstance;
const permissions: ConnectorPermissions = { connectorInstanceId: 'connector-a', assistantId: null, categories: [], assistants: [], shopifyScopeSnapshot: { shopDomain: 'store.myshopify.com', freshness: 'FRESH', scopes: [{ handle: 'read_products', description: 'View products', granted: true, accessType: 'READ', sensitivity: 'BUSINESS', supported: true, operations: [] }], operations: [], connectionState: 'CONNECTED', declaredScopesStatus: 'UNAVAILABLE', grantedScopeCount: 1, supportedOperationCount: 0, assistantEnabledCount: 0, verifiedAt: null, capabilityVerifiedAt: null, lastSuccessfulSyncAt: null } };

describe('Shopify API Test Playground', () => {
  it('sends the selected live search to the backend and labels returned data as live', async () => {
    mockRun.mockResolvedValue({ requestId: 'request-a', operation: 'SEARCH_LIVE_PRODUCTS', source: 'LIVE_SHOPIFY_API', success: true, httpStatus: 200, graphqlErrorCount: 0, permissionStatus: 'GRANTED', durationMs: 18, resultCount: 1, data: [{ id: 'gid://shopify/Product/1', title: 'Black shoes' }] });
    const { container } = render(<ShopifyApiTestPlayground slug="workspace" connector={connector} permissions={permissions} assistantId="" canManage/>);
    expect(screen.getByText('Development only · temporary')).toHaveAttribute('title', 'This temporary testing panel will be removed once the feature is stable.');
    fireEvent.change(screen.getByRole('combobox', { name: 'Shopify test operation' }), { target: { value: 'SEARCH_LIVE_PRODUCTS' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Shopify test search query' }), { target: { value: 'black shoes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    await waitFor(() => expect(mockRun).toHaveBeenCalledWith('workspace', 'connector-a', { operation: 'SEARCH_LIVE_PRODUCTS', query: 'black shoes' }));
    expect(await screen.findByText('Black shoes')).toBeInTheDocument();
    expect(container.querySelector('.shopify-api-test-result p')?.textContent).toContain('LIVE SHOPIFY API');
  });

  it('allows a collection listing with no search term', async () => {
    mockRun.mockResolvedValue({ requestId: 'request-b', operation: 'LIST_COLLECTIONS', source: 'LIVE_SHOPIFY_API', success: true, httpStatus: 200, durationMs: 8, resultCount: 0, data: [] });
    render(<ShopifyApiTestPlayground slug="workspace" connector={connector} permissions={permissions} assistantId="" canManage/>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Shopify test operation' }), { target: { value: 'LIST_COLLECTIONS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    await waitFor(() => expect(mockRun).toHaveBeenCalledWith('workspace', 'connector-a', { operation: 'LIST_COLLECTIONS' }));
  });
});
