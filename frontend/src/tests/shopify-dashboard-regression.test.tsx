import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Pages from '../dashboard-source/pages';
import { AppErrorBoundary } from '../components/common/AppErrorBoundary';
import { getProducts, type Product } from '../services/api/saas';
import {
  getConnectors,
  getConnectorPermissions,
  getConnectorSyncHistory,
  beginShopifyInstall,
  verifyConnector,
  type ConnectorInstance,
  type ConnectorPermissions,
  type SyncJob,
} from '../services/api/connectors';

vi.mock('../services/api/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/connectors')>();
  return {
    ...actual,
    getConnectors: vi.fn(),
    getConnectorPermissions: vi.fn(),
    getConnectorSyncHistory: vi.fn(),
    beginShopifyInstall: vi.fn(),
    verifyConnector: vi.fn(),
  };
});

vi.mock('../services/api/saas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/saas')>();
  return { ...actual, getProducts: vi.fn() };
});

const connector = (state: string, hasCredentials = true): ConnectorInstance => ({
  id: 'connector-shopify-a',
  connectorId: 'shopify_v1',
  connectorType: 'SHOPIFY',
  connectorVersion: '1.0.0',
  displayName: 'store.myshopify.com',
  configuration: { shopDomain: 'store.myshopify.com' },
  state,
  verifiedCapabilities: state === 'CONNECTED' ? ['PRODUCT_CATALOG'] : [],
  lastVerifiedAt: state === 'CONNECTED' ? '2026-10-20T10:00:00.000Z' : null,
  lastSyncAt: null,
  lastSuccessfulSyncAt: null,
  lastErrorCode: null,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  integrationConnectionId: 'commerce-a',
  hasCredentials,
});

const permissions: ConnectorPermissions = {
  connectorInstanceId: 'connector-shopify-a',
  assistantId: null,
  assistants: [],
  categories: [{
    category: 'PRODUCTS', providerStatus: 'GRANTED', requested: true,
    providerGranted: true, businessEnabled: true, syncEnabled: true,
    assistantEnabled: null, effective: true, reauthorizationRequired: false,
  }],
  storedRecordCounts: {
    products: 3, variants: 5, productsWithPrices: 3,
    productsWithInventory: 2, categorizedProducts: 3, collections: 1,
    orders: 0, contentByCategory: {},
  },
};

function renderShopify() {
  return render(<Pages page="shopify" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);
}

describe('Shopify dashboard connection regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('DRAFT')], pageSize: 100 });
    vi.mocked(getConnectorPermissions).mockResolvedValue(permissions);
    vi.mocked(getConnectorSyncHistory).mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    vi.mocked(verifyConnector).mockResolvedValue(connector('CONNECTED'));
  });

  it('shows authorization-pending verification instead of mislabeling a stored OAuth grant as Draft or disconnected', async () => {
    renderShopify();

    expect(await screen.findByText('Credentials available · verification required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify connection' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Shopify' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verify connection' }));
    await waitFor(() => expect(verifyConnector).toHaveBeenCalledWith('workspace-a', 'connector-shopify-a', false));
  });

  it('renders connected-store management and counts from the API response', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    renderShopify();

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(within(screen.getByText('Stored products').closest('.metric')!).getByText('Persisted connector records')).toBeInTheDocument();
    expect(within(screen.getByText('Stored products').closest('.metric')!).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByText('Stored variants').closest('.metric')!).getByText('5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync products & variants' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect store' })).toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });

  it('does not offer sync when the verified connector lacks an effective granted sync permission', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    vi.mocked(getConnectorPermissions).mockResolvedValue({
      ...permissions,
      categories: permissions.categories.map(category => ({ ...category, providerStatus: 'UNKNOWN', providerGranted: false, effective: false })),
    });
    renderShopify();

    await screen.findByText('Connected');
    expect(screen.queryByRole('button', { name: 'Sync products & variants' })).not.toBeInTheDocument();
  });

  it('shows backend sync failures and error codes from sync history', async () => {
    const failedJob: SyncJob = {
      id: 'sync-failed-1', resourceType: 'PRODUCTS', mode: 'FULL', state: 'FAILED',
      itemCount: 0, attemptCount: 2, lastErrorCode: 'SHOPIFY_THROTTLED',
      scheduledAt: '2026-10-20T10:00:00.000Z', startedAt: '2026-10-20T10:00:00.000Z',
      finishedAt: '2026-10-20T10:01:00.000Z', createdAt: '2026-10-20T10:00:00.000Z',
    };
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    vi.mocked(getConnectorSyncHistory).mockResolvedValue({ items: [failedJob], hasMore: false, nextCursor: null });
    renderShopify();

    expect(await screen.findByText('PRODUCTS · FAILED')).toBeInTheDocument();
    expect(screen.getByText(/SHOPIFY_THROTTLED/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry failed sync' })).toBeInTheDocument();
  });

  it('refreshes the connector state after explicit verification', async () => {
    vi.mocked(getConnectors)
      .mockResolvedValueOnce({ items: [connector('DRAFT')], pageSize: 100 })
      .mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    renderShopify();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify connection' }));
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());
    expect(getConnectors).toHaveBeenCalledWith('workspace-a', expect.any(AbortSignal));
  });

  it('keeps API failures distinct from a disconnected store', async () => {
    vi.mocked(getConnectors).mockRejectedValue(new Error('network unavailable'));
    renderShopify();

    expect(await screen.findByText('Connection status could not be loaded')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })[0]!).toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Shopify' })).not.toBeInTheDocument();
  });

  it('offers verification retry instead of OAuth when final verification persistence failed', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [{ ...connector('ERROR'), lastErrorCode: 'CONNECTOR_DATABASE_TRANSACTION_FAILED' }], pageSize: 100 });
    renderShopify();

    expect(await screen.findByRole('heading', { name: 'Verification was not saved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry verification' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Shopify' })).not.toBeInTheDocument();
  });

  it('shows the connection skeleton while the initial connector request is pending', async () => {
    let resolveConnectors!: (value: { items: ConnectorInstance[]; pageSize: number }) => void;
    vi.mocked(getConnectors).mockReturnValue(new Promise<{ items: ConnectorInstance[]; pageSize: number }>(resolve => { resolveConnectors = resolve; }));
    render(<Pages page="shopify" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);

    expect(screen.getByRole('status', { name: 'Loading Shopify connection' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    resolveConnectors({ items: [connector('CONNECTED')], pageSize: 100 });
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('keeps the store-domain form visible while connector discovery is loading', () => {
    vi.mocked(getConnectors).mockReturnValue(new Promise<{ items: ConnectorInstance[]; pageSize: number }>(() => {}));
    render(<Pages page="integrations" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);

    expect(screen.getByRole('heading', { name: 'Connect a Shopify Store' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Shopify store domain' })).toBeInTheDocument();
    expect(screen.queryByText('No Shopify store connected')).not.toBeInTheDocument();
  });

  it('rejects malformed store domains and starts OAuth only after explicit submission', async () => {
    vi.mocked(beginShopifyInstall).mockRejectedValue(new Error('OAuth endpoint unavailable'));
    render(<Pages page="integrations" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);
    const input = await screen.findByRole('textbox', { name: 'Shopify store domain' });

    fireEvent.change(input, { target: { value: 'https://evil.example/path' } });
    expect(screen.getByRole('button', { name: 'Connect Shopify' })).toBeDisabled();
    expect(beginShopifyInstall).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'New-Store.myshopify.com' } });
    expect(beginShopifyInstall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Shopify' }));
    await waitFor(() => expect(beginShopifyInstall).toHaveBeenCalledWith('workspace-a', 'new-store.myshopify.com', undefined));
  });

  it('offers management for an already connected store instead of starting a duplicate OAuth flow', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    render(<Pages page="integrations" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);
    const input = await screen.findByRole('textbox', { name: 'Shopify store domain' });

    fireEvent.change(input, { target: { value: 'https://STORE.myshopify.com/' } });
    expect(await screen.findByText(/already listed in this workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage this store/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Shopify' })).toBeDisabled();
    expect(beginShopifyInstall).not.toHaveBeenCalled();
  });

  it('retries connector discovery after an API error without presenting that error as an empty store list', async () => {
    vi.mocked(getConnectors).mockRejectedValueOnce(new Error('temporary API failure'))
      .mockResolvedValue({ items: [], pageSize: 100 });
    render(<Pages page="integrations" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);

    expect(await screen.findByText('Could not load Shopify stores')).toBeInTheDocument();
    expect(screen.queryByText('No Shopify store connected')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    expect(await screen.findByText('No Shopify store connected')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Shopify store domain' })).toBeInTheDocument();
  });

  it('lists all Shopify connectors because the backend permits multiple connector instances per workspace', async () => {
    const second = { ...connector('CONNECTED'), id: 'connector-shopify-b', displayName: 'second.myshopify.com', configuration: { shopDomain: 'second.myshopify.com' } };
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED'), second], pageSize: 100 });
    const openShopify = vi.fn();
    render(<Pages page="integrations" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner" openShopify={openShopify}/>);

    expect(await screen.findByRole('heading', { name: 'store.myshopify.com' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'second.myshopify.com' })).toBeInTheDocument();
  });

  it('retains loaded store details while a background refresh is pending', async () => {
    let resolveRefresh!: (value: { items: ConnectorInstance[]; pageSize: number }) => void;
    vi.mocked(getConnectors)
      .mockResolvedValueOnce({ items: [connector('CONNECTED')], pageSize: 100 })
      .mockReturnValueOnce(new Promise<{ items: ConnectorInstance[]; pageSize: number }>(resolve => { resolveRefresh = resolve; }));
    renderShopify();
    expect(await screen.findByText('Connected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByText(/Refreshing connection data/)).toBeInTheDocument();
    expect(within(document.querySelector('.shopify-hero') as HTMLElement).getByRole('heading', { name: 'store.myshopify.com' })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    resolveRefresh({ items: [connector('CONNECTED')], pageSize: 100 });
  });

  it('shows an explicit verification progress state and never treats a failed verify as connected', async () => {
    let rejectVerification!: (reason: Error) => void;
    vi.mocked(verifyConnector).mockReturnValue(new Promise<ConnectorInstance>((_resolve, reject) => { rejectVerification = reject; }));
    renderShopify();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify connection' }));
    expect(screen.getByText(/Verifying Shopify authorization and granted access/)).toBeInTheDocument();
    rejectVerification(new Error('verification failed'));
    expect(await screen.findByText('Shopify action failed.')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('bounds status polling for a CONNECTING connector and offers an explicit retry when polling expires', async () => {
    vi.useFakeTimers();
    const connecting = { ...connector('CONNECTING'), updatedAt: new Date().toISOString() };
    vi.mocked(getConnectors).mockResolvedValue({ items: [connecting], pageSize: 100 });
    try {
      await act(async () => {
        renderShopify();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(/Shopify verification is in progress/)).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(126_000); });
      expect(screen.getAllByText(/Verification did not finish/)[0]).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry verification' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows recovery immediately when the persisted CONNECTING timestamp is already stale', async () => {
    const staleConnector = { ...connector('CONNECTING'), updatedAt: new Date(Date.now() - 3 * 60_000).toISOString() };
    vi.mocked(getConnectors).mockResolvedValue({ items: [staleConnector], pageSize: 100 });
    renderShopify();

    expect((await screen.findAllByText(/Verification did not finish/))[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry verification' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Shopify' })).not.toBeInTheDocument();
    expect(screen.queryByText(/credentials are invalid/i)).not.toBeInTheDocument();
  });

  it('keeps the last product results visible during refresh and after a refresh error', async () => {
    const item: Product = {
      id: 'product-1', externalId: 'shopify-product-1', name: 'Everyday Hoodie', description: null,
      sku: 'HOOD-1', category: null, currency: 'USD', price: '24.00', inventory: 4,
      availabilityStatus: 'IN_STOCK', rawStatus: 'ACTIVE', productUrl: null, imageUrl: null,
      syncedAt: '2026-10-20T10:00:00.000Z',
      connection: { id: 'commerce-a', displayName: 'store.myshopify.com', platform: 'SHOPIFY', state: 'CONNECTED' },
      variants: [],
    };
    vi.mocked(getProducts).mockResolvedValueOnce({ items: [item], page: 1, pageSize: 25, total: 1, availability: 'AVAILABLE' })
      .mockRejectedValueOnce(new Error('temporary network failure'));
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });

    render(<Pages page="products" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);
    expect(await screen.findByText('Everyday Hoodie')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search by product name or SKU...'), { target: { value: 'hoodie' } });
    expect(screen.getByText('Everyday Hoodie')).toBeInTheDocument();
    expect(await screen.findByText(/Could not refresh products\. Showing the last loaded results/)).toBeInTheDocument();
    expect(screen.getByText('Everyday Hoodie')).toBeInTheDocument();
  });

  it('polls only an active Shopify sync job and pauses after a bounded period', async () => {
    vi.useFakeTimers();
    const pendingJob: SyncJob = {
      id: 'sync-pending-1', resourceType: 'PRODUCTS', mode: 'FULL', state: 'PENDING', itemCount: 0,
      attemptCount: 0, lastErrorCode: null, scheduledAt: '2026-10-20T10:00:00.000Z', startedAt: null,
      finishedAt: null, createdAt: '2026-10-20T10:00:00.000Z',
    };
    vi.mocked(getConnectorSyncHistory).mockResolvedValue({ items: [pendingJob], hasMore: false, nextCursor: null });
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    try {
      await act(async () => {
        renderShopify();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('Sync queued…')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      expect(screen.getByRole('button', { name: 'Refresh sync status' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('scopes products by the selected Shopify store and hides the prior store results on switch', async () => {
    const makeProduct = (name: string, connectionId: string): Product => ({
      id: `${connectionId}-product`, externalId: `${connectionId}-external`, name, description: null, sku: null,
      category: null, currency: null, price: null, inventory: null, availabilityStatus: null, rawStatus: 'ACTIVE',
      productUrl: null, imageUrl: null, syncedAt: '2026-10-20T10:00:00.000Z', variants: [],
      connection: { id: connectionId, displayName: connectionId, platform: 'SHOPIFY', state: 'CONNECTED' },
    });
    vi.mocked(getConnectors).mockResolvedValue({ items: [
      { ...connector('CONNECTED'), integrationConnectionId: 'commerce-a' },
      { ...connector('CONNECTED'), id: 'connector-shopify-b', displayName: 'second.myshopify.com', integrationConnectionId: 'commerce-b', configuration: { shopDomain: 'second.myshopify.com' } },
    ], pageSize: 100 });
    vi.mocked(getProducts).mockImplementation(async (_slug, _page, _search, _signal, integrationId) => ({
      items: [integrationId === 'commerce-b' ? makeProduct('Store B product', 'commerce-b') : makeProduct('Store A product', 'commerce-a')],
      page: 1, pageSize: 25, total: 1, availability: 'AVAILABLE',
    }));

    render(<Pages page="products" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);
    expect(await screen.findByText('Store A product')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Shopify store' }), { target: { value: 'connector-shopify-b' } });
    expect(screen.queryByText('Store A product')).not.toBeInTheDocument();
    expect(await screen.findByText('Store B product')).toBeInTheDocument();
    expect(getProducts).toHaveBeenCalledWith('workspace-a', 1, '', expect.any(AbortSignal), 'commerce-b');
  });

  it('scopes the sync monitor product request to its selected Shopify connection', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [{ ...connector('CONNECTED'), integrationConnectionId: 'commerce-a' }], pageSize: 100 });
    vi.mocked(getProducts).mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0, availability: 'NO_DATA' });

    render(<Pages page="sync" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);

    await waitFor(() => expect(getProducts).toHaveBeenCalledWith('workspace-a', 1, '', expect.any(AbortSignal), 'commerce-a'));
  });

  it('does not issue a workspace-wide Products request when a Shopify connector has no linked commerce record', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [{ ...connector('CONNECTED'), integrationConnectionId: null }], pageSize: 100 });

    render(<Pages page="products" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);

    expect(await screen.findByText('Shopify catalog is unavailable')).toBeInTheDocument();
    expect(getProducts).not.toHaveBeenCalled();
  });

  it('provides a retry for an independently failed sync-history request', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    vi.mocked(getConnectorSyncHistory).mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    renderShopify();

    expect(await screen.findByText('Sync history unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync history' }));
    await waitFor(() => expect(getConnectorSyncHistory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No sync jobs available')).toBeInTheDocument();
  });
});

describe('Integrations route and application error recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConnectors).mockResolvedValue({ items: [], pageSize: 100 });
    vi.mocked(getConnectorPermissions).mockResolvedValue(permissions);
    vi.mocked(getConnectorSyncHistory).mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  });

  const renderIntegrations = () => render(<Pages page="integrations" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);

  it('renders the Integrations page and loading skeleton on first load', () => {
    vi.mocked(getConnectors).mockReturnValue(new Promise(() => {}));
    renderIntegrations();
    expect(screen.getByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading Shopify connection' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a genuine empty state for an empty connector list', async () => {
    renderIntegrations();
    expect(await screen.findByRole('heading', { name: 'No Shopify store connected' })).toBeInTheDocument();
  });

  it('renders DRAFT connectors with verification required', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('DRAFT')], pageSize: 100 });
    renderIntegrations();
    expect(await screen.findByRole('button', { name: 'Verify authorization' })).toBeInTheDocument();
    expect(screen.getByText('Credentials available · verification required')).toBeInTheDocument();
  });

  it('renders connected-store management controls', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    renderIntegrations();
    expect(await screen.findByRole('button', { name: 'Manage Shopify' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'store.myshopify.com' })).toBeInTheDocument();
  });

  it('keeps API errors separate from an empty connector list', async () => {
    vi.mocked(getConnectors).mockRejectedValue(new Error('temporary error'));
    renderIntegrations();
    expect(await screen.findByRole('heading', { name: 'Could not load Shopify stores' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No Shopify store connected' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })[0]!).toBeInTheDocument();
  });

  it('renders every Shopify connector returned by the workspace API', async () => {
    const second = { ...connector('CONNECTED'), id: 'connector-shopify-b', displayName: 'second.myshopify.com' };
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED'), second], pageSize: 100 });
    renderIntegrations();
    expect(await screen.findByRole('heading', { name: 'store.myshopify.com' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'second.myshopify.com' })).toBeInTheDocument();
  });

  it('does not crash if a legacy connector has non-object JSON configuration', async () => {
    const legacyConnector = connector('CONNECTED');
    Reflect.set(legacyConnector, 'configuration', null);
    vi.mocked(getConnectors).mockResolvedValue({ items: [legacyConnector], pageSize: 100 });
    renderIntegrations();
    expect(await screen.findByRole('heading', { name: 'store.myshopify.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Shopify' })).toBeInTheDocument();
  });

  it('mounts the Shopify permissions panel when connector permissions load', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [connector('CONNECTED')], pageSize: 100 });
    renderShopify();
    expect(await screen.findByRole('heading', { name: 'store.myshopify.com' })).toBeInTheDocument();
    expect(await screen.findByText('SHOPIFY · AI DATA PERMISSIONS')).toBeInTheDocument();
  });

  it('renders the Shopify detail route without an undefined openShopify reference', async () => {
    vi.mocked(getConnectors).mockResolvedValue({ items: [], pageSize: 100 });
    render(<Pages page="shopify" go={vi.fn()} notify={vi.fn()} workspaceSlug="workspace-a" workspaceRole="owner"/>);
    expect(await screen.findByRole('heading', { name: 'Not connected' })).toBeInTheDocument();
  });

  it('shows current-theme recovery UI in the global error boundary', async () => {
    function ThrowDuringRender(): never { throw new Error('expected render failure'); }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppErrorBoundary><ThrowDuringRender/></AppErrorBoundary>);
    expect(await screen.findByRole('alert')).toHaveClass('carteio-full-error');
    expect(screen.getByRole('heading', { name: 'We couldn’t load this page.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
