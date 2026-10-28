import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, FileText, Plus, Search, RefreshCw, Archive, ArrowLeft, Pencil, Save, X, Database, ChevronLeft, ChevronRight, FileSpreadsheet, CircleHelp, Users } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../../services/api/client';
import { archiveKnowledge, archiveKnowledgeSources, updateKnowledge, reindexKnowledge, previewKnowledgeSearch, restoreKnowledge, permanentlyDeleteKnowledge, getKnowledgeDeleteImpact, listWebsitePages, type KnowledgeSearchHit, type KnowledgeSearchResult, type KnowledgeSource, type WebsitePagesResponse } from '../../services/api/knowledge';
import { archiveKnowledgeBase, createKnowledgeBase, createKnowledgeBaseFaqBatch, createKnowledgeBaseText, getKnowledgeBase, getKnowledgeBaseAssistants, getEffectiveKnowledge, listAvailableKnowledgeSources, listKnowledgeBaseSources, listKnowledgeBases, listUnassignedKnowledgeSources, addKnowledgeBaseSources, removeKnowledgeBaseSources, updateKnowledgeBase, linkAssistantToKnowledgeBase, unlinkAssistantFromKnowledgeBase, knowledgeBaseFaqTemplateUrl, previewKnowledgeBaseFaqImport, importKnowledgeBaseFaqs, type EffectiveKnowledge, type FaqDraft, type FaqImportPreview, type FaqImportResult, type KnowledgeBase, type KnowledgeBaseAssistants, type KnowledgeBaseSourcePage } from '../../services/api/knowledge-bases';
import './knowledge-bases.css';
import { PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';
import { BusinessDataVisibility } from './BusinessDataVisibility';
import { KNOWLEDGE_SECTION_CARDS, SHOPIFY_CATALOG_TAB } from './knowledge-sections';

const canManage = (role: string) => role === 'owner' || role === 'admin';
const failureMessage = (error: unknown) => error instanceof ApiError && error.kind === 'http' && error.status !== undefined && error.status < 500 ? error.message : 'We could not complete that request. Please try again.';
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(date));
const pageSize = 20;
const knowledgeStatusLabel = (status: string) => status === 'ready' ? 'Ready' : status === 'failed' ? 'Needs attention' : 'Preparing knowledge';

export function KnowledgeBasePage() {
  const { workspace } = useWorkspaceRoute();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const manager = canManage(workspace.role);
  const [dataView, setDataView] = useState<'knowledge' | 'stored'>(() => searchParams.get('view') === 'stored' ? 'stored' : 'knowledge');
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [basesWorkspace, setBasesWorkspace] = useState('');
  const [summary, setSummary] = useState({ totalKnowledgeBases: 0, totalSources: 0, unassignedSources: 0, linkedAssistants: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [sort, setSort] = useState('updatedAt');
  const [direction, setDirection] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignmentNotice, setAssignmentNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const createBaseLock = useRef(false);
  const assignSourcesLock = useRef(false);
  const [archivingBaseIds, setArchivingBaseIds] = useState<Set<string>>(new Set());
  const archivingBaseLocks = useRef(new Set<string>());
  const [reload, setReload] = useState(0);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [unassigned, setUnassigned] = useState<KnowledgeBaseSourcePage | null>(null);
  const [unassignedWorkspace, setUnassignedWorkspace] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [sourceProcessing, setSourceProcessing] = useState('');
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceSelected, setSourceSelected] = useState<string[]>([]);
  const [assignBaseId, setAssignBaseId] = useState('');
  const [baseSearch, setBaseSearch] = useState('');
  const [activeBases, setActiveBases] = useState<KnowledgeBase[]>([]);
  const [assigning, setAssigning] = useState(false);
  const currentBases = basesWorkspace === workspace.slug ? bases : [];
  const currentUnassigned = unassignedWorkspace === workspace.slug ? unassigned : null;

  useEffect(() => { setDataView(searchParams.get('view') === 'stored' ? 'stored' : 'knowledge'); }, [searchParams]);
  useEffect(() => { setPage(1); setSummary({ totalKnowledgeBases: 0, totalSources: 0, unassignedSources: 0, linkedAssistants: 0 }); setTotal(0); setUnassigned(null); setUnassignedWorkspace(''); setSourceSelected([]); setSourcePage(1); setActiveBases([]); setAssignmentNotice(''); }, [workspace.slug]);
  useEffect(() => { setPage(1); }, [workspace.slug, search, status, sort, direction]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    listKnowledgeBases(workspace.slug, { page, pageSize, search, status, sort, direction }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setBases(result.knowledgeBases); setBasesWorkspace(workspace.slug); setTotal(result.total); setSummary(result.summary); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, page, search, status, sort, direction, reload]);

  useEffect(() => {
    if (!showUnassigned) return;
    const controller = new AbortController();
    listUnassignedKnowledgeSources(workspace.slug, { page: sourcePage, pageSize, ...(sourceSearch ? { search: sourceSearch } : {}), ...(sourceType ? { type: sourceType.toUpperCase() } : {}), ...(sourceProcessing ? { processingStatus: sourceProcessing.toUpperCase() } : {}) }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setUnassigned(result); setUnassignedWorkspace(workspace.slug); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); });
    return () => controller.abort();
  }, [workspace.slug, showUnassigned, sourcePage, sourceSearch, sourceType, sourceProcessing, reload]);
  useEffect(() => { if (!showUnassigned || !manager) return; const controller = new AbortController(); listKnowledgeBases(workspace.slug, { page: 1, pageSize: 100, status: 'ACTIVE', sort: 'name', direction: 'asc', ...(baseSearch ? { search: baseSearch } : {}) }, controller.signal).then((result) => { if (!controller.signal.aborted) setActiveBases(result.knowledgeBases); }).catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); }); return () => controller.abort(); }, [workspace.slug, showUnassigned, manager, baseSearch, reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (createBaseLock.current) return;
    createBaseLock.current = true; setSaving(true); setError('');
    try { const base = await createKnowledgeBase(workspace.slug, { name, ...(description.trim() ? { description: description.trim() } : {}) }); navigate(`/workspace/${encodeURIComponent(workspace.slug)}/knowledge/${encodeURIComponent(base.id)}`); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { createBaseLock.current = false; setSaving(false); }
  }
  async function archive(base: KnowledgeBase) {
    if (!window.confirm(`Archive “${base.name}”? Assistants will stop inheriting sources through this base. Underlying sources and direct assistant links remain.`)) return;
    if (archivingBaseLocks.current.has(base.id)) return;
    archivingBaseLocks.current.add(base.id); setArchivingBaseIds((current) => new Set(current).add(base.id)); setError('');
    try { await archiveKnowledgeBase(workspace.slug, base.id); setReload((n) => n + 1); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { archivingBaseLocks.current.delete(base.id); setArchivingBaseIds((current) => { const next = new Set(current); next.delete(base.id); return next; }); }
  }
  function toggleSource(id: string) { setSourceSelected((current) => { if (current.includes(id)) return current.filter((value) => value !== id); if (current.length >= 100) { setError('Select up to 100 sources per assignment. Clear some selections before adding more.'); return current; } return [...current, id]; }); }
  function toggleSourcePage(rows: KnowledgeSource[]) { const ids = rows.map((source) => source.id); setSourceSelected((current) => { if (ids.every((id) => current.includes(id))) return current.filter((id) => !ids.includes(id)); const next = [...new Set([...current, ...ids])]; if (next.length > 100) { setError('Select up to 100 sources per assignment. Clear some selections before adding this page.'); return current; } return next; }); }
  async function assignSources() { if (!assignBaseId || !sourceSelected.length || assignSourcesLock.current) return; assignSourcesLock.current = true; setAssigning(true); setError(''); try { await addKnowledgeBaseSources(workspace.slug, assignBaseId, sourceSelected); setSourceSelected([]); setAssignmentNotice('Sources added to the selected Knowledge Base. No crawl was started.'); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { assignSourcesLock.current = false; setAssigning(false); } }

  return <>
    <PageHeader eyebrow="Workspace Knowledge" title="Knowledge Base" desc="Organize reusable, workspace-approved reference sources into collections for your assistants." action={manager && dataView === 'knowledge' && <button className="btn btn-primary" onClick={() => { setFormOpen(true); setError(''); }}><Plus size={16}/> Create Knowledge Base</button>}/>
    <div className="kb-dashboard-tabs" role="tablist" aria-label="Knowledge and stored data"><button role="tab" aria-selected={dataView === 'knowledge'} className={dataView === 'knowledge' ? 'active' : ''} onClick={() => setDataView('knowledge')}>Knowledge Bases</button>{manager && <button role="tab" aria-selected={dataView === 'stored'} className={dataView === 'stored' ? 'active' : ''} onClick={() => { setFormOpen(false); setDataView('stored'); }}>Stored business data</button>}</div>
    {dataView === 'stored' ? <BusinessDataVisibility slug={workspace.slug} manager={manager}/> : <>
    {error && <div className="workspace-form-error knowledge-error" role="alert">{error}<button className="button button-secondary" onClick={() => setReload((n) => n + 1)}><RefreshCw size={14}/> Try again</button></div>}{assignmentNotice && <p className="knowledge-footnote" role="status">{assignmentNotice}</p>}
    <section className="kb-summary" aria-label="Knowledge Base summary"><Summary icon={<BookOpen size={17}/>} label="Knowledge Bases" value={summary.totalKnowledgeBases}/><Summary icon={<FileText size={17}/>} label="Total sources" value={summary.totalSources}/><Summary icon={<FileText size={17}/>} label="Unassigned sources" value={summary.unassignedSources}/><Summary icon={<Users size={17}/>} label="Linked assistants" value={summary.linkedAssistants}/></section>
    {formOpen && <form className="workspace-panel kb-create-form" onSubmit={(event) => void submit(event)}><div><h2>Create Knowledge Base</h2><p>Sources are optional and can be added later.</p></div><label className="workspace-field">Name<input autoFocus required minLength={2} maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="Company Information"/></label><label className="workspace-field">Description <span className="optional-label">Optional</span><textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)}/></label><div className="assistant-form-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Creating…' : <><Save size={15}/> Create and open</>}</button></div></form>}
    <div className="kb-dashboard-tabs" role="tablist" aria-label="Knowledge views"><button role="tab" aria-selected={!showUnassigned} className={!showUnassigned ? 'active' : ''} onClick={() => setShowUnassigned(false)}>Knowledge Bases</button><button role="tab" aria-selected={showUnassigned} className={showUnassigned ? 'active' : ''} onClick={() => { setShowUnassigned(true); setSourcePage(1); }}>Unassigned Sources <span>{summary.unassignedSources}</span></button></div>
    {!showUnassigned && <section className="workspace-panel kb-dashboard-panel" aria-busy={loading}><div className="workspace-panel-heading"><div><h2>Knowledge Bases</h2><p>Each base can be connected to one or more assistants. New sources inherit that connection after processing and access checks.</p></div></div>
      <div className="kb-toolbar"><label className="kb-search"><Search size={15}/><input aria-label="Search Knowledge Bases" placeholder="Search by name" value={search} onChange={(event) => setSearch(event.target.value)}/></label><label className="workspace-field kb-filter">Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="ALL">All</option></select></label><label className="workspace-field kb-filter">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="updatedAt">Updated date</option><option value="createdAt">Created date</option><option value="name">Name</option></select></label><button className="button button-secondary" aria-label="Reverse sort direction" onClick={() => setDirection((current) => current === 'asc' ? 'desc' : 'asc')}>{direction === 'asc' ? 'Oldest / A–Z' : 'Newest / Z–A'}</button></div>
      {loading && currentBases.length === 0 ? <div className="kb-skeleton-list" role="status" aria-label="Loading Knowledge Bases"><i/><i/><i/></div> : error && currentBases.length === 0 ? null : currentBases.length === 0 ? search || status !== 'ACTIVE' ? <div className="knowledge-empty"><Search size={22}/><h3>No matching Knowledge Bases</h3><p>Try another name or clear the current filters.</p></div> : <div className="knowledge-empty"><BookOpen size={22}/><h3>No Knowledge Bases yet</h3><p>Create a Knowledge Base to organize approved sources. Sources remain optional.</p>{manager && <button className="button button-primary" onClick={() => setFormOpen(true)}><Plus size={14}/> Create Knowledge Base</button>}</div> : <div className="kb-card-list">{currentBases.map((base) => <article className="kb-card" key={base.id}><span className="workspace-feature-icon"><Database size={18}/></span><div className="kb-card-main"><div className="kb-card-title"><strong>{base.name}</strong><span className={`assistant-status assistant-status-${base.status}`}>{base.status}</span></div><p>{base.description || 'No description provided.'}</p><small>{base.sourceCount} sources · {base.linkedAssistantCount} assistants · Updated {dateLabel(base.updatedAt)}</small></div><div className="kb-card-actions"><Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/knowledge/${encodeURIComponent(base.id)}`}>Open</Link>{manager && base.status === 'active' && <Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/knowledge/${encodeURIComponent(base.id)}?tab=assistants`}>Manage assignments</Link>}{manager && base.status === 'active' && <button className="button button-secondary" aria-label={`Archive ${base.name}`} aria-busy={archivingBaseIds.has(base.id)} disabled={archivingBaseIds.has(base.id)} onClick={() => void archive(base)}>{archivingBaseIds.has(base.id) ? 'Archiving…' : <Archive size={14}/>}</button>}</div></article>)}</div>}
      {loading && currentBases.length > 0 && <p className="knowledge-footnote" role="status">Refreshing Knowledge Bases…</p>}
      {!loading && total > pageSize && <div className="kb-pagination"><span>Page {page} of {Math.ceil(total / pageSize)} · {total} Knowledge Bases</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}><ChevronLeft size={14}/> Previous</button><button className="button button-secondary" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((n) => n + 1)}>Next <ChevronRight size={14}/></button></div></div>}
    </section>}
    {showUnassigned && <section className="workspace-panel kb-dashboard-panel"><div className="workspace-panel-heading"><div><h2>Unassigned Sources</h2><p>Sources with no membership in an active Knowledge Base. Viewing them here does not change their existing assistant links.</p></div>{manager && summary.totalKnowledgeBases === 0 && <button className="button button-primary" onClick={() => { setShowUnassigned(false); setFormOpen(true); }}><Plus size={14}/> Create Knowledge Base</button>}</div>
      <div className="kb-toolbar"><label className="kb-search"><Search size={15}/><input aria-label="Search unassigned sources" placeholder="Search sources by name" value={sourceSearch} onChange={(event) => { setSourceSearch(event.target.value); setSourcePage(1); }}/></label><label className="workspace-field kb-filter">Type<select value={sourceType} onChange={(event) => { setSourceType(event.target.value); setSourcePage(1); }}><option value="">All types</option><option value="website">Website</option><option value="faq">FAQ</option><option value="text">Text</option></select></label><label className="workspace-field kb-filter">Processing<select value={sourceProcessing} onChange={(event) => { setSourceProcessing(event.target.value); setSourcePage(1); }}><option value="">All statuses</option><option value="not_processed">Not processed</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="ready">Ready</option><option value="failed">Failed</option></select></label></div>
      {manager && (activeBases.length > 0 || summary.totalKnowledgeBases > 0) && <div className="kb-bulk-footer"><span>{sourceSelected.length} selected {sourceSelected.length >= 100 ? '(100 maximum)' : ''}</span><div><button className="button button-secondary" disabled={!sourceSelected.length || assigning} onClick={() => setSourceSelected([])}>Clear selection</button><label className="workspace-field"><span className="sr-only">Search Knowledge Bases</span><input aria-label="Search destination Knowledge Bases" placeholder="Find Knowledge Base" value={baseSearch} onChange={(event) => setBaseSearch(event.target.value)}/></label><label className="workspace-field"><span className="sr-only">Destination Knowledge Base</span><select aria-label="Destination Knowledge Base" value={assignBaseId} onChange={(event) => setAssignBaseId(event.target.value)}><option value="">Choose a Knowledge Base</option>{activeBases.map((base) => <option value={base.id} key={base.id}>{base.name}</option>)}</select></label><button className="button button-primary" disabled={!sourceSelected.length || !assignBaseId || assigning} onClick={() => void assignSources()}>{assigning ? 'Assigning…' : 'Assign selected'}</button></div></div>}
      {!currentUnassigned ? <div className="kb-skeleton-list" role="status" aria-label="Loading unassigned sources"><i/><i/></div> : currentUnassigned.sources.length === 0 ? <div className="knowledge-empty"><FileText size={22}/><h3>{sourceSearch || sourceType || sourceProcessing ? 'No matching unassigned sources' : 'No unassigned sources'}</h3><p>{sourceSearch || sourceType || sourceProcessing ? 'Try changing or clearing the filters.' : 'Every active source belongs to an active Knowledge Base, or there are no sources yet.'}</p>{manager && summary.totalKnowledgeBases === 0 && <button className="button button-primary" onClick={() => { setShowUnassigned(false); setFormOpen(true); }}><Plus size={14}/> Create Knowledge Base</button>}</div> : <><div className="kb-select-all"><label><input type="checkbox" aria-label="Select all sources on this page" checked={currentUnassigned.sources.every((source) => sourceSelected.includes(source.id))} onChange={() => toggleSourcePage(currentUnassigned.sources)}/> Select all on this page</label></div><div className="kb-source-list">{currentUnassigned.sources.map((source) => <article className="kb-source-row" key={source.id}>{manager && <input type="checkbox" aria-label={`Select ${source.name}`} checked={sourceSelected.includes(source.id)} onChange={() => toggleSource(source.id)}/>}<span className="workspace-feature-icon">{source.type === 'faq' ? <BookOpen size={16}/> : <FileText size={16}/>}</span><div className="kb-source-main"><strong>{source.name}</strong><small>{source.type.toUpperCase()} · {knowledgeStatusLabel(source.processingStatus)} · Updated {dateLabel(source.updatedAt)}</small><details><summary>View source details</summary><p>{source.contentBody || source.description || 'No text content is stored for this source.'}</p><small>Knowledge Bases: {source.knowledgeBaseMemberships?.map((membership) => membership.name).join(', ') || 'None'}</small></details></div></article>)}</div><div className="kb-pagination"><span>Page {currentUnassigned.page} of {Math.max(1, Math.ceil(currentUnassigned.total / pageSize))} · {currentUnassigned.total} unassigned sources</span><div><button className="button button-secondary" disabled={sourcePage <= 1} onClick={() => setSourcePage((n) => n - 1)}><ChevronLeft size={14}/> Previous</button><button className="button button-secondary" disabled={sourcePage >= Math.ceil(currentUnassigned.total / pageSize)} onClick={() => setSourcePage((n) => n + 1)}>Next <ChevronRight size={14}/></button></div></div></>}
    </section>}
    </>}
  </>;
}

function Summary({ icon, label, value }: { icon: ReactNode; label: string; value: number }) { return <div className="kb-summary-card"><span className="workspace-feature-icon">{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>; }

export function KnowledgeBaseDetailPage() {
  const { workspace } = useWorkspaceRoute();
  const { baseId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const manager = canManage(workspace.role);
  const [base, setBase] = useState<KnowledgeBase | null>(null);
  const [loadedBaseKey, setLoadedBaseKey] = useState('');
  const [sourcePage, setSourcePage] = useState<KnowledgeBaseSourcePage | null>(null);
  const [sourcePageBaseKey, setSourcePageBaseKey] = useState('');
  const [assistants, setAssistants] = useState<KnowledgeBaseAssistants | null>(null);
  const [assistantsLoading, setAssistantsLoading] = useState(false);
  const [assistantsError, setAssistantsError] = useState('');
  const [assistantMutationError, setAssistantMutationError] = useState('');
  const [assistantSearch, setAssistantSearch] = useState('');
  const [websiteStatus, setWebsiteStatus] = useState<WebsitePagesResponse | null>(null);
  const [websiteStatusLoading, setWebsiteStatusLoading] = useState(false);
  const [websiteStatusError, setWebsiteStatusError] = useState('');
  const [websiteStatusRefresh, setWebsiteStatusRefresh] = useState(0);
  const [assistantRefresh, setAssistantRefresh] = useState(0);
  const [effectiveKnowledgeByAssistant, setEffectiveKnowledgeByAssistant] = useState<Record<string, EffectiveKnowledge>>({});
  const [effectiveKnowledgeErrors, setEffectiveKnowledgeErrors] = useState<Record<string, string>>({});
  const [effectiveKnowledgeLoading, setEffectiveKnowledgeLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setType] = useState('');
  const [sourceStatus, setSourceStatus] = useState('');
  const [processing, setProcessing] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assignmentNotice, setAssignmentNotice] = useState('');
  const [assistantNotice, setAssistantNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [availableOpen, setAvailableOpen] = useState(false);
  const [availablePage, setAvailablePage] = useState<KnowledgeBaseSourcePage | null>(null);
  const [availableSearch, setAvailableSearch] = useState('');
  const [availablePageNumber, setAvailablePageNumber] = useState(1);
  const [availableSelected, setAvailableSelected] = useState<string[]>([]);
  const [availableSelectionLoading, setAvailableSelectionLoading] = useState(false);
  const [createType, setCreateType] = useState<'faq' | 'text' | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceBody, setSourceBody] = useState('');
  const [sourceLanguageHint, setSourceLanguageHint] = useState('');
  const [sourceVisibility, setSourceVisibility] = useState<'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE'>('INTERNAL_RESTRICTED');
  const [edit, setEdit] = useState<KnowledgeSource | null>(null);
  const [editName, setEditName] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editVisibility, setEditVisibility] = useState<'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE'>('INTERNAL_RESTRICTED');
  const [editCategory, setEditCategory] = useState('');
  const [editLanguage, setEditLanguage] = useState('');
  const [assistantId, setAssistantId] = useState('');
  const [pendingOperations, setPendingOperations] = useState<Record<string, boolean>>({});
  const pendingOperationLocks = useRef(new Set<string>());
  const faqPreviewSequence = useRef(0);
  const [reload, setReload] = useState(0);
  const [editingBase, setEditingBase] = useState(false);
  const [baseName, setBaseName] = useState('');
  const [baseDescription, setBaseDescription] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferBaseId, setTransferBaseId] = useState('');
  const [transferBases, setTransferBases] = useState<KnowledgeBase[]>([]);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [sectionSearch, setSectionSearch] = useState('');
  const [sourceSection, setSourceSection] = useState<import('../../services/api/knowledge').KnowledgeSection>('BUSINESS_INTRODUCTION');
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [faqDrafts, setFaqDrafts] = useState<FaqDraft[]>([{ question: '', answer: '', visibility: 'INTERNAL_RESTRICTED' }]);
  const [faqImportFile, setFaqImportFile] = useState<File | null>(null);
  const [faqImportMode, setFaqImportMode] = useState(false);
  const [faqPreview, setFaqPreview] = useState<FaqImportPreview | null>(null);
  const [faqImportPolicy, setFaqImportPolicy] = useState<'SKIP_EXISTING' | 'REJECT_DUPLICATES'>('SKIP_EXISTING');
  const [faqImportResult, setFaqImportResult] = useState<FaqImportResult | null>(null);
  const [faqPreviewLoading, setFaqPreviewLoading] = useState(false);
  const [faqCategory, setFaqCategory] = useState('');
  const [sourceSort, setSourceSort] = useState('updatedAt');
  const [sourceDirection, setSourceDirection] = useState('desc');
  const [testQuery, setTestQuery] = useState('');
  const [testResults, setTestResults] = useState<KnowledgeSearchHit[] | null>(null);
  const [testMode, setTestMode] = useState<KnowledgeSearchResult['mode'] | null>(null);
  const [semanticUnavailableCode, setSemanticUnavailableCode] = useState<string | undefined>();
  const [testDiagnostics, setTestDiagnostics] = useState<KnowledgeSearchResult['diagnostics'] | null>(null);
  const [testEligibleSourceCount, setTestEligibleSourceCount] = useState<number | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const quickAction = searchParams.get('action');
  const requestedTab = searchParams.get('tab');
  const activeKnowledgeSection = KNOWLEDGE_SECTION_CARDS.find((section) => section.tab === activeTab);
  useEffect(() => {
    const tabs = ['overview', 'faqs', 'text', 'all', 'assistants', SHOPIFY_CATALOG_TAB, ...KNOWLEDGE_SECTION_CARDS.map((section) => section.tab)];
    setActiveTab(tabs.includes(requestedTab || '') ? requestedTab! : 'overview');
  }, [requestedTab, baseId]);

  function selectTab(tab: string) {
    setActiveTab(tab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }

  function beginOperation(key: string) {
    if (pendingOperationLocks.current.has(key)) return false;
    pendingOperationLocks.current.add(key);
    setPendingOperations((current) => ({ ...current, [key]: true }));
    return true;
  }
  function endOperation(key: string) {
    pendingOperationLocks.current.delete(key);
    setPendingOperations((current) => { const next = { ...current }; delete next[key]; return next; });
  }
  const isPending = (key: string) => Boolean(pendingOperations[key]);
  const currentSourcePage = sourcePageBaseKey === `${workspace.slug}:${baseId}` ? sourcePage : null;

  useEffect(() => {
    if (!addDrawerOpen && !edit) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const overlay = document.querySelector<HTMLElement>('.kb-add-drawer, .kb-modal');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => overlay?.querySelector<HTMLElement>('button,input,textarea,select,[href],[tabindex]:not([tabindex="-1"])')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (addDrawerOpen) closeAddDrawer();
        else setEdit(null);
        return;
      }
      if (event.key !== 'Tab' || !overlay) return;
      const focusable = [...overlay.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')].filter((item) => item.offsetParent !== null);
      if (!focusable.length) { event.preventDefault(); overlay.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [addDrawerOpen, edit]);

  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); setSelected([]); }, [workspace.slug, baseId, debouncedSearch, type, sourceStatus, processing, activeTab, faqCategory, sourceSort, sourceDirection]);
  useEffect(() => { faqPreviewSequence.current++; setAddDrawerOpen(false); setCreateType(null); setFaqImportMode(false); setFaqImportFile(null); setFaqPreview(null); setFaqImportResult(null); setFaqPreviewLoading(false); setFaqDrafts([{ question: '', answer: '', visibility: 'INTERNAL_RESTRICTED' }]); setSourceName(''); setSourceBody(''); setAssignmentNotice(''); setAssistantNotice(''); setTestResults(null); setTestMode(null); setSemanticUnavailableCode(undefined); setTestQuery(''); }, [workspace.slug, baseId]);
  useEffect(() => {
    if (!base || base.status !== 'active' || !manager || !['faq', 'import', 'text'].includes(quickAction || '')) return;
    setAddDrawerOpen(true);
    setCreateType(quickAction === 'faq' ? 'faq' : quickAction === 'text' ? 'text' : null);
    setFaqImportMode(quickAction === 'import');
    const actionTab = quickAction === 'faq' ? 'faqs' : quickAction === 'text' ? 'text' : null;
    if (actionTab) setActiveTab(actionTab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('action');
      if (actionTab) next.set('tab', actionTab);
      return next;
    }, { replace: true });
  }, [base, manager, quickAction, setSearchParams]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getKnowledgeBase(workspace.slug, baseId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setBase(result); setLoadedBaseKey(`${workspace.slug}:${baseId}`); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, baseId]);
  useEffect(() => {
    if (activeTab === SHOPIFY_CATALOG_TAB) return;
    const controller = new AbortController(); setLoading(true);
    const sourceType = activeKnowledgeSection ? '' : activeTab === 'faqs' ? 'FAQ' : activeTab === 'text' ? 'TEXT' : type;
    listKnowledgeBaseSources(workspace.slug, baseId, { page, pageSize, search: debouncedSearch, sort: sourceSort, direction: sourceDirection, ...(activeTab === 'faqs' && faqCategory ? { category: faqCategory } : {}), ...(activeKnowledgeSection ? { knowledgeSection: activeKnowledgeSection.id } : {}), ...(sourceType ? { type: sourceType } : {}), ...(sourceStatus ? { status: sourceStatus } : {}), ...(processing ? { processingStatus: processing } : {}) }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setSourcePage(result); setSourcePageBaseKey(`${workspace.slug}:${baseId}`); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, baseId, page, debouncedSearch, type, sourceStatus, processing, activeTab, activeKnowledgeSection?.id, faqCategory, sourceSort, sourceDirection, reload]);
  useEffect(() => {
    if (activeTab !== 'overview' && activeTab !== 'assistants') return;
    const controller = new AbortController();
    setAssistantsLoading(true);
    setAssistantsError('');
    getKnowledgeBaseAssistants(workspace.slug, baseId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setAssistants(result); })
      .catch((cause) => { if (!controller.signal.aborted) setAssistantsError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setAssistantsLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, baseId, activeTab, assistantRefresh]);

  useEffect(() => {
    if ((activeTab !== 'overview' && activeTab !== 'assistants') || !manager || !assistants) return;
    const candidates = assistants.linked.filter((assistant) => assistant.status === 'active').slice(0, 20);
    if (!candidates.length) {
      setEffectiveKnowledgeByAssistant({});
      setEffectiveKnowledgeErrors({});
      setEffectiveKnowledgeLoading(false);
      return;
    }
    const controller = new AbortController();
    setEffectiveKnowledgeByAssistant({});
    setEffectiveKnowledgeErrors({});
    setEffectiveKnowledgeLoading(true);
    Promise.all(candidates.map(async (assistant) => ({ assistantId: assistant.id, result: await getEffectiveKnowledge(workspace.slug, assistant.id, controller.signal) })))
      .then((results) => { if (!controller.signal.aborted) setEffectiveKnowledgeByAssistant(Object.fromEntries(results.map(({ assistantId, result }) => [assistantId, result]))); })
      .catch((cause) => { if (!controller.signal.aborted) setEffectiveKnowledgeErrors(Object.fromEntries(candidates.map((assistant) => [assistant.id, failureMessage(cause)]))); })
      .finally(() => { if (!controller.signal.aborted) setEffectiveKnowledgeLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, activeTab, manager, baseId, assistants]);

  const websiteSourceKey = (currentSourcePage?.sources ?? []).filter((source) => source.type === 'website').map((source) => source.id).join(',');
  useEffect(() => {
    if ((activeTab !== 'overview' && activeTab !== 'assistants') || !manager) return;
    const websiteSourceIds = websiteSourceKey ? websiteSourceKey.split(',') : [];
    if (!websiteSourceIds.length) {
      setWebsiteStatus({ pages: [], sources: [], total: 0, page: 1, pageSize: 50, pageCount: 0 });
      setWebsiteStatusError('');
      setWebsiteStatusLoading(false);
      return;
    }
    const controller = new AbortController();
    setWebsiteStatusLoading(true);
    setWebsiteStatusError('');
    setWebsiteStatus(null);
    // The API returns all website-source status metadata independently of page filters.
    // This panel only uses latestRun; one lightweight read replaces up to 20 × 50 page rows.
    listWebsitePages(workspace.slug, { page: 1, pageSize: 1 }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setWebsiteStatus(result); })
      .catch((cause) => { if (!controller.signal.aborted) setWebsiteStatusError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setWebsiteStatusLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, activeTab, manager, baseId, sourcePageBaseKey, websiteSourceKey, websiteStatusRefresh]);

  useEffect(() => {
    if (!availableOpen) return;
    const controller = new AbortController();
    listAvailableKnowledgeSources(workspace.slug, baseId, { page: availablePageNumber, pageSize, search: availableSearch }, controller.signal).then((result) => { if (!controller.signal.aborted) setAvailablePage(result); }).catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); });
    return () => controller.abort();
  }, [workspace.slug, baseId, availableOpen, availablePageNumber, availableSearch, reload]);
  useEffect(() => { if (!transferOpen) return; const controller = new AbortController(); listKnowledgeBases(workspace.slug, { page: 1, pageSize: 100, status: 'ACTIVE', sort: 'name', direction: 'asc', ...(transferSearch ? { search: transferSearch } : {}) }, controller.signal).then((result) => { if (!controller.signal.aborted) setTransferBases(result.knowledgeBases.filter((item) => item.id !== baseId)); }).catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); }); return () => controller.abort(); }, [workspace.slug, baseId, transferOpen, transferSearch]);
  async function saveBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!base || !beginOperation(`base:${base.id}`)) return;
    setError('');
    try { const updated = await updateKnowledgeBase(workspace.slug, base.id, { name: baseName, description: baseDescription }); setBase(updated); setEditingBase(false); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { endOperation(`base:${base.id}`); }
  }
  async function setAutoAddEligibleSources(enabled: boolean) {
    if (!base || !beginOperation(`base:${base.id}`)) return;
    setError('');
    try { const updated = await updateKnowledgeBase(workspace.slug, base.id, { autoAddEligibleSources: enabled }); setBase(updated); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { endOperation(`base:${base.id}`); }
  }
  async function archiveBase() {
    if (!base || !window.confirm(`Archive “${base.name}”? Assistants will stop inheriting its sources.`) || !beginOperation(`base:${base.id}`)) return;
    setError('');
    try { await archiveKnowledgeBase(workspace.slug, base.id); navigate(`/workspace/${encodeURIComponent(workspace.slug)}/knowledge`); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { endOperation(`base:${base.id}`); }
  }
  function toggle(id: string, list: string[], setter: (value: string[]) => void) { if (list.includes(id)) setter(list.filter((item) => item !== id)); else if (list.length < 100) setter([...list, id]); else setError('Select up to 100 sources per bulk action. Clear some selections before adding more.'); }
  function toggleCurrentPage(rows: KnowledgeSource[], list: string[], setter: (value: string[]) => void) { const ids = rows.map((row) => row.id); if (ids.every((id) => list.includes(id))) setter(list.filter((id) => !ids.includes(id))); else if (new Set([...list, ...ids]).size <= 100) setter([...new Set([...list, ...ids])]); else setError('Select up to 100 sources per bulk action. Clear some selections before adding more.'); }
  async function selectAllFilteredAvailable() {
    if (availableSelectionLoading) return;
    setAvailableSelectionLoading(true); setError('');
    try {
      const first = await listAvailableKnowledgeSources(workspace.slug, baseId, { page: 1, pageSize: 100, search: availableSearch });
      if (first.total > 500) { setError('More than 500 sources match. Narrow the search before selecting all.'); return; }
      const ids = [...first.sources.map((item) => item.id)];
      for (let pageNumber = 2; pageNumber <= Math.ceil(first.total / 100); pageNumber++) {
        const pageResult = await listAvailableKnowledgeSources(workspace.slug, baseId, { page: pageNumber, pageSize: 100, search: availableSearch });
        ids.push(...pageResult.sources.map((item) => item.id));
      }
      setAvailableSelected([...new Set([...availableSelected, ...ids])]);
    } catch (cause) { setError(failureMessage(cause)); }
    finally { setAvailableSelectionLoading(false); }
  }
  function beginSourceBatch(ids: string[]) { const keys = [...new Set(ids)].map((id) => `source:${id}`); const started: string[] = []; for (const key of keys) { if (!beginOperation(key)) { started.forEach(endOperation); return null; } started.push(key); } return started; }
  function endSourceBatch(keys: string[]) { keys.forEach(endOperation); }
  async function addSelected() { if (!availableSelected.length || !beginOperation('sources:add')) return; setError(''); let added = 0; let alreadyPresent = 0; let restrictedVisibility = 0; let processingBlocked = 0; let failedProcessing = 0; let statusBlocked = 0; try { for (let index = 0; index < availableSelected.length; index += 100) { const result = await addKnowledgeBaseSources(workspace.slug, baseId, availableSelected.slice(index, index + 100)); added += result.added; alreadyPresent += result.alreadyPresent; restrictedVisibility += result.restrictedVisibility; processingBlocked += result.processingBlocked; failedProcessing += result.failedProcessing; statusBlocked += result.statusBlocked; } setAvailableSelected([]); setAvailableOpen(false); setAssignmentNotice(`${added} source(s) added; ${alreadyPresent} already assigned. ${restrictedVisibility} are restricted and excluded from public retrieval; ${processingBlocked} are not ready/indexed (${failedProcessing} failed processing); ${statusBlocked} are not in a registered searchable state. Membership does not change visibility or start a crawl. Connector/assistant authorization is checked separately in Search Preview.`); setReload((n) => n + 1); } catch (cause) { setError(`${failureMessage(cause)}${added ? ` ${added} source(s) were added before the failed batch.` : ''}`); setAssignmentNotice(alreadyPresent ? `${alreadyPresent} source(s) were already assigned.` : ''); setReload((n) => n + 1); } finally { endOperation('sources:add'); } }
  async function transferSelected() { if (!transferBaseId || !selected.length) return; const locks = beginSourceBatch(selected); if (!locks) return; setError(''); try { await addKnowledgeBaseSources(workspace.slug, transferBaseId, selected); setSelected([]); setTransferOpen(false); setTransferBaseId(''); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endSourceBatch(locks); } }
  async function removeSelected() { if (!selected.length || !window.confirm(`Remove ${selected.length} source(s) from this Knowledge Base? The source records will remain in the workspace.`)) return; const locks = beginSourceBatch(selected); if (!locks) return; setError(''); try { await removeKnowledgeBaseSources(workspace.slug, baseId, selected); setSelected([]); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endSourceBatch(locks); } }
  async function archiveSelected() { if (!selected.length || !window.confirm(`Archive ${selected.length} source(s)? They will become inactive in every Knowledge Base and direct assistant link.`)) return; const locks = beginSourceBatch(selected); if (!locks) return; setError(''); try { await archiveKnowledgeSources(workspace.slug, selected); setSelected([]); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endSourceBatch(locks); } }
  async function createSource(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const op = 'source:create-text'; if (!beginOperation(op)) return; setError(''); try { await createKnowledgeBaseText(workspace.slug, baseId, { title: sourceName, content: sourceBody, knowledgeSection: sourceSection, ...(sourceLanguageHint.trim() ? { languageHint: sourceLanguageHint.trim() } : {}), visibility: sourceVisibility }); setCreateType(null); setAddDrawerOpen(false); setSourceName(''); setSourceBody(''); setSourceLanguageHint(''); setSourceVisibility('INTERNAL_RESTRICTED'); selectTab(activeKnowledgeSection?.tab || sourceSection.toLowerCase().replaceAll('_', '-')); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  function closeAddDrawer() { if (!faqImportResult && (sourceName || sourceBody || sourceLanguageHint || faqDrafts.some((row) => row.question || row.answer) || faqImportFile) && !window.confirm('Discard the unsaved knowledge changes?')) return; setAddDrawerOpen(false); setCreateType(null); setSourceName(''); setSourceBody(''); setSourceLanguageHint(''); setFaqDrafts([{ question: '', answer: '', visibility: 'INTERNAL_RESTRICTED' }]); setFaqPreview(null); setFaqImportFile(null); setFaqImportResult(null); setFaqImportMode(false); }
  async function createFaqSet(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const op = 'source:create-faqs'; if (!beginOperation(op)) return; const valid = faqDrafts.filter((row) => row.question.trim() && row.answer.trim()); if (valid.length !== faqDrafts.length) { setError('Complete every FAQ question and answer before saving.'); endOperation(op); return; } if (!valid.length) { setError('Add at least one question and answer.'); endOperation(op); return; } setError(''); try { await createKnowledgeBaseFaqBatch(workspace.slug, baseId, valid.map((row) => ({ ...row, knowledgeSection: sourceSection, ...(row.category?.trim() ? { category: row.category.trim() } : {}), ...(row.languageHint?.trim() ? { languageHint: row.languageHint.trim() } : {}) }))); setFaqDrafts([{ question: '', answer: '', visibility: 'INTERNAL_RESTRICTED' }]); setAddDrawerOpen(false); setCreateType(null); selectTab(activeKnowledgeSection?.tab || sourceSection.toLowerCase().replaceAll('_', '-')); setPage(1); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  async function previewFaqFile(file: File) { const sequence = ++faqPreviewSequence.current; setFaqImportFile(file); setFaqPreview(null); setFaqImportResult(null); setFaqPreviewLoading(true); setError(''); try { const result = await previewKnowledgeBaseFaqImport(workspace.slug, baseId, file); if (sequence === faqPreviewSequence.current) setFaqPreview(result); } catch (cause) { if (sequence === faqPreviewSequence.current) setError(failureMessage(cause)); } finally { if (sequence === faqPreviewSequence.current) setFaqPreviewLoading(false); } }
  async function commitFaqImport() { if (!faqImportFile || !faqPreview) return; const op = 'source:import-faqs'; if (!beginOperation(op)) return; setError(''); try { const result = await importKnowledgeBaseFaqs(workspace.slug, baseId, faqImportFile, faqImportPolicy, 'INTERNAL_RESTRICTED', sourceSection); setFaqImportResult(result); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  async function saveSourceEdit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!edit) return; const sourceId = edit.id; const op = `source:${sourceId}`; if (!beginOperation(op)) return; setError(''); try { const input: Record<string, string> = edit.type === 'faq' ? { question: editName, answer: editBody, category: editCategory, languageHint: editLanguage, visibility: editVisibility } : { name: editName, content: editBody, languageHint: editLanguage, visibility: editVisibility }; await updateKnowledge(workspace.slug, sourceId, input); setEdit(null); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  async function archiveSource(source: KnowledgeSource) { if (!window.confirm(`Archive “${source.name}”? It will become ineligible across every Knowledge Base.`)) return; const op = `source:${source.id}`; if (!beginOperation(op)) return; setError(''); try { await archiveKnowledge(workspace.slug, source.id); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  async function restoreSource(source: KnowledgeSource) { if (!window.confirm(`Restore “${source.name}”? It will be prepared for search again.`)) return; const op = `source:${source.id}`; if (!beginOperation(op)) return; setError(''); try { await restoreKnowledge(workspace.slug, source.id); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  async function deleteSource(source: KnowledgeSource) { const op = `source:${source.id}`; if (!beginOperation(op)) return; setError(''); try { const { impact } = await getKnowledgeDeleteImpact(workspace.slug, source.id); const confirmed = window.confirm(`Permanently delete “${source.name}” from this workspace? This will remove ${impact.baseLinks} Knowledge Base links, ${impact.assistantLinks} direct assistant links, ${impact.pages} pages, ${impact.chunks} indexed chunks and ${impact.pendingJobs} pending jobs. This cannot be undone.`); if (!confirmed) return; await permanentlyDeleteKnowledge(workspace.slug, source.id); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  async function reindexSource(source: KnowledgeSource) { const op = `source:${source.id}`; if (!beginOperation(op)) return; setError(''); try { await reindexKnowledge(workspace.slug, source.id); setReload((n) => n + 1); } catch (cause) { setError(failureMessage(cause)); } finally { endOperation(op); } }
  async function runSearchPreview(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const targetAssistant = assistantId || (assistants?.knowledgeResolution?.isDefault ? assistants.available[0]?.id : undefined) || assistants?.linked[0]?.id; if (!targetAssistant || !testQuery.trim() || testLoading) { if (!targetAssistant) setError('Select an active assistant to preview its effective knowledge.'); return; } setTestLoading(true); setError(''); try { const result = await previewKnowledgeSearch(workspace.slug, targetAssistant, testQuery.trim()); setTestResults(result.results); setTestMode(result.mode); setSemanticUnavailableCode(result.semanticUnavailableCode); setTestDiagnostics(result.diagnostics ?? null); setTestEligibleSourceCount(result.eligibleSourceCount); } catch (cause) { setError(failureMessage(cause)); } finally { setTestLoading(false); } }
  async function linkAssistant() {
    if (!assistantId || !assistants?.available.some((assistant) => assistant.id === assistantId)) {
      setAssistantMutationError('Select an available active assistant first.');
      return;
    }
    const id = assistantId;
    const op = `assistant:${id}`;
    if (!beginOperation(op)) return;
    setAssistantMutationError(''); setAssistantsError(''); setAssistantNotice('');
    try {
      const saved = await linkAssistantToKnowledgeBase(workspace.slug, baseId, id);
      if (!saved.linked || saved.assistantId !== id || saved.knowledgeBaseId !== baseId) throw new Error('The server did not confirm this assistant connection.');
      const refreshed = await getKnowledgeBaseAssistants(workspace.slug, baseId);
      if (!refreshed.linked.some((assistant) => assistant.id === id)) throw new Error('The connection was accepted but is not present in the refreshed assistant list. Refresh the page to check its status.');
      setAssistants(refreshed);
      setAssistantId('');
      setAssistantSearch('');
      setWebsiteStatusRefresh((n) => n + 1);
      setAssistantNotice(`${refreshed.linked.find((assistant) => assistant.id === id)?.name ?? 'Assistant'} connected to this Knowledge Base.`);
    } catch (cause) {
      setAssistantMutationError(cause instanceof ApiError ? failureMessage(cause) : cause instanceof Error ? cause.message : failureMessage(cause));
    } finally {
      endOperation(op);
    }
  }
  async function unlinkAssistant(id: string) {
    const linkedAssistant = assistants?.linked.find((assistant) => assistant.id === id);
    if (!window.confirm(`Disconnect ${linkedAssistant?.name ?? 'this assistant'} from the Knowledge Base? The assistant and source data will remain unchanged.`)) return;
    const op = `assistant:${id}`;
    if (!beginOperation(op)) return;
    setAssistantMutationError(''); setAssistantsError(''); setAssistantNotice('');
    try {
      const saved = await unlinkAssistantFromKnowledgeBase(workspace.slug, baseId, id);
      if (!saved.unlinked || saved.assistantId !== id || saved.knowledgeBaseId !== baseId) throw new Error('The server did not confirm this disconnection.');
      const refreshed = await getKnowledgeBaseAssistants(workspace.slug, baseId);
      if (refreshed.linked.some((assistant) => assistant.id === id)) throw new Error('The disconnection was accepted but the assistant is still present in the refreshed list. Refresh the page to check its status.');
      setAssistants(refreshed);
      setWebsiteStatusRefresh((n) => n + 1);
      setAssistantNotice(`${linkedAssistant?.name ?? 'Assistant'} disconnected from this Knowledge Base.`);
    } catch (cause) {
      setAssistantMutationError(cause instanceof ApiError ? failureMessage(cause) : cause instanceof Error ? cause.message : failureMessage(cause));
    } finally {
      endOperation(op);
    }
  }

  function knowledgeAvailability(source: KnowledgeSource, assistant: KnowledgeBaseAssistants['linked'][number]) {
    if (!manager) return 'Detailed website eligibility is visible to workspace owners and admins.';
    if (assistant.status !== 'active') return 'Blocked: assistant is inactive.';
    if (source.status !== 'registered') return 'Blocked: source is not active.';
    if (source.processingStatus !== 'ready') return `Blocked: source indexing is ${source.processingStatus.replaceAll('_', ' ')}.`;
    if (source.visibility !== 'PUBLIC_REFERENCE') return 'Blocked: source visibility is not Public reference.';
    if (effectiveKnowledgeLoading && !effectiveKnowledgeByAssistant[assistant.id]) return 'Checking server-authorized effective knowledge…';
    if (effectiveKnowledgeErrors[assistant.id]) return `Could not confirm effective knowledge: ${effectiveKnowledgeErrors[assistant.id]}`;
    const effective = effectiveKnowledgeByAssistant[assistant.id];
    if (effective?.sources.some((item) => item.id === source.id)) return 'Eligible in the server-resolved public knowledge set. Widget origin and session authorization are checked separately.';
    if (effective) return 'Not in this assistant’s effective public knowledge set. Check Knowledge Base selection and source permissions.';
    return 'Effective knowledge status is unavailable. Retry the assistant eligibility check.';
  }

  const connectedAssistantsPanel = <section id="kb-assistant-connections" className="workspace-panel kb-detail-panel" aria-labelledby="kb-connected-assistants-title">
    <div className="workspace-panel-heading"><div><h2 id="kb-connected-assistants-title">Connected AI Assistants</h2><p>Assistant links remain available for workspaces with multiple Knowledge Bases. This changes access relationships only; it does not crawl or reindex sources.</p></div></div>
    {assistants?.knowledgeResolution?.isDefault && <p className="knowledge-footnote" role="status">This is the workspace default Knowledge Base. Eligible ready public knowledge is available automatically to active assistants; no manual assistant link is required.</p>}
    {assistants?.knowledgeResolution && !assistants.knowledgeResolution.isDefault && assistants.knowledgeResolution.activeKnowledgeBaseCount > 1 && <p className="knowledge-footnote">This workspace has multiple active Knowledge Bases. Assistants use the bases explicitly assigned to them.</p>}
    {assistantsLoading && <p role="status">Loading assistant connections…</p>}
    {assistantsError && <div className="workspace-form-error" role="alert">Could not load assistant connections: {assistantsError}<button className="button button-secondary" onClick={() => setAssistantRefresh((n) => n + 1)}><RefreshCw size={14}/> Retry</button></div>}
    {Object.keys(effectiveKnowledgeErrors).length > 0 && <div className="workspace-form-error" role="alert">Could not verify effective knowledge eligibility. {Object.values(effectiveKnowledgeErrors)[0]}<button className="button button-secondary" onClick={() => setAssistantRefresh((n) => n + 1)}><RefreshCw size={14}/> Retry eligibility check</button></div>}
    {assistantMutationError && <p className="workspace-form-error" role="alert">{assistantMutationError}</p>}
    {assistantNotice && <p className="knowledge-footnote" role="status">{assistantNotice}</p>}
    {assistants && !assistantsLoading && !assistantsError && <>
      {assistants.linked.length ? assistants.linked.map((assistant) => <article className="assistant-knowledge-row" key={assistant.id}>
        <div><strong>{assistant.name}</strong><small>Explicit Knowledge Base connection: Connected · Assistant status: {assistant.status}</small>
          {(currentSourcePage?.sources ?? []).filter((source) => source.type === 'website' && source.status !== 'archived').map((source) => {
            const runtimeSource = websiteStatus?.sources.find((item) => item.id === source.id);
            return <small key={source.id}>Website knowledge: {source.name} ({source.sourceUrl ?? 'URL unavailable'}) · Knowledge availability: {knowledgeAvailability(source, assistant)} Widget origin and session authorization are checked separately.{runtimeSource?.latestRun?.failedPages ? ` · Partial crawl retained: ${runtimeSource.latestRun.failedPages} failed page(s)` : ''}</small>;
          })}
          {manager && (currentSourcePage?.sources ?? []).some((source) => source.type === 'website') && websiteStatusLoading && <small role="status">Checking website index readiness…</small>}
          {manager && websiteStatusError && (currentSourcePage?.sources ?? []).some((source) => source.type === 'website') && <small role="alert">Website page diagnostics failed: {websiteStatusError}</small>}
        </div>
        {manager && (assistants.knowledgeResolution?.activeKnowledgeBaseCount ?? 0) > 1 && <button className="button button-secondary" disabled={isPending(`assistant:${assistant.id}`) || assistantsLoading} onClick={() => void unlinkAssistant(assistant.id)}>{isPending(`assistant:${assistant.id}`) ? 'Disconnecting…' : 'Disconnect'}</button>}
      </article>) : <p className="knowledge-footnote">{assistants.knowledgeResolution?.isDefault ? 'No explicit assistant links are needed: active assistants automatically receive eligible ready public knowledge from this default base.' : 'No assistants are explicitly connected.'}</p>}
      {manager && base?.status === 'active' && (assistants.knowledgeResolution?.activeKnowledgeBaseCount ?? 0) > 1 && <div className="assistant-knowledge-add">
        {assistants.available.length > 0 ? <>
          <label className="workspace-field">Find an active assistant<input aria-label="Search active assistants" value={assistantSearch} onChange={(event) => setAssistantSearch(event.target.value)} placeholder="Search assistants by name"/></label>
          <label className="workspace-field">Assistant<select aria-label="Available assistants" value={assistantId} onChange={(event) => setAssistantId(event.target.value)} disabled={assistantsLoading || isPending(`assistant:${assistantId}`)}><option value="">Select an assistant</option>{assistants.available.filter((item) => item.name.toLowerCase().includes(assistantSearch.trim().toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button className="button button-primary" disabled={!assistantId || !assistants.available.some((item) => item.id === assistantId) || assistantsLoading || isPending(`assistant:${assistantId}`)} onClick={() => void linkAssistant()}>{isPending(`assistant:${assistantId}`) ? 'Connecting…' : 'Connect'}</button>
        </> : <p className="knowledge-footnote">{assistants.linked.length ? 'All active assistants are already connected.' : 'No active assistants are available in this workspace.'}</p>}
      </div>}
      {!manager && <p className="knowledge-footnote">You can view connections. An owner or admin can connect or disconnect assistants.</p>}
      {(currentSourcePage?.sources ?? []).filter((source) => source.type === 'website' && source.status !== 'archived').length > 0 && <div className="kb-source-list" aria-label="Website sources in this Knowledge Base">
        {(currentSourcePage?.sources ?? []).filter((source) => source.type === 'website' && source.status !== 'archived').map((source) => {
          const runtimeSource = websiteStatus?.sources.find((item) => item.id === source.id);
          return <article className="kb-source-row" key={source.id}><div className="kb-source-main"><strong>{source.name}</strong><small>{source.sourceUrl ?? 'Website URL unavailable'} · Knowledge Base source: {source.processingStatus} · {source.visibility?.replaceAll('_', ' ') ?? 'Visibility unavailable'} · {source.pageCount ?? 0} saved pages</small>{runtimeSource?.latestRun && <small>Latest crawl: {runtimeSource.latestRun.status} · {runtimeSource.latestRun.failedPages} failed page(s). Partial crawl warnings are retained.</small>}</div></article>;
        })}
      </div>}
    </>}
  </section>;

  if (error && loadedBaseKey !== `${workspace.slug}:${baseId}`) return <section className="workspace-panel assistant-empty"><p role="alert">{error}</p><button className="button button-secondary" onClick={() => setReload((n) => n + 1)}><RefreshCw size={14}/> Try again</button></section>;
  if ((loading && !base) || loadedBaseKey !== `${workspace.slug}:${baseId}`) return <div className="workspace-panel assistant-loading" role="status"><span className="workspace-spinner"/>Loading Knowledge Base…</div>;
  if (!base) return <section className="workspace-panel assistant-loading" role="status"><span className="workspace-spinner"/>Loading Knowledge Base…</section>;
  if (activeTab !== 'assistants' && activeTab !== 'overview' && activeTab !== SHOPIFY_CATALOG_TAB && (!sourcePage || sourcePageBaseKey !== `${workspace.slug}:${baseId}`)) {
    if (error) return <section className="workspace-panel assistant-empty"><p role="alert">{error}</p><button className="button button-secondary" onClick={() => { setError(''); setReload((n) => n + 1); }}><RefreshCw size={14}/> Retry loading sources</button></section>;
    return <section className="workspace-panel assistant-loading" role="status"><span className="workspace-spinner"/>Loading knowledge sources…</section>;
  }
  const rows = currentSourcePage?.sources ?? [];
  const previewAssistants = assistants?.knowledgeResolution?.isDefault
    ? [...(assistants.linked ?? []), ...(assistants.available ?? [])]
    : assistants?.linked ?? [];
  const previewAssistantId = assistantId || previewAssistants[0]?.id || '';
  const processingCounts = currentSourcePage?.summary?.byProcessingStatus || {};
  const readyCount = processingCounts.ready ?? 0;
  const attentionCount = (processingCounts.not_processed ?? 0) + (processingCounts.queued ?? 0) + (processingCounts.processing ?? 0) + (processingCounts.failed ?? 0);
  return <>
    <Link className="assistant-back-link" to={`/workspace/${encodeURIComponent(workspace.slug)}/knowledge`}><ArrowLeft size={15}/> Knowledge Bases</Link>
    <PageHeader eyebrow={`Knowledge Base · ${base.status}`} title={base.name} desc={base.description || 'No description provided.'} statusLabel={base.status} action={manager && base.status === 'active' && <div className="kb-header-actions"><button className="btn btn-primary" onClick={() => { selectTab('all'); setAvailableOpen(true); setAvailableSelected([]); }}><Database size={14}/> Add existing source</button><button className="btn btn-secondary" onClick={() => { setAddDrawerOpen(true); setCreateType(null); }}><Plus size={14}/> Add Knowledge</button><button className="btn btn-secondary" onClick={() => { setBaseName(base.name); setBaseDescription(base.description || ''); setEditingBase(true); }}><Pencil size={14}/> Edit</button><button className="btn btn-secondary" onClick={() => void archiveBase()}><Archive size={14}/> Archive</button></div>}/>
    {error && <div className="workspace-form-error knowledge-error" role="alert">{error}<button className="button button-secondary" onClick={() => { setReload((n) => n + 1); setAssistantRefresh((n) => n + 1); }}><RefreshCw size={14}/> Refresh</button></div>}
    {assignmentNotice && <p className="knowledge-footnote" role="status">{assignmentNotice}</p>}
    {editingBase && <form className="workspace-panel kb-create-form" onSubmit={(event) => void saveBase(event)}><label className="workspace-field">Name<input required minLength={2} maxLength={200} value={baseName} onChange={(event) => setBaseName(event.target.value)}/></label><label className="workspace-field">Description<textarea rows={2} maxLength={1000} value={baseDescription} onChange={(event) => setBaseDescription(event.target.value)}/></label><div className="assistant-form-actions"><button type="button" className="button button-secondary" onClick={() => setEditingBase(false)}>Cancel</button><button className="button button-primary" disabled={isPending(`base:${base.id}`)}>{isPending(`base:${base.id}`) ? <><Save size={14}/> Saving…</> : <><Save size={14}/> Save</>}</button></div></form>}
    <nav className="kb-detail-tabs" role="tablist" aria-label="Knowledge Base views">{(['overview', 'all', 'faqs', 'text', 'assistants'] as const).map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => selectTab(tab)}>{tab === 'all' ? 'All Sources' : tab[0]!.toUpperCase() + tab.slice(1)}</button>)}{KNOWLEDGE_SECTION_CARDS.map((section) => <button key={section.tab} role="tab" aria-selected={activeTab === section.tab} className={activeTab === section.tab ? 'active' : ''} onClick={() => selectTab(section.tab)}>{section.title}</button>)}<button role="tab" aria-selected={activeTab === SHOPIFY_CATALOG_TAB} className={activeTab === SHOPIFY_CATALOG_TAB ? 'active' : ''} onClick={() => selectTab(SHOPIFY_CATALOG_TAB)}>Products &amp; Collections</button></nav>
    {activeTab === 'overview' && <><label className="kb-search kb-section-search"><Search size={14}/><input aria-label="Filter knowledge sections" placeholder="Filter sections" value={sectionSearch} onChange={(event) => setSectionSearch(event.target.value)}/></label><section className="kb-section-grid" aria-label="Knowledge sections">{KNOWLEDGE_SECTION_CARDS.filter((section) => `${section.title} ${section.description}`.toLowerCase().includes(sectionSearch.trim().toLowerCase())).map((section) => { const counts = sourcePage?.summary?.bySectionProcessingStatus ?? {}; const count = sourcePage?.summary?.byKnowledgeSection?.[section.id] ?? 0; const ready = counts[`${section.id}:ready`] ?? 0; const pending = counts[`${section.id}:not_processed`] ?? 0; const queued = counts[`${section.id}:queued`] ?? 0; const processing = counts[`${section.id}:processing`] ?? 0; const failed = counts[`${section.id}:failed`] ?? 0; return <button className="kb-section-card" key={section.id} onClick={() => selectTab(section.tab)}><span><strong>{section.title}</strong><small>{section.description}</small></span><span className="kb-section-count"><b>{count}</b><small>{ready} ready · {pending} new · {queued} queued · {processing} processing · {failed} failed</small></span></button>; })}{'products & collections authorized shopify catalog variants prices stock'.includes(sectionSearch.trim().toLowerCase()) && <button className="kb-section-card kb-section-shopify" onClick={() => selectTab(SHOPIFY_CATALOG_TAB)}><span><strong>Products &amp; Collections</strong><small>Authorized Shopify catalog, variants, prices and stock.</small></span><span className="kb-section-count"><b>Shopify</b><small>Open connection status</small></span></button>}</section></>}
    {activeTab === 'overview' && <><section className="kb-overview"><div className="kb-overview-main"><strong>{sourcePage?.summary?.sourceCount ?? base.sourceCount}</strong><small>Active sources</small></div><div className="kb-overview-main"><strong>{sourcePage?.summary?.byType?.faq ?? 0}</strong><small>FAQs</small></div><div className="kb-overview-main"><strong>{sourcePage?.summary?.byType?.text ?? 0}</strong><small>Text items</small></div><div className="kb-overview-main"><strong>{readyCount}</strong><small>Ready</small></div><div className="kb-overview-main"><strong>{attentionCount}</strong><small>Preparing or needs attention</small></div><div className="kb-overview-main"><strong>{base.linkedAssistantCount}</strong><small>Explicit assistant links</small></div></section>{manager && base.status === 'active' && <section className="workspace-panel kb-detail-panel"><label className="kb-select-all"><span><strong>Auto-add new eligible knowledge sources</strong><small>New FAQ/text sources link when created; website sources link after a successful crawl publishes an active index. This never changes visibility or access permissions.</small></span><input type="checkbox" aria-label="Auto-add new eligible knowledge sources" checked={Boolean(base.autoAddEligibleSources)} disabled={isPending(`base:${base.id}`)} onChange={(event) => void setAutoAddEligibleSources(event.target.checked)}/></label></section>}{connectedAssistantsPanel}<section className="workspace-panel kb-detail-panel"><div className="workspace-panel-heading"><div><h2>Recent knowledge</h2><p>Latest changes in this collection.</p></div></div>{rows.length ? <div className="kb-recent-list">{rows.slice(0, 5).map((source) => <div key={source.id}><span>{source.name}</span><small>{source.type.toUpperCase()} · {knowledgeStatusLabel(source.processingStatus)} · Updated {dateLabel(source.updatedAt)}</small></div>)}</div> : <p className="knowledge-footnote">Sources added here will appear in recent knowledge.</p>}</section>{manager && <section className="workspace-panel kb-detail-panel"><div className="workspace-panel-heading"><div><h2>Customer knowledge search preview</h2><p>Uses the selected assistant’s actual public retrieval eligibility and the existing retrieval service. Results are excerpts; no AI/provider call is made.</p></div></div><form className="kb-toolbar" onSubmit={(event) => void runSearchPreview(event)}><label className="workspace-field kb-filter">Assistant<select aria-label="Assistant for search preview" value={previewAssistantId} onChange={(event) => setAssistantId(event.target.value)}><option value="">Select assistant</option>{previewAssistants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="workspace-field kb-search">Search query<input aria-label="Knowledge search query" maxLength={2000} value={testQuery} onChange={(event) => setTestQuery(event.target.value)} placeholder="Ask a question to test indexed knowledge"/></label><button className="button button-primary" disabled={testLoading || !testQuery.trim() || !previewAssistantId}>{testLoading ? 'Searching…' : 'Search knowledge'}</button></form>{testMode && <p className="knowledge-footnote">Customer audience: public visitor · Retrieval mode: {testMode === 'hybrid' ? 'lexical + configured semantic embeddings' : 'PostgreSQL lexical search'}{semanticUnavailableCode ? ` · semantic unavailable (${semanticUnavailableCode})` : ''}.</p>}{testDiagnostics && <div className="playground-diagnostics-list" aria-label="Knowledge retrieval diagnostics"><p>Sources passing public access checks {testEligibleSourceCount ?? 'unknown'} · effectively assigned {testDiagnostics.assignedSourceCount} · rejected before retrieval {testDiagnostics.rejectedSourceCount} · index ready {testDiagnostics.indexReadySourceCount} · active chunks {testDiagnostics.activeIndexChunkCount}.</p><p>Query variants {testDiagnostics.queryVariantCount} · lexical candidates {testDiagnostics.lexicalCandidateCount} · semantic candidates {testDiagnostics.semanticCandidateCount} · ranked {testDiagnostics.rankedCandidateCount} · selected {testDiagnostics.selectedEvidenceCount} · methods {testDiagnostics.methodsAttempted.join(', ') || 'none'}.</p><p>Measured: index readiness {testDiagnostics.indexReadinessDurationMs} ms · lexical {testDiagnostics.lexicalDurationMs} ms · semantic {testDiagnostics.semanticDurationMs} ms · ranking {testDiagnostics.rankingDurationMs} ms.</p>{testDiagnostics.sourceIndexStates.map((item) => <p key={item.sourceId}>Source {item.sourceId} · version {item.sourceVersion} · generation {item.activeGeneration ?? 'none'} · processing {item.processingStatus} · active chunks {item.activeChunkCount} · {item.ready ? 'index-ready' : 'not ready'}.</p>)}{testDiagnostics.retrievalReason && <p>Retrieval reason: <strong>{testDiagnostics.retrievalReason}</strong></p>}{testDiagnostics.rejectionReasons.map((item) => <p key={item.reason}>Blocked: {item.reason} · {item.count}</p>)}</div>}{testResults && (testResults.length ? <div className="kb-source-list">{testResults.map((hit) => <article className="kb-source-row" key={hit.chunkId}><div className="kb-source-main"><strong>{hit.sourceTitle}</strong><small>Source {hit.sourceId} · chunk {hit.chunkId} · generation {hit.generation ?? 'unknown'} · {hit.sourceType} · {hit.visibility.replaceAll('_', ' ').toLowerCase()} · version {hit.sourceVersion} · rank {hit.rankingPosition ?? '—'} · score {Number(hit.score).toFixed(4)} · {hit.method || 'retrieval'}</small><p>{hit.content}</p>{hit.pageUrl ? <a href={hit.pageUrl} target="_blank" rel="noreferrer">Page: {hit.pageTitle || hit.pageUrl}</a> : hit.locator && <small>Source: {hit.locator}</small>}</div></article>)}</div> : <div className="knowledge-empty"><h3>{testDiagnostics?.retrievalReason || 'NO_RELEVANT_MATCH'}</h3><p>No evidence was selected for this query. See the counts and rejection reasons above to distinguish access, index and lexical retrieval outcomes.</p></div>)}</section>}</>}
    {addDrawerOpen && <div className="kb-modal-backdrop" role="presentation"><section className="workspace-panel kb-add-drawer" role="dialog" aria-modal="true" aria-labelledby="kb-add-title" tabIndex={-1}><div className="knowledge-form-heading"><div><span className="eyebrow">SAVING TO {base.name.toUpperCase()}</span><h2 id="kb-add-title">{faqImportResult ? 'Import results' : createType === 'faq' ? 'Add Questions & Answers' : createType === 'text' ? 'Add Text Knowledge' : faqImportMode ? 'Import FAQs' : 'Add Knowledge'}</h2><p>One focused workflow for this Knowledge Base.</p></div><button type="button" className="button button-secondary" onClick={closeAddDrawer}><X size={14}/> Close</button></div>
      {(createType || faqImportMode) && !faqImportResult && <button className="assistant-back-link kb-drawer-back" type="button" onClick={() => { if (faqImportFile && !window.confirm('Discard the selected import file?')) return; setCreateType(null); setFaqImportMode(false); setFaqImportFile(null); setFaqPreview(null); }}><ArrowLeft size={14}/> Back</button>}
      {!createType && !faqImportMode && !faqImportResult && <div className="kb-add-options"><button onClick={() => { setCreateType('faq'); selectTab('faqs'); }}><CircleHelp/><span><strong>Add Question &amp; Answer</strong><small>Create one or several FAQs.</small></span></button><button onClick={() => setFaqImportMode(true)}><FileSpreadsheet/><span><strong>Import FAQs from Excel/CSV</strong><small>Preview and validate rows before saving.</small></span></button><button onClick={() => setCreateType('text')}><FileText/><span><strong>Add Text Knowledge</strong><small>Save business information.</small></span></button><button onClick={() => { setAddDrawerOpen(false); selectTab('all'); setAvailableOpen(true); setAvailableSelected([]); }}><Database/><span><strong>Add Existing Website or Source</strong><small>Reuse saved workspace sources without duplicating or re-crawling them.</small></span></button></div>}
      {createType === 'text' && <form className="kb-drawer-form" onSubmit={(event) => void createSource(event)}><label className="workspace-field">Title<input required minLength={2} maxLength={200} value={sourceName} disabled={isPending('source:create-text')} onChange={(event) => setSourceName(event.target.value)}/></label><label className="workspace-field">Content<textarea required rows={7} maxLength={50000} value={sourceBody} disabled={isPending('source:create-text')} onChange={(event) => setSourceBody(event.target.value)}/></label><label className="workspace-field">Language hint (optional)<input maxLength={35} placeholder="e.g. en, ar, ja, zh-Hant" value={sourceLanguageHint} disabled={isPending('source:create-text')} onChange={(event) => setSourceLanguageHint(event.target.value)}/><small>Helps cross-language search recognize the language of this source.</small></label><label className="workspace-field">Visibility<select value={sourceVisibility} disabled={isPending('source:create-text')} onChange={(event) => setSourceVisibility(event.target.value as typeof sourceVisibility)}><option value="INTERNAL_RESTRICTED">Internal restricted</option><option value="PUBLIC_REFERENCE">Public customer-safe reference</option></select></label><div className="assistant-form-actions"><button type="button" className="button button-secondary" onClick={closeAddDrawer}>Cancel</button><button className="button button-primary" disabled={isPending('source:create-text')}>{isPending('source:create-text') ? 'Saving…' : 'Save text source'}</button></div></form>}
      {createType === 'faq' && <form className="kb-drawer-form" onSubmit={(event) => void createFaqSet(event)}><fieldset className="kb-faq-draft-controls" disabled={isPending('source:create-faqs')}><div className="kb-faq-drafts">{faqDrafts.map((faq, index) => <fieldset className="kb-faq-draft" key={index}><legend>FAQ {index + 1}</legend><label className="workspace-field">Question<input required maxLength={200} value={faq.question} onChange={(event) => setFaqDrafts((rows) => rows.map((row, i) => i === index ? { ...row, question: event.target.value } : row))}/></label><label className="workspace-field">Answer<textarea required maxLength={20000} rows={4} value={faq.answer} onChange={(event) => setFaqDrafts((rows) => rows.map((row, i) => i === index ? { ...row, answer: event.target.value } : row))}/></label><div className="kb-faq-optional"><label className="workspace-field">Category<input maxLength={120} value={faq.category || ''} onChange={(event) => setFaqDrafts((rows) => rows.map((row, i) => i === index ? { ...row, category: event.target.value } : row))}/></label><label className="workspace-field">Language hint<input maxLength={35} placeholder="e.g. en, ar, ja, zh-Hant" value={faq.languageHint || ''} onChange={(event) => setFaqDrafts((rows) => rows.map((row, i) => i === index ? { ...row, languageHint: event.target.value } : row))}/></label></div><label className="workspace-field">Visibility<select value={faq.visibility || 'INTERNAL_RESTRICTED'} onChange={(event) => setFaqDrafts((rows) => rows.map((row, i) => i === index ? { ...row, visibility: event.target.value as FaqDraft['visibility'] } : row))}><option value="INTERNAL_RESTRICTED">Internal restricted</option><option value="PUBLIC_REFERENCE">Public customer-safe reference</option></select></label>{faqDrafts.length > 1 && <button type="button" className="button button-secondary" onClick={() => setFaqDrafts((rows) => rows.filter((_, i) => i !== index))}>Remove FAQ</button>}</fieldset>)}</div></fieldset><button type="button" className="button button-secondary" disabled={isPending('source:create-faqs')} onClick={() => setFaqDrafts((rows) => [...rows, { question: '', answer: '', visibility: 'INTERNAL_RESTRICTED' }])}>+ Add another question</button><div className="assistant-form-actions"><button type="button" className="button button-secondary" onClick={closeAddDrawer}>Cancel</button><button className="button button-primary" disabled={isPending('source:create-faqs')}>{isPending('source:create-faqs') ? 'Saving…' : `Save ${faqDrafts.length} FAQ${faqDrafts.length === 1 ? '' : 's'}`}</button></div></form>}
      {faqImportMode && !faqImportResult && <div className="kb-drawer-form"><p>Template headers: question, answer, category, language, visibility. Visibility defaults to internal restricted.</p><a className="button button-secondary" href={knowledgeBaseFaqTemplateUrl(workspace.slug, baseId)}><FileSpreadsheet size={14}/> Download CSV template</a><label className="workspace-field">Choose .xlsx or .csv<input type="file" disabled={isPending('source:import-faqs')} accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewFaqFile(file); }}/></label>{faqPreviewLoading && <div role="status">Validating file…</div>}{faqPreview && <><div className="kb-import-counts"><span>{faqPreview.total} rows</span><span>{faqPreview.valid} valid</span><span>{faqPreview.invalid} invalid</span><span>{faqPreview.duplicates} duplicates</span></div><div className="kb-import-table-wrap"><table className="kb-import-table"><thead><tr><th>Row</th><th>Question</th><th>Answer preview</th><th>Category</th><th>Validation</th></tr></thead><tbody>{faqPreview.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.question}</td><td>{row.answer.slice(0, 140)}{row.answer.length > 140 ? '…' : ''}</td><td>{row.category || '—'}</td><td>{row.errors.join(' ') || (row.duplicateInFile ? 'Duplicate in file' : row.duplicateExisting ? 'Already exists' : 'Valid')}</td></tr>)}</tbody></table></div><label className="workspace-field">Existing questions<select value={faqImportPolicy} disabled={isPending('source:import-faqs')} onChange={(event) => setFaqImportPolicy(event.target.value as typeof faqImportPolicy)}><option value="SKIP_EXISTING">Skip existing questions</option><option value="REJECT_DUPLICATES">Reject if existing questions are found</option></select></label><p className="knowledge-footnote">Confirming will save {faqPreview.rows.filter((row) => !row.errors.length && !row.duplicateInFile && !(faqImportPolicy === 'SKIP_EXISTING' && row.duplicateExisting)).length} rows. Invalid and duplicate-in-file rows are reported and excluded. Existing knowledge is never overwritten.</p><button className="button button-primary" disabled={isPending('source:import-faqs') || !faqPreview.valid || (faqImportPolicy === 'REJECT_DUPLICATES' && faqPreview.duplicates > 0)} onClick={() => void commitFaqImport()}>{isPending('source:import-faqs') ? 'Importing…' : 'Confirm FAQ import'}</button></>}</div>}
      {faqImportResult && <div className="kb-import-result" role="status"><strong>{faqImportResult.failed ? 'Import completed with row errors' : 'Import complete'}</strong><p>{faqImportResult.created} created · {faqImportResult.skipped} skipped · {faqImportResult.failed} failed · {faqImportResult.updated} updated</p><button className="button button-primary" onClick={() => { setAddDrawerOpen(false); setFaqImportResult(null); setFaqImportFile(null); setFaqPreview(null); selectTab('faqs'); }}>View FAQs</button></div>}
    </section></div>}
    {(['all', 'faqs', 'text'].includes(activeTab) || Boolean(activeKnowledgeSection)) && <section className="workspace-panel kb-detail-panel"><div className="workspace-panel-heading"><div><h2>{activeKnowledgeSection?.title || (activeTab === 'faqs' ? 'Questions & Answers' : activeTab === 'text' ? 'Text knowledge' : 'All Sources')}</h2><p>{activeKnowledgeSection?.description || 'Remove from this Knowledge Base to preserve the source in the workspace and other bases.'}</p></div>{activeKnowledgeSection && manager && base.status === 'active' && <button className="button button-primary" onClick={() => { setSourceSection(activeKnowledgeSection.id); setCreateType(null); setFaqImportMode(false); setAddDrawerOpen(true); }}><Plus size={14}/> Add knowledge</button>}</div>
      {availableOpen && <div className="kb-available-panel"><div className="kb-toolbar"><label className="kb-search"><Search size={14}/><input aria-label="Search available sources" placeholder="Search available sources" value={availableSearch} onChange={(event) => { setAvailableSearch(event.target.value); setAvailablePageNumber(1); }}/></label><span>{availablePage?.total ?? 0} available</span><button className="button button-secondary" disabled={availableSelectionLoading || !(availablePage?.total)} onClick={() => void selectAllFilteredAvailable()}>{availableSelectionLoading ? 'Selecting…' : 'Select all filtered'}</button></div>{availablePage && availablePage.sources.length > 0 ? <><label className="kb-select-all"><input type="checkbox" checked={availablePage.sources.length > 0 && availablePage.sources.every((item) => availableSelected.includes(item.id))} onChange={() => toggleCurrentPage(availablePage.sources, availableSelected, setAvailableSelected)}/> Select all on this page</label>{availablePage.sources.map((source) => <label className="kb-select-row" key={source.id}><input type="checkbox" checked={availableSelected.includes(source.id)} onChange={() => toggle(source.id, availableSelected, setAvailableSelected)}/><span><strong>{source.name}</strong><small>{source.type} · {source.visibility === 'PUBLIC_REFERENCE' ? 'PUBLIC_REFERENCE' : 'INTERNAL_RESTRICTED (not customer-searchable)'} · {source.processingStatus.replaceAll('_', ' ')} · {source.activeChunkCount ?? '—'} active chunks · {source.activeIndexSearchable === true ? 'indexed' : source.blockedReason || 'index details unavailable'}</small></span></label>)}</> : <p className="knowledge-footnote">No available sources match this search.</p>}<div className="kb-bulk-footer"><span>{availableSelected.length} selected</span><div><button className="button button-secondary" onClick={() => setAvailableSelected([])}>Clear</button><button className="button button-primary" disabled={isPending('sources:add') || availableSelected.length === 0} onClick={() => void addSelected()}>{isPending('sources:add') ? 'Adding…' : `Add ${availableSelected.length} sources`}</button></div></div>{availablePage && availablePage.total > pageSize && <div className="kb-pagination"><button className="button button-secondary" disabled={availablePageNumber <= 1} onClick={() => setAvailablePageNumber((n) => n - 1)}>Previous</button><span>Page {availablePageNumber} of {Math.ceil(availablePage.total / pageSize)}</span><button className="button button-secondary" disabled={availablePageNumber >= Math.ceil(availablePage.total / pageSize)} onClick={() => setAvailablePageNumber((n) => n + 1)}>Next</button></div>}</div>}
      <div className="kb-toolbar"><label className="kb-search"><Search size={14}/><input aria-label="Search sources in Knowledge Base" placeholder="Search sources" value={search} onChange={(event) => setSearch(event.target.value)}/></label>{activeTab === 'all' ? <label className="workspace-field kb-filter">Type<select value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option><option value="FAQ">FAQ</option><option value="TEXT">Text</option></select></label> : activeTab === 'faqs' ? <label className="workspace-field kb-filter">Category<input value={faqCategory} onChange={(event) => setFaqCategory(event.target.value)} placeholder="Search category"/></label> : null}<label className="workspace-field kb-filter">Status<select value={sourceStatus} onChange={(event) => setSourceStatus(event.target.value)}><option value="">All statuses</option><option value="REGISTERED">Registered</option><option value="DISABLED">Disabled</option><option value="ARCHIVED">Archived</option></select></label><label className="workspace-field kb-filter">Processing<select value={processing} onChange={(event) => setProcessing(event.target.value)}><option value="">All processing</option><option value="NOT_PROCESSED">Not processed</option><option value="QUEUED">Queued</option><option value="PROCESSING">Processing</option><option value="READY">Ready</option><option value="FAILED">Failed</option></select></label><label className="workspace-field kb-filter">Sort<select value={sourceSort} onChange={(event) => setSourceSort(event.target.value)}><option value="updatedAt">Updated</option><option value="createdAt">Created</option><option value="name">Name</option></select></label><button className="button button-secondary" onClick={() => setSourceDirection((current) => current === 'asc' ? 'desc' : 'asc')}>{sourceDirection === 'asc' ? 'Ascending' : 'Descending'}</button></div>
      {rows.length ? <><div className="kb-select-all"><label><input type="checkbox" checked={rows.length > 0 && rows.every((item) => selected.includes(item.id))} onChange={() => toggleCurrentPage(rows, selected, setSelected)}/> Select all on this page</label>{manager && base.status === 'active' && selected.length > 0 && <div className="kb-row-actions"><span>{selected.length} selected</span><button className="button button-secondary" disabled={selected.some((id) => isPending(`source:${id}`))} onClick={() => setSelected([])}>Clear</button><button className="button button-secondary" disabled={selected.some((id) => isPending(`source:${id}`))} onClick={() => void removeSelected()}>Remove from base</button><button className="button button-secondary" disabled={selected.some((id) => isPending(`source:${id}`))} onClick={() => void archiveSelected()}>Archive</button><button className="button button-secondary" disabled={selected.some((id) => isPending(`source:${id}`))} onClick={() => { setTransferOpen((open) => !open); setTransferBaseId(''); }}>Add to another base</button></div>}</div>{transferOpen && selected.length > 0 && <div className="kb-available-panel"><p>Selected sources will remain in {base.name} and be added to one other active Knowledge Base.</p><div className="kb-toolbar"><label className="kb-search"><Search size={14}/><input aria-label="Search destination bases" placeholder="Find a Knowledge Base" value={transferSearch} onChange={(event) => { setTransferSearch(event.target.value); }}/></label><label className="workspace-field kb-filter">Destination<select aria-label="Transfer destination" value={transferBaseId} onChange={(event) => setTransferBaseId(event.target.value)}><option value="">Choose a Knowledge Base</option>{transferBases.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label><button className="button button-primary" disabled={selected.some((id) => isPending(`source:${id}`)) || !transferBaseId} onClick={() => void transferSelected()}>{selected.some((id) => isPending(`source:${id}`)) ? 'Adding…' : `Add ${selected.length} sources`}</button></div></div>}<div className="kb-source-list">{rows.map((source) => <article className="kb-source-row" key={source.id}>{manager && base.status === 'active' && source.status !== 'archived' && <input aria-label={`Select ${source.name}`} type="checkbox" checked={selected.includes(source.id)} onChange={() => toggle(source.id, selected, setSelected)}/>}<span className="workspace-feature-icon">{source.type === 'faq' ? <BookOpen size={16}/> : <FileText size={16}/>}</span><div className="kb-source-main"><strong>{source.name}</strong><small>{knowledgeStatusLabel(source.processingStatus)} · {source.visibility === 'PUBLIC_REFERENCE' ? 'public reference' : 'internal restricted'} · {source.indexedPageCount ?? '—'} active page(s) · {source.activeChunkCount ?? '—'} active chunk(s) · {source.activeIndexSearchable === true ? 'INDEXED' : source.blockedReason || 'index details unavailable'} · {source.lastIndexedAt ? `Indexed ${dateLabel(source.lastIndexedAt)}` : source.lastSuccessfulSyncAt ? `Synced ${dateLabel(source.lastSuccessfulSyncAt)}` : 'Not indexed yet'} · Updated {dateLabel(source.updatedAt)}</small><details><summary>View source details</summary><p>{source.contentBody || source.description || 'No text content is stored for this source.'}</p></details></div>{manager && base.status === 'active' && source.status !== 'archived' && <div className="kb-row-actions">{(source.processingStatus === 'ready' || source.processingStatus === 'failed') && <details className="kb-advanced-source-actions"><summary>More</summary><button className="button button-secondary" disabled={isPending(`source:${source.id}`)} onClick={() => void reindexSource(source)}>{source.processingStatus === 'failed' ? 'Retry indexing' : 'Reindex'}</button></details>}<button className="button button-secondary" aria-label={`Edit ${source.name}`} disabled={isPending(`source:${source.id}`)} onClick={() => { setEdit(source); setEditName(source.name); setEditBody(source.contentBody || ''); setEditVisibility(source.visibility || 'INTERNAL_RESTRICTED'); setEditCategory(source.category || ''); setEditLanguage(source.languageHint || ''); }}>Edit</button><button className="button button-secondary" aria-label={`Archive ${source.name}`} disabled={isPending(`source:${source.id}`)} onClick={() => void archiveSource(source)}>{isPending(`source:${source.id}`) ? 'Archiving…' : 'Archive'}</button>{workspace.role === 'owner' && <button className="button button-secondary" aria-label={`Permanently delete ${source.name}`} disabled={isPending(`source:${source.id}`)} onClick={() => void deleteSource(source)}>{isPending(`source:${source.id}`) ? 'Deleting…' : 'Delete'}</button>}</div>}{manager && source.status === 'archived' && <div className="kb-row-actions"><button className="button button-secondary" disabled={isPending(`source:${source.id}`)} onClick={() => void restoreSource(source)}>{isPending(`source:${source.id}`) ? 'Restoring…' : 'Restore'}</button>{workspace.role === 'owner' && <button className="button button-secondary" disabled={isPending(`source:${source.id}`)} onClick={() => void deleteSource(source)}>{isPending(`source:${source.id}`) ? 'Deleting…' : 'Permanently Delete'}</button>}</div>}</article>)}</div></> : <div className="knowledge-empty"><FileText size={22}/><h3>{search || type || processing || sourceStatus ? 'No matching sources' : 'This Knowledge Base is empty'}</h3><p>Add a question and answer or longer text. Knowledge becomes searchable after indexing finishes.</p>{manager && base.status === 'active' && <button className="button button-primary" onClick={() => { selectTab('all'); setAvailableOpen(true); }}><Plus size={14}/> Add Existing Sources</button>}</div>}
      {(sourcePage?.total ?? 0) > pageSize && <div className="kb-pagination"><span>Page {page} of {Math.ceil((sourcePage?.total ?? 0) / pageSize)} · {sourcePage?.total} sources</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}><ChevronLeft size={14}/> Previous</button><button className="button button-secondary" disabled={page >= Math.ceil((sourcePage?.total ?? 0) / pageSize)} onClick={() => setPage((n) => n + 1)}>Next <ChevronRight size={14}/></button></div></div>}
    </section>}
    {activeTab === SHOPIFY_CATALOG_TAB && <BusinessDataVisibility slug={workspace.slug} manager={manager} initialTab="shopify" compact/>}
    {activeTab === 'assistants' && connectedAssistantsPanel}
    {edit && <div className="kb-modal-backdrop" role="presentation"><form className="workspace-panel kb-modal" role="dialog" aria-modal="true" aria-labelledby="kb-edit-source-title" tabIndex={-1} onSubmit={(event) => void saveSourceEdit(event)}><div className="knowledge-form-heading"><div><h2 id="kb-edit-source-title">Edit source</h2><p>Changes reset the source to not processed.</p></div><button type="button" className="button button-secondary" onClick={() => setEdit(null)}><X size={14}/> Close</button></div>{error && <p className="workspace-form-error" role="alert">{error}</p>}<label className="workspace-field">{edit.type === 'faq' ? 'Question' : 'Title'}<input required value={editName} disabled={isPending(`source:${edit.id}`)} onChange={(event) => setEditName(event.target.value)}/></label><label className="workspace-field">{edit.type === 'faq' ? 'Answer' : 'Content'}<textarea rows={5} value={editBody} disabled={isPending(`source:${edit.id}`)} onChange={(event) => setEditBody(event.target.value)}/></label>{edit.type === 'faq' && <label className="workspace-field">Category<input maxLength={120} value={editCategory} onChange={(event) => setEditCategory(event.target.value)}/></label>}<label className="workspace-field">Language hint (optional)<input maxLength={35} placeholder="e.g. en, ar, ja, zh-Hant" value={editLanguage} onChange={(event) => setEditLanguage(event.target.value)}/><small>Helps cross-language search recognize the language of this source.</small></label><label className="workspace-field">Source visibility<select value={editVisibility} onChange={(event) => setEditVisibility(event.target.value as typeof editVisibility)}><option value="INTERNAL_RESTRICTED">Internal restricted</option><option value="PUBLIC_REFERENCE">Public customer-safe reference</option></select></label><div className="assistant-form-actions"><button type="button" className="button button-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="button button-primary" disabled={isPending(`source:${edit.id}`)}>{isPending(`source:${edit.id}`) ? 'Saving…' : <><Save size={14}/> Save changes</>}</button></div></form></div>}
  </>;
}
