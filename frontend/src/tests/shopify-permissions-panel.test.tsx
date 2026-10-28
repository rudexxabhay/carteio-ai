import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShopifyPermissionsPanel } from '../pages/saas/ShopifyPermissionsPanel';
import type { ConnectorPermissions, ShopifyScopeOperation } from '../services/api/connectors';

const manyScopes = Array.from({ length: 53 }, (_, index) => ({ handle: `read_future_${index}`, description: `Provider description ${index}`, granted: true, accessType: 'READ' as const, sensitivity: 'BUSINESS' as const, supported: false, operations: [] }));
const operation = (overrides: Partial<ShopifyScopeOperation> = {}): ShopifyScopeOperation => ({
  accessType: 'READ', category: 'PRODUCTS', operation: 'Product search and details', requiredScopes: ['read_products'], sensitivity: 'BUSINESS', executable: true, supported: true, providerGranted: true, providerCapabilityVerified: true, dataRecordCount: 1, dataStatus: 'QUERY_READY', workspaceAllowed: true, workspaceSyncEnabled: false, assistantPermissionGranted: true, assistantAllowed: true, eligible: true, blockedReason: null, ...overrides,
});
const productOperation = operation();
const missingGrantOperation = operation({ category: 'SHOPIFY_MARKETS', operation: 'Markets and currencies', requiredScopes: ['read_markets'], providerGranted: false, providerCapabilityVerified: false, dataRecordCount: null, dataStatus: 'UNAVAILABLE', workspaceAllowed: false, assistantPermissionGranted: false, assistantAllowed: false, eligible: false, blockedReason: 'A required Shopify scope has not been granted.' });
const unsupportedOperation = operation({ category: 'SHOPIFY_METAOBJECTS', operation: 'Metaobjects', requiredScopes: ['read_metaobjects'], executable: false, supported: false, providerGranted: true, providerCapabilityVerified: false, eligible: false, blockedReason: 'This operation is not an enabled read-only Carteio implementation.' });
const noDataOperation = operation({ category: 'SHOPIFY_DISCOUNTS', operation: 'Discounts', requiredScopes: ['read_discounts'], providerGranted: true, providerCapabilityVerified: true, dataRecordCount: 0, dataStatus: 'NOT_SYNCED', eligible: false, blockedReason: 'No synchronized data is currently query-ready for this operation.' });

const permissions: ConnectorPermissions = {
  connectorInstanceId: 'connector-a', assistantId: 'assistant-a',
  assistants: [{ id: 'assistant-a', name: 'Support assistant', status: 'ACTIVE' }], categories: [],
  shopifyScopeSnapshot: {
    shopDomain: 'store.myshopify.com', connectionState: 'CONNECTED', declaredScopesStatus: 'UNAVAILABLE', configurationSourceStatus: 'CARTEIO_OAUTH_INPUTS_NOT_SHOPIFY_DECLARATION',
    configuredOAuthScopes: ['read_products', 'read_inventory', 'read_orders'], scopeInventoryCount: 4, requestedScopesStatus: 'AVAILABLE', requestedScopes: ['read_products', 'read_inventory', 'read_orders'], requestedAt: '2026-10-16T10:00:00.000Z',
    grantedScopeCount: manyScopes.length + 2, supportedOperationCount: 99, assistantEnabledCount: 1, verifiedAt: '2026-10-16T10:00:00.000Z', capabilityVerifiedAt: '2026-10-16T10:00:00.000Z', lastSuccessfulSyncAt: null, freshness: 'FRESH',
    operations: [productOperation, missingGrantOperation, noDataOperation, unsupportedOperation],
    scopes: [...manyScopes,
      { handle: 'write_products', description: 'Modify products', granted: true, accessType: 'WRITE' as const, sensitivity: 'BUSINESS' as const, supported: false, operations: [] },
      { handle: 'read_products', description: 'View products', granted: true, accessType: 'READ' as const, sensitivity: 'BUSINESS' as const, supported: true, operations: [productOperation] },
    ],
    scopeInventory: [
      { handle: 'read_products', apiFamily: 'ADMIN_API', access: 'READ', risk: 'STANDARD', verification: 'DOCUMENTED_IN_2026_10', resourceDescription: 'Products and collections', executable: false, configuredForOAuth: true, grantedToStore: true, implementedInCarteio: true },
      { handle: 'customer_read_orders', apiFamily: 'CUSTOMER_ACCOUNT_API', access: 'READ', risk: 'PROTECTED', verification: 'UNVERIFIED_FOR_CONFIGURED_API_VERSION', resourceDescription: null, executable: false, configuredForOAuth: false, grantedToStore: false, implementedInCarteio: false },
      { handle: 'unauthenticated_read_product_listings', apiFamily: 'STOREFRONT_API', access: 'READ', risk: 'UNKNOWN', verification: 'UNVERIFIED_FOR_CONFIGURED_API_VERSION', resourceDescription: null, executable: false, configuredForOAuth: false, grantedToStore: false, implementedInCarteio: false },
      { handle: 'shop_app:oauth', apiFamily: 'SPECIAL_OR_UNSUPPORTED', access: 'OTHER', risk: 'UNKNOWN', verification: 'UNVERIFIED_FOR_CONFIGURED_API_VERSION', resourceDescription: null, executable: false, configuredForOAuth: false, grantedToStore: false, implementedInCarteio: false },
    ],
  },
};
const baseSnapshot = permissions.shopifyScopeSnapshot;
if (!baseSnapshot) throw new Error('Shopify test fixture requires a scope snapshot.');

function renderPanel(input: Partial<ConnectorPermissions> = {}, onPermission = vi.fn(), refreshAvailable = true, onRefresh = vi.fn()) {
  const merged = { ...permissions, ...input };
  render(<ShopifyPermissionsPanel name="Store" permissions={merged} assistantId="assistant-a" refreshing={false} busy={false} refreshAvailable={refreshAvailable} onAssistantChange={vi.fn()} onRefresh={onRefresh} onPermission={onPermission}/>);
  return onPermission;
}

describe('ShopifyPermissionsPanel', () => {
  it('does not request a grant refresh unless the connector is connected', () => {
    const onRefresh = vi.fn();
    renderPanel({}, vi.fn(), false, onRefresh);
    expect(screen.getByText(/Verify the connected Shopify installation before refreshing grants/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh verified grants' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh verified grants' }));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('distinguishes static inventory count, verified grant count, and unavailable app declaration', () => {
    renderPanel();
    expect(screen.getByText('Unavailable from an authoritative runtime source')).toBeInTheDocument();
    const inventoryCard = within(screen.getByLabelText('Shopify permission summary')).getByText('Scope inventory').closest('article');
    const grantsCard = within(screen.getByLabelText('Shopify permission summary')).getByText('Granted scopes').closest('article');
    expect(inventoryCard && within(inventoryCard).getByText('4')).toBeInTheDocument();
    expect(grantsCard && within(grantsCard).getByText('55')).toBeInTheDocument();
    const operationsCard = within(screen.getByLabelText('Shopify permission summary')).getByText('Implemented operations').closest('article');
    const aiReadyCard = within(screen.getByLabelText('Shopify permission summary')).getByText('AI ready').closest('article');
    expect(operationsCard && within(operationsCard).getByText('3')).toBeInTheDocument();
    expect(aiReadyCard && within(aiReadyCard).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Static owner-supplied handles')).toBeInTheDocument();
    expect(screen.getAllByText('Verified now').length).toBeGreaterThan(0);
    expect(screen.queryByText('read_future_0')).not.toBeInTheDocument();
  });

  it('paginates all Shopify grants and displays unknown grants without treating inventory as grants', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Granted Scopes/ }));
    expect(screen.getByText('read_future_0')).toBeInTheDocument();
    expect(screen.queryByText('read_future_52')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('read_future_52')).toBeInTheDocument();
    expect(screen.getByText('write_products')).toBeInTheDocument();
  });

  it('keeps full static inventory separate and paginated', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Full Scope Inventory/ }));
    expect(screen.getByText('customer_read_orders')).toBeInTheDocument();
    expect(screen.getByText(/Owner-supplied reference data only/)).toBeInTheDocument();
    expect(screen.queryByText('read_future_0')).not.toBeInTheDocument();
  });

  it('shows effective AI readiness and gives contextual missing grant and data reasons', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /API Operations/ }));
    expect(screen.getByText('AI Ready')).toBeInTheDocument();
    const markets = screen.getByText('Markets and currencies').closest('article');
    expect(markets).not.toBeNull();
    if (markets) {
      expect(within(markets).getByText('Shopify Permission Missing')).toBeInTheDocument();
      fireEvent.click(within(markets).getByText('Details'));
      expect(within(markets).getByText(/required Shopify scope has not been granted/i)).toBeInTheDocument();
    }
    expect(screen.getByText('Data Not Available')).toBeInTheDocument();
    const unsupported = screen.getByText('Metaobjects').closest('article');
    expect(unsupported && within(unsupported).getByText('Unsupported')).toBeInTheDocument();
    expect(unsupported && within(unsupported).getByText('Controls unavailable for unsupported operation')).toBeInTheDocument();
  });

  it('persists assistant toggle intent through the existing permission callback', () => {
    const onPermission = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /API Operations/ }));
    const productRow = screen.getByText('Product search and details').closest('article');
    expect(productRow).not.toBeNull();
    if (productRow) fireEvent.click(within(productRow).getByLabelText('Assistant AI'));
    expect(onPermission).toHaveBeenCalledWith('PRODUCTS', false, 'assistant-a');
  });

  it('does not present assistant access as effective while workspace AI is off', () => {
    const workspaceOff = operation({ workspaceAllowed: false, assistantPermissionGranted: true, eligible: false });
    renderPanel({ shopifyScopeSnapshot: { ...baseSnapshot, operations: [workspaceOff] } });
    fireEvent.click(screen.getByRole('tab', { name: /API Operations/ }));
    expect(screen.getByLabelText('Assistant AI')).toBeChecked();
    expect(screen.getByLabelText('Assistant AI')).toBeDisabled();
    expect(screen.getByText('Assistant access is not effective while Workspace AI is off.')).toBeInTheDocument();
  });

  it('labels stale grants as cached and requires verification for operation readiness', () => {
    renderPanel({ shopifyScopeSnapshot: { ...baseSnapshot, freshness: 'STALE' } });
    expect(screen.getAllByText('Cached · stale').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /API Operations/ }));
    expect(within(screen.getByText('Product search and details').closest('article')!).getByText('Verification Required')).toBeInTheDocument();
  });
});
