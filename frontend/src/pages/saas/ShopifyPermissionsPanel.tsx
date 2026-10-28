import { useMemo, useState } from 'react';
import { ChevronDown, CircleHelp, LoaderCircle, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { ConnectorPermissions, ShopifyGrantedScope, ShopifyScopeOperation, ShopifyScopeSnapshot } from '../../services/api/connectors';

type Props = {
  name: string;
  permissions: ConnectorPermissions;
  assistantId: string;
  refreshing: boolean;
  busy: boolean;
  refreshAvailable?: boolean;
  onAssistantChange: (id: string) => void;
  onRefresh: () => void;
  onPermission: (category: string, enabled: boolean, assistantId?: string, scope?: 'AI' | 'SYNC') => void;
};

type Tab = 'overview' | 'operations' | 'granted' | 'inventory';
const PAGE_SIZE = 25;
const scopeClassification = (scope: ShopifyGrantedScope) => scope.dataClassification ?? (scope.sensitivity === 'BUSINESS' ? 'STANDARD' : scope.sensitivity === 'RESTRICTED' ? 'PROTECTED' : 'UNKNOWN');
const scopeFamily = (handle: string) => handle.startsWith('customer_') ? 'CUSTOMER_ACCOUNT_API' : handle.startsWith('unauthenticated_') ? 'STOREFRONT_API' : handle.includes(':') ? 'SPECIAL_OR_UNSUPPORTED' : 'ADMIN_API';

type RuntimeStatus = 'AI Ready' | 'Permission Disabled' | 'Shopify Permission Missing' | 'Verification Required' | 'Data Not Available' | 'Restricted' | 'Unsupported';
function operationStatus(operation: ShopifyScopeOperation, snapshot: ShopifyScopeSnapshot): RuntimeStatus {
  if (operation.executable !== true || !operation.supported) return 'Unsupported';
  if (operation.sensitivity === 'RESTRICTED' || operation.dataClassification === 'PROTECTED') return 'Restricted';
  if (snapshot.freshness !== 'FRESH') return 'Verification Required';
  if (!operation.providerGranted) return 'Shopify Permission Missing';
  if (!operation.providerCapabilityVerified) return 'Verification Required';
  if (!operation.workspaceAllowed || !operation.assistantPermissionGranted) return 'Permission Disabled';
  if (operation.dataStatus !== 'QUERY_READY' || operation.dataRecordCount === null || operation.dataRecordCount < 1) return 'Data Not Available';
  return operation.eligible ? 'AI Ready' : 'Permission Disabled';
}

export function ShopifyPermissionsPanel({ name, permissions, assistantId, refreshing, busy, refreshAvailable = true, onAssistantChange, onRefresh, onPermission }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [supportFilter, setSupportFilter] = useState('ALL');
  const [aiFilter, setAiFilter] = useState('ALL');
  const [accessFilter, setAccessFilter] = useState('ALL');
  const [sensitivityFilter, setSensitivityFilter] = useState('ALL');
  const [familyFilter, setFamilyFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const snapshot = permissions.shopifyScopeSnapshot;
  const scopes = snapshot?.scopes ?? [];
  const inventory = snapshot?.scopeInventory ?? [];
  const operations = snapshot?.operations ?? [];
  const fresh = snapshot?.freshness === 'FRESH';
  const implementedOperations = operations.filter((operation) => operation.executable === true && operation.supported && operation.accessType === 'READ');
  const aiReadyCount = implementedOperations.filter((operation) => operation.eligible).length;
  const implementedScopeHandles = new Set(implementedOperations.flatMap((operation) => operation.requiredScopes));
  const aiReadyScopeHandles = new Set(implementedOperations.filter((operation) => operation.eligible).flatMap((operation) => operation.requiredScopes));
  const scopeFreshnessLabel = snapshot?.freshness === 'FRESH' ? 'Verified now' : snapshot?.freshness === 'STALE' ? 'Cached · stale' : 'Not verified';

  const inventoryCounts = useMemo(() => ({
    admin: inventory.filter((scope) => scope.apiFamily === 'ADMIN_API').length,
    customer: inventory.filter((scope) => scope.apiFamily === 'CUSTOMER_ACCOUNT_API').length,
    storefront: inventory.filter((scope) => scope.apiFamily === 'STOREFRONT_API').length,
    special: inventory.filter((scope) => scope.apiFamily === 'SPECIAL_OR_UNSUPPORTED').length,
    read: inventory.filter((scope) => scope.access === 'READ').length,
    write: inventory.filter((scope) => scope.access === 'WRITE').length,
    sensitive: inventory.filter((scope) => scope.risk === 'SENSITIVE' || scope.risk === 'PROTECTED').length,
  }), [inventory]);

  const filteredScopes = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return scopes.filter((scope) => {
      const textMatch = !needle || scope.handle.toLocaleLowerCase().includes(needle) || (scope.description ?? '').toLocaleLowerCase().includes(needle) || scope.operations.some((operation) => operation.operation.toLocaleLowerCase().includes(needle));
      const supported = scope.operations.some((operation) => operation.executable === true && operation.supported);
      const supportMatch = supportFilter === 'ALL' || (supportFilter === 'SUPPORTED' ? supported : !supported);
      const enabled = scope.operations.some((operation) => operation.eligible);
      const aiMatch = aiFilter === 'ALL' || (aiFilter === 'ENABLED' ? enabled : !enabled);
      const accessMatch = accessFilter === 'ALL' || scope.accessType === accessFilter;
      const sensitivityMatch = sensitivityFilter === 'ALL' || scopeClassification(scope) === sensitivityFilter;
      const familyMatch = familyFilter === 'ALL' || scopeFamily(scope.handle) === familyFilter;
      return textMatch && supportMatch && aiMatch && accessMatch && sensitivityMatch && familyMatch;
    });
  }, [scopes, search, supportFilter, aiFilter, accessFilter, sensitivityFilter, familyFilter]);

  const filteredInventory = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return inventory.filter((scope) => {
      const textMatch = !needle || scope.handle.toLocaleLowerCase().includes(needle);
      const supported = implementedScopeHandles.has(scope.handle);
      const supportMatch = supportFilter === 'ALL' || (supportFilter === 'SUPPORTED' ? supported : !supported);
      const aiReady = aiReadyScopeHandles.has(scope.handle);
      const aiMatch = aiFilter === 'ALL' || (aiFilter === 'ENABLED' ? aiReady : !aiReady);
      const accessMatch = accessFilter === 'ALL' || scope.access === accessFilter;
      const sensitivityMatch = sensitivityFilter === 'ALL' || scope.risk === sensitivityFilter;
      const familyMatch = familyFilter === 'ALL' || scope.apiFamily === familyFilter;
      return textMatch && supportMatch && aiMatch && accessMatch && sensitivityMatch && familyMatch;
    });
  }, [inventory, implementedScopeHandles, aiReadyScopeHandles, search, supportFilter, aiFilter, accessFilter, sensitivityFilter, familyFilter]);

  const selectedRows = activeTab === 'granted' ? filteredScopes : activeTab === 'inventory' ? filteredInventory : [];
  const pageCount = Math.ceil(selectedRows.length / PAGE_SIZE);
  const pageStart = page * PAGE_SIZE;
  const resetSearch = (value: string) => { setSearch(value); setPage(0); };
  const changeTab = (tab: Tab) => { setActiveTab(tab); setPage(0); };

  return <section className="connector-permission-panel shopify-permission-panel" aria-labelledby={`shopify-permissions-${permissions.connectorInstanceId}`}>
    <div className="connector-section-title shopify-permission-heading">
      <div><p className="connector-eyebrow">SHOPIFY · AI DATA PERMISSIONS</p><h2 id={`shopify-permissions-${permissions.connectorInstanceId}`}>{name}</h2><p>Review verified Shopify access, Carteio operations, and merchant-controlled AI permissions.</p></div>
      <button type="button" className="connector-button secondary" onClick={onRefresh} disabled={refreshing || busy} aria-busy={refreshing}><RefreshCw size={15}/>{refreshing ? 'Refreshing…' : 'Refresh Permissions'}</button>
    </div>

    <div className="shopify-permission-summary" aria-label="Shopify permission summary">
      <SummaryCard label="Scope inventory" value={inventory.length.toLocaleString()} detail="Static owner-supplied handles"/>
      <SummaryCard label={fresh ? 'Granted scopes' : 'Cached grant snapshot'} value={snapshot ? scopes.length.toLocaleString() : '—'} detail={scopeFreshnessLabel}/>
      <SummaryCard label="Implemented operations" value={implementedOperations.length.toLocaleString()} detail="Executable read operations"/>
      <SummaryCard label="AI ready" value={aiReadyCount.toLocaleString()} detail="All runtime checks satisfied"/>
    </div>

    <div className="shopify-runtime-meta">
      <div><span>Shop</span><strong>{snapshot?.shopDomain ?? 'Unavailable'}</strong></div>
      <div><span>Connection</span><strong>{snapshot?.connectionState?.replaceAll('_', ' ') ?? 'Unavailable'}</strong></div>
      <div><span>Last successful provider verification</span><strong>{snapshot?.capabilityVerifiedAt ? new Date(snapshot.capabilityVerifiedAt).toLocaleString() : 'Never verified'}</strong></div>
      <div><span>Last successful connector sync</span><strong>{snapshot?.lastSuccessfulSyncAt ? new Date(snapshot.lastSuccessfulSyncAt).toLocaleString() : 'No successful sync recorded'}</strong></div>
      <div><span>Grant snapshot freshness</span><strong className={`scope-freshness ${snapshot?.freshness?.toLowerCase() ?? 'unavailable'}`}>{scopeFreshnessLabel}</strong></div>
    </div>

    <details className="shopify-authorization-details">
      <summary>OAuth and app configuration status <ChevronDown size={15}/></summary>
      <div className="shopify-authorization-grid">
        <div><strong>Shopify app declaration</strong><span>Unavailable from an authoritative runtime source</span></div>
        <div><strong>Carteio OAuth request configuration</strong><span>{snapshot?.configuredOAuthScopes?.length ?? 0} configured request scopes · not Shopify declaration or grant</span></div>
        <div><strong>Last recorded OAuth request</strong><span>{snapshot?.requestedScopesStatus === 'AVAILABLE' ? `${snapshot.requestedScopes?.length ?? 0} scopes · ${snapshot.requestedAt ? new Date(snapshot.requestedAt).toLocaleString() : 'timestamp unavailable'}` : 'Unavailable'}</span></div>
      </div>
      {Boolean(snapshot?.configuredOAuthScopes?.length) && <details className="shopify-auth-scope-list"><summary>View Carteio configured request scopes</summary><div>{snapshot?.configuredOAuthScopes?.map((handle) => <code key={handle}>{handle}</code>)}</div></details>}
      {snapshot?.requestedScopesStatus === 'AVAILABLE' && <details className="shopify-auth-scope-list"><summary>View last requested scopes</summary><div>{(snapshot.requestedScopes ?? []).map((handle) => <code key={handle}>{handle}</code>)}</div></details>}
      <p className="connector-muted">Requested/configured scopes do not establish merchant approval. Only Shopify’s verified grant snapshot represents actual access.</p>
    </details>

    {snapshot?.freshness !== 'FRESH' && <div className={`shopify-verification-alert ${snapshot?.freshness === 'STALE' ? 'is-stale' : ''}`} role="status"><ShieldCheck size={17}/><span>{snapshot?.freshness === 'STALE' ? 'The saved grant snapshot is stale. Shopify-backed AI access requires a fresh verification.' : 'Shopify grants have not been verified. Static inventory and OAuth configuration do not prove store access.'}</span></div>}

    {permissions.assistants?.length ? <label className="connector-permission-assistant">Assistant<select value={assistantId} disabled={busy} onChange={(event) => onAssistantChange(event.target.value)} aria-label="Select assistant for Shopify AI permissions">{permissions.assistants.map((assistant) => <option value={assistant.id} key={assistant.id}>{assistant.name}</option>)}</select></label> : !assistantId ? <p className="connector-muted">Create an active assistant to manage assistant-specific access. Shopify grants remain visible.</p> : null}

    <div className="shopify-tabs" role="tablist" aria-label="Shopify permissions views">
      {([['overview', 'Overview'], ['operations', 'API Operations'], ['granted', 'Granted Scopes'], ['inventory', 'Full Scope Inventory']] as const).map(([tab, label]) => <button type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'is-active' : ''} key={tab} onClick={() => changeTab(tab)}>{label}{tab === 'granted' ? <span>{scopes.length}</span> : tab === 'inventory' ? <span>{inventory.length}</span> : tab === 'operations' ? <span>{operations.length}</span> : null}</button>)}
    </div>

    {activeTab === 'overview' && <div className="shopify-overview-grid">
      <section className="shopify-overview-card"><div><h3>Runtime access path</h3><p>AI retrieval requires a connected store, fresh actual grant, verified implementation, provider capability, workspace AI permission, assistant permission, and available data.</p></div><div className="shopify-overview-key"><span><i className="is-live"/>Verified from Shopify</span><span><i className="is-config"/>Configured in Carteio</span><span><i className="is-merchant"/>Merchant permission</span></div></section>
      <section className="shopify-overview-card"><div><h3>Actual store grants</h3><p>{fresh ? `${scopes.length} scopes in the current verified snapshot.` : snapshot?.freshness === 'STALE' ? `${scopes.length} scopes in a stale cached snapshot; not current authorization evidence.` : 'No verified scope snapshot is available.'}{!refreshAvailable && ' Verify the connected Shopify installation before refreshing grants.'}</p></div><button type="button" className="connector-button secondary" onClick={onRefresh} disabled={!refreshAvailable || refreshing || busy}>{refreshing ? 'Refreshing…' : 'Refresh verified grants'}</button></section>
      <section className="shopify-overview-card"><div><h3>Carteio operations</h3><p>{implementedOperations.length} executable read operations are registered. Scope grants alone do not create API support.</p></div><button type="button" className="shopify-text-action" onClick={() => changeTab('operations')}>Review operations</button></section>
      <section className="shopify-overview-card"><div><h3>Scope inventory</h3><p>{inventoryCounts.admin} Admin API · {inventoryCounts.customer} Customer Account · {inventoryCounts.storefront} Storefront · {inventoryCounts.special} special. Static inventory is not a grant list.</p></div><button type="button" className="shopify-text-action" onClick={() => changeTab('inventory')}>Browse {inventory.length} inventory handles</button></section>
    </div>}

    {activeTab === 'operations' && <section className="shopify-tab-content" aria-label="Shopify API operations">
      <div className="shopify-list-heading"><div><h3>API operations</h3><p>Operation readiness is based on live grant and persisted provider, data, and permission state.</p></div><span>{implementedOperations.length} executable · {operations.length - implementedOperations.length} unsupported</span></div>
      {operations.length ? <div className="shopify-operation-list">{operations.map((operation) => <OperationRow key={operation.category} operation={operation} snapshot={snapshot} assistantId={assistantId} busy={busy} onPermission={onPermission}/>)}</div> : <EmptyState message="No Shopify API operations are registered."/>}
    </section>}

    {(activeTab === 'granted' || activeTab === 'inventory') && <section className="shopify-tab-content" aria-label={activeTab === 'granted' ? 'Verified Shopify grants' : 'Static Shopify scope inventory'}>
      <div className="shopify-list-heading"><div><h3>{activeTab === 'granted' ? 'Granted by Shopify to this store' : 'Full static scope inventory'}</h3><p>{activeTab === 'granted' ? fresh ? 'These handles came from the current saved Shopify-verified grant snapshot.' : snapshot?.freshness === 'STALE' ? 'These handles are from a stale cached snapshot and are not current authorization evidence.' : 'A current verified Shopify grant snapshot is unavailable.' : 'Owner-supplied reference data only. It does not establish declaration, request, approval, or grant.'}</p></div><span>{activeTab === 'granted' ? `${scopes.length} saved grants` : `${inventory.length} reference handles`}</span></div>
      <div className="shopify-scope-filters">
        <label className="shopify-scope-search"><Search size={15}/><input type="search" value={search} onChange={(event) => resetSearch(event.target.value)} placeholder="Search scopes or descriptions" aria-label="Search Shopify scopes"/></label>
        <label>Support<select value={supportFilter} onChange={(event) => { setSupportFilter(event.target.value); setPage(0); }}><option value="ALL">All</option><option value="SUPPORTED">Implemented</option><option value="UNSUPPORTED">Unsupported</option></select></label>
        <label>AI access<select value={aiFilter} onChange={(event) => { setAiFilter(event.target.value); setPage(0); }}><option value="ALL">All states</option><option value="ENABLED">AI ready / granted</option><option value="DISABLED">Not AI ready / not implemented</option></select></label>
        <label>Access<select value={accessFilter} onChange={(event) => { setAccessFilter(event.target.value); setPage(0); }}><option value="ALL">Read, write, other</option><option value="READ">Read</option><option value="WRITE">Write</option><option value="OTHER">Other</option></select></label>
        <label>Sensitivity<select value={sensitivityFilter} onChange={(event) => { setSensitivityFilter(event.target.value); setPage(0); }}><option value="ALL">All classifications</option><option value="STANDARD">Standard</option><option value="SENSITIVE">Sensitive</option><option value="PROTECTED">Protected</option><option value="UNKNOWN">Unknown</option></select></label>
        <label>API family<select value={familyFilter} onChange={(event) => { setFamilyFilter(event.target.value); setPage(0); }}><option value="ALL">All API families</option><option value="ADMIN_API">Admin API</option><option value="CUSTOMER_ACCOUNT_API">Customer Account API</option><option value="STOREFRONT_API">Storefront API</option><option value="SPECIAL_OR_UNSUPPORTED">Special / unsupported</option></select></label>
      </div>
      {refreshing && activeTab === 'granted' && <div className="shopify-scope-loading" role="status"><LoaderCircle className="connector-spin" size={16}/>Refreshing verified scopes from Shopify…</div>}
      {selectedRows.length === 0 ? <EmptyState message={activeTab === 'granted' && !scopes.length ? 'No verified Shopify scopes are available.' : 'No scopes match the current search and filters.'}/> : activeTab === 'granted' ? <div className="shopify-scope-list" aria-live="polite">{filteredScopes.slice(pageStart, pageStart + PAGE_SIZE).map((scope) => <GrantedScopeRow key={scope.handle} scope={scope} freshness={snapshot?.freshness ?? 'UNAVAILABLE'}/>)}</div> : <div className="shopify-scope-list" aria-live="polite">{filteredInventory.slice(pageStart, pageStart + PAGE_SIZE).map((scope) => <InventoryScopeRow key={scope.handle} scope={scope} freshness={snapshot?.freshness ?? 'UNAVAILABLE'}/>)}</div>}
      {pageCount > 1 && <nav className="shopify-pagination" aria-label="Scope list pages"><span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, selectedRows.length)} of {selectedRows.length}</span><div><button type="button" className="connector-button secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><span>Page {page + 1} of {pageCount}</span><button type="button" className="connector-button secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button></div></nav>}
    </section>}

    <div className="connector-security-note"><ShieldCheck size={17}/><span>Only registered, verified read operations can be enabled. Shopify write grants do not enable AI writes. Sensitive order/customer data remains restricted without verified ownership.</span></div>
  </section>;
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="shopify-summary-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="shopify-empty-state"><CircleHelp size={18}/><span>{message}</span></div>;
}

function GrantedScopeRow({ scope, freshness }: { scope: ShopifyGrantedScope; freshness: ShopifyScopeSnapshot['freshness'] }) {
  const supported = scope.operations.some((operation) => operation.executable === true && operation.supported);
  const grantLabel = freshness === 'FRESH' ? 'Verified grant' : freshness === 'STALE' ? 'Cached · stale' : 'Unverified snapshot';
  return <article className="shopify-compact-row"><div className="shopify-row-primary"><code>{scope.handle}</code><span>{scope.description ?? 'Shopify provided no description.'}</span></div><div className="shopify-row-state"><span className={freshness === 'FRESH' ? 'is-verified' : 'is-stale'}>{grantLabel}</span><span>{scope.accessType}</span><span>{scopeClassification(scope)}</span><span>{supported ? 'Carteio operation' : 'No Carteio operation'}</span></div></article>;
}

function InventoryScopeRow({ scope, freshness }: { scope: NonNullable<ShopifyScopeSnapshot['scopeInventory']>[number]; freshness: ShopifyScopeSnapshot['freshness'] }) {
  const grantMatch = freshness === 'FRESH' ? 'Matches verified grants' : freshness === 'STALE' ? 'Matches stale cached grants' : 'Grant status unavailable';
  return <article className="shopify-compact-row"><div className="shopify-row-primary"><code>{scope.handle}</code><span>{scope.resourceDescription ?? 'No verified resource description.'}</span></div><div className="shopify-row-state"><span>{scope.apiFamily.replaceAll('_', ' ')}</span><span>{scope.access}</span><span>{scope.risk}</span><span>{scope.verification.replaceAll('_', ' ')}</span>{scope.configuredForOAuth && <span>In Carteio OAuth config</span>}{scope.grantedToStore && <span>{grantMatch}</span>}</div></article>;
}

function OperationRow({ operation, snapshot, assistantId, busy, onPermission }: { operation: ShopifyScopeOperation; snapshot: ShopifyScopeSnapshot | undefined; assistantId: string; busy: boolean; onPermission: Props['onPermission'] }) {
  const status = snapshot ? operationStatus(operation, snapshot) : 'Verification Required';
  const reason = operation.blockedReason ?? (status === 'Verification Required' ? 'Refresh Shopify permissions and reverify provider capabilities.' : status === 'Shopify Permission Missing' ? 'The required scope is absent from Shopify’s verified grant snapshot.' : status === 'Data Not Available' ? 'No synchronized records are currently query-ready.' : status === 'Permission Disabled' ? 'Enable both workspace and selected assistant AI permission.' : status === 'Unsupported' ? 'Carteio has no executable implementation for this scope.' : null);
  const canControl = operation.executable === true && operation.supported;
  const providerDetail = operation.providerCapabilityVerified ? 'Successful provider probe is recorded.' : operation.providerGranted ? 'Scope exists, but successful API capability verification is not recorded.' : 'Required Shopify grant is missing.';
  return <article className="shopify-operation-row">
    <div className="shopify-operation-summary"><div className="shopify-operation-title"><strong>{operation.operation}</strong><span>{operation.dataClassification ?? operation.sensitivity} · {operation.accessType ?? 'READ'}</span></div><span className={`shopify-runtime-status ${statusClass(status)}`}>{status}</span><span className="shopify-operation-scope">{operation.requiredScopeMode === 'ANY' ? 'One of: ' : 'Needs: '}{operation.requiredScopes.join(', ')}</span><details className="shopify-operation-details"><summary>Details <ChevronDown size={14}/></summary><div><p><strong>Provider verification:</strong> {providerDetail}{snapshot?.capabilityVerifiedAt ? ` Last successful verification: ${new Date(snapshot.capabilityVerifiedAt).toLocaleString()}.` : ' No successful verification timestamp.'}</p><p><strong>Stored data:</strong> {operation.dataRecordCount === null ? 'Count unavailable' : `${operation.dataRecordCount.toLocaleString()} records`} · {operation.dataStatus.replaceAll('_', ' ')}. Last successful connector sync: {snapshot?.lastSuccessfulSyncAt ? new Date(snapshot.lastSuccessfulSyncAt).toLocaleString() : 'not recorded'}.</p><p><strong>Permission dependencies:</strong> fresh actual Shopify grant · implemented read operation · verified provider capability · workspace AI permission · selected assistant AI permission.</p>{operation.customerIdentityRequired && <p><strong>Identity:</strong> verified visitor ownership required.</p>}{reason && <p className="shopify-operation-reason"><strong>Why blocked:</strong> {reason}</p>}</div></details></div>
    {canControl ? <div className="shopify-operation-controls">
      <label title={!operation.providerCapabilityVerified ? 'Provider capability must be verified before changing this control.' : undefined}><input type="checkbox" checked={operation.workspaceSyncEnabled} disabled={busy || !operation.providerCapabilityVerified && !operation.workspaceSyncEnabled} onChange={(event) => onPermission(operation.category, event.target.checked, undefined, 'SYNC')}/>Workspace sync</label>
      <label title={!operation.providerCapabilityVerified ? 'Provider capability must be verified before changing this control.' : undefined}><input type="checkbox" checked={operation.workspaceAllowed} disabled={busy || !operation.providerCapabilityVerified && !operation.workspaceAllowed} onChange={(event) => onPermission(operation.category, event.target.checked, undefined, 'AI')}/>Workspace AI</label>
      <label title={!operation.workspaceAllowed ? 'Assistant AI access requires Workspace AI to be enabled.' : undefined}><input type="checkbox" checked={operation.assistantPermissionGranted} disabled={busy || !assistantId || !operation.workspaceAllowed || !operation.providerCapabilityVerified && !operation.assistantPermissionGranted} onChange={(event) => onPermission(operation.category, event.target.checked, assistantId)}/>Assistant AI</label>
      {!operation.workspaceAllowed && <small className="shopify-control-hint">Assistant access is not effective while Workspace AI is off.</small>}
    </div> : <span className="shopify-control-hint">Controls unavailable for unsupported operation</span>}
  </article>;
}

function statusClass(status: RuntimeStatus) {
  if (status === 'AI Ready') return 'is-ready';
  if (status === 'Unsupported' || status === 'Restricted' || status === 'Shopify Permission Missing') return 'is-blocked';
  return 'is-pending';
}
