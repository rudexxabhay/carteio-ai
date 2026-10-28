import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorsPage } from '../pages/saas/ConnectorsPage';
import { getConnectorCatalog, getConnectors, getConnectorPermissions, getConnectorSyncHistory, updateConnectorPermission, type ConnectorPermissions } from '../services/api/connectors';
import { ApiError } from '../services/api/client';

vi.mock('../services/api/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/connectors')>();
  return { ...actual, getConnectorCatalog: vi.fn(), getConnectors: vi.fn(), getConnectorPermissions: vi.fn(), getConnectorSyncHistory: vi.fn(), updateConnectorPermission: vi.fn() };
});

vi.mock('../services/api/knowledge', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/api/knowledge')>()), getShopifyWebsiteDiscovery: vi.fn().mockRejectedValue(new Error('not configured in this test')) }));

const assistantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productOperation = (enabled: boolean) => ({ category: 'PRODUCTS', operation: 'Product search and details', requiredScopes: ['read_products'], sensitivity: 'BUSINESS' as const, executable: true, supported: true, providerGranted: true, providerCapabilityVerified: true, dataRecordCount: 1, dataStatus: 'QUERY_READY' as const, workspaceAllowed: true, workspaceSyncEnabled: true, assistantPermissionGranted: enabled, assistantAllowed: enabled, eligible: enabled, blockedReason: enabled ? null : 'Assistant AI permission is disabled.' });
const permissionsFor = (enabled: boolean): ConnectorPermissions => ({
  connectorInstanceId: 'connector-a', assistantId: assistantId, assistants: [{ id: assistantId, name: 'Carteio', status: 'ACTIVE' }], categories: [],
  shopifyScopeSnapshot: { shopDomain: 'store.myshopify.com', connectionState: 'CONNECTED', declaredScopesStatus: 'UNAVAILABLE', grantedScopeCount: 1, supportedOperationCount: 1, assistantEnabledCount: enabled ? 1 : 0, verifiedAt: new Date().toISOString(), capabilityVerifiedAt: new Date().toISOString(), lastSuccessfulSyncAt: null, freshness: 'FRESH', operations: [productOperation(enabled)], scopes: [] },
});
const connectedShopify = { id: 'connector-a', connectorId: 'shopify_v1', connectorType: 'SHOPIFY', connectorVersion: '1.0.0', displayName: 'Store', configuration: { shopDomain: 'store.myshopify.com' }, state: 'CONNECTED', verifiedCapabilities: ['PRODUCT_CATALOG'], webhookPublicId: null, integrationConnectionId: 'commerce-a', lastVerifiedAt: new Date().toISOString(), lastErrorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hasCredentials: true, lastSyncAt: null, lastSuccessfulSyncAt: null };

describe('ConnectorsPage', () => {
  beforeEach(() => {
    vi.mocked(getConnectorCatalog).mockResolvedValue({ items: [{ id: 'shopify_v1', type: 'SHOPIFY', version: '1.0.0', name: 'Shopify', description: 'Shopify Admin GraphQL', authStrategy: 'OAUTH2', configurationSchema: { properties: {} }, credentialSchema: { properties: {} }, capabilities: ['PRODUCT_CATALOG'], syncResources: ['PRODUCTS'], webhooks: { supported: true, signatureScheme: 'SHOPIFY_HMAC_SHA256', replayWindowSeconds: null }, availability: 'AVAILABLE' }, { id: 'woocommerce_v1', type: 'WOOCOMMERCE', version: '1.0.0', name: 'WooCommerce', description: 'WooCommerce REST', authStrategy: 'API_KEY', configurationSchema: { properties: {} }, credentialSchema: { properties: {} }, capabilities: ['PRODUCT_CATALOG'], syncResources: ['PRODUCTS'], webhooks: { supported: true, signatureScheme: 'WOOCOMMERCE_HMAC_SHA256', replayWindowSeconds: null }, availability: 'AVAILABLE' }], capabilities: { resources: [], connections: [] } });
    vi.mocked(getConnectors).mockResolvedValue({ items: [], pageSize: 100 });
    vi.mocked(getConnectorPermissions).mockResolvedValue(permissionsFor(false));
    vi.mocked(getConnectorSyncHistory).mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    vi.mocked(updateConnectorPermission).mockResolvedValue(permissionsFor(true));
  });
  it('shows the real platform setup flows without inventing connection activity', async () => {
    render(<MemoryRouter initialEntries={['/workspace/acme/integrations']}><Routes><Route path="/workspace/:slug/integrations" element={<ConnectorsPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText('Shopify')).toBeInTheDocument();
    expect(screen.getAllByText('AVAILABLE')).toHaveLength(2);
    expect(screen.getByText('Authorize Shopify')).toBeInTheDocument();
    expect(screen.getByText('Verify and connect')).toBeInTheDocument();
    expect(screen.getByText('No connector instances')).toBeInTheDocument();
    expect(screen.queryByText(/connected successfully/i)).toBeNull();
  });

  it('uses the committed PATCH snapshot without a redundant GET and recalculates API operation readiness', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connectedShopify], pageSize: 100 });
    vi.mocked(getConnectorPermissions).mockResolvedValue(permissionsFor(false));
    vi.mocked(updateConnectorPermission).mockResolvedValue(permissionsFor(true));
    render(<MemoryRouter initialEntries={['/workspace/acme/integrations']}><Routes><Route path="/workspace/:slug/integrations" element={<ConnectorsPage/>}/></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions & AI access' }));
    fireEvent.click(await screen.findByRole('tab', { name: /API operations/i }));
    fireEvent.click(screen.getByLabelText('Assistant AI'));

    await waitFor(() => expect(updateConnectorPermission).toHaveBeenCalledWith('acme', 'connector-a', { category: 'PRODUCTS', enabled: true, assistantId }));
    expect(await screen.findByText('AI Ready')).toBeInTheDocument();
    expect(getConnectorPermissions).toHaveBeenCalledTimes(2);
  });

  it('restores the selected assistant after a page reload instead of silently showing another assistant permission', async () => {
    const anotherAssistant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const initial = { ...permissionsFor(false), assistantId: null, assistants: [{ id: anotherAssistant, name: 'A different assistant', status: 'ACTIVE' }, { id: assistantId, name: 'Carteio', status: 'ACTIVE' }] };
    sessionStorage.setItem('carteio:shopify-assistant:acme:connector-a', assistantId);
    vi.mocked(getConnectors).mockResolvedValue({ items: [connectedShopify], pageSize: 100 });
    vi.mocked(getConnectorPermissions).mockResolvedValue(initial);
    const mountPanel = () => render(<MemoryRouter initialEntries={['/workspace/acme/integrations']}><Routes><Route path="/workspace/:slug/integrations" element={<ConnectorsPage/>}/></Routes></MemoryRouter>);
    const first = mountPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions & AI access' }));
    await waitFor(() => expect(getConnectorPermissions).toHaveBeenCalledWith('acme', 'connector-a', assistantId));
    expect(screen.getByLabelText('Select assistant for Shopify AI permissions')).toHaveValue(assistantId);
    first.unmount();

    vi.mocked(getConnectorPermissions).mockClear();
    mountPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions & AI access' }));
    await waitFor(() => expect(getConnectorPermissions).toHaveBeenCalledWith('acme', 'connector-a', assistantId));
    expect(screen.getByLabelText('Select assistant for Shopify AI permissions')).toHaveValue(assistantId);
  });

  it('keeps the saved checkbox value after a failed PATCH and reconciles a timed out PATCH from persisted GET data', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connectedShopify], pageSize: 100 });
    vi.mocked(getConnectorPermissions).mockResolvedValue(permissionsFor(false));
    vi.mocked(updateConnectorPermission).mockRejectedValueOnce(new ApiError('Request timed out', 'timeout')).mockRejectedValueOnce(new ApiError('You do not have permission to complete this request.', 'http', 403));
    const mountPanel = () => render(<MemoryRouter initialEntries={['/workspace/acme/integrations']}><Routes><Route path="/workspace/:slug/integrations" element={<ConnectorsPage/>}/></Routes></MemoryRouter>);

    const first = mountPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions & AI access' }));
    fireEvent.click(await screen.findByRole('tab', { name: /API operations/i }));
    fireEvent.click(screen.getByLabelText('Assistant AI'));
    expect(await screen.findByText(/save response timed out/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Assistant AI')).not.toBeChecked();
    first.unmount();

    mountPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions & AI access' }));
    fireEvent.click(await screen.findByRole('tab', { name: /API operations/i }));
    fireEvent.click(screen.getByLabelText('Assistant AI'));
    expect(await screen.findByText('You do not have permission to complete this request.')).toBeInTheDocument();
    expect(screen.getByLabelText('Assistant AI')).not.toBeChecked();
  });
});
