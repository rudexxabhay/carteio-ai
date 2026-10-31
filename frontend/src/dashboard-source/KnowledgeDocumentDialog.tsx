import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle, Upload, X } from 'lucide-react';
import { ApiError, getApiSessionGeneration } from '../services/api/client';
import { createKnowledgeBase, listKnowledgeBases } from '../services/api/knowledge-bases';
import { archiveKnowledge, getDocumentCapabilities, getKnowledgeDeleteImpact, getKnowledgeProcessing, getKnowledgeSource, permanentlyDeleteKnowledge, reindexKnowledge, uploadKnowledgePdf, type KnowledgeSection, type KnowledgeSource, type ProcessingDetails } from '../services/api/knowledge';

type Base = { id: string; name: string; status: string };
type BaseLoadState = 'LOADING' | 'LOADED_WITH_BASES' | 'LOADED_EMPTY' | 'ERROR';
const BASE_CACHE_TTL_MS = 30_000;
const knowledgeBaseCache = new Map<string, { bases: Base[]; loadedAt: number; selectedId?: string; request?: Promise<Base[]> }>();
const baseCacheKey = (slug: string) => `${getApiSessionGeneration()}:${slug}`;
function rememberBaseSelection(slug: string, selectedId: string) {
  const key = baseCacheKey(slug);
  const cached = knowledgeBaseCache.get(key);
  if (cached) knowledgeBaseCache.set(key, { ...cached, selectedId });
}
function requestKnowledgeBases(slug: string): Promise<Base[]> {
  const key = baseCacheKey(slug);
  const cached = knowledgeBaseCache.get(key);
  if (cached && Date.now() - cached.loadedAt < BASE_CACHE_TTL_MS) return Promise.resolve(cached.bases);
  if (cached?.request) return cached.request;
  const request = listKnowledgeBases(slug, { page: 1, pageSize: 100, status: 'ACTIVE' }).then(value => {
    const bases = value.knowledgeBases.map(item => ({ id: item.id, name: item.name, status: item.status }));
    knowledgeBaseCache.set(key, { bases, loadedAt: Date.now(), ...(cached?.selectedId ? { selectedId: cached.selectedId } : {}) });
    return bases;
  }).catch(error => {
    const current = knowledgeBaseCache.get(key);
    if (current) delete current.request;
    throw error;
  });
  knowledgeBaseCache.set(key, { bases: cached?.bases ?? [], loadedAt: cached?.loadedAt ?? 0, ...(cached?.selectedId ? { selectedId: cached.selectedId } : {}), request });
  return request;
}
type Props = { slug: string; section: KnowledgeSection; role: string; sourceId?: string; onClose: () => void; onSaved: (sourceId: string) => void; onDeleted: () => void };
const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'The document request could not be completed. Try again.';
const processingLabel = (source: KnowledgeSource | null, progress?: ProcessingDetails) => {
  if (!source) return 'Loading document status…';
  if (progress?.jobs[0]?.status === 'QUEUED' || progress?.jobs[0]?.status === 'RETRY_WAIT') return 'Saved · queued for indexing';
  if (progress?.jobs[0]?.stage === 'INDEXING') return source.processingStatus === 'ready' ? 'Ready · reindexing saved text' : 'Indexing saved text';
  if (source.processingStatus === 'ready') return 'Ready for AI';
  if (source.processingStatus === 'failed') return `Failed${source.processingErrorCode ? ` · ${source.processingErrorCode}` : ''}`;
  const stage = progress?.documentProgress?.stage;
  if (stage === 'QUEUED' || source.processingStatus === 'queued') return 'Extracted and saved · queued for indexing';
  if (stage === 'INDEXING' || source.processingStatus === 'processing') return 'Indexing saved text';
  return 'Saved · waiting for indexing';
};

export function KnowledgeDocumentDialog({ slug, section, role, sourceId, onClose, onSaved, onDeleted }: Props) {
  const sessionGeneration = getApiSessionGeneration();
  const manager = ['owner', 'admin'].includes(role.toLowerCase());
  const owner = role.toLowerCase() === 'owner';
  const [activeSourceId, setActiveSourceId] = useState(sourceId ?? '');
  const [source, setSource] = useState<KnowledgeSource | null>(null);
  const [processing, setProcessing] = useState<ProcessingDetails | null>(null);
  const initialBaseCache = knowledgeBaseCache.get(baseCacheKey(slug));
  const initialBaseCacheFresh = Boolean(initialBaseCache && Date.now() - initialBaseCache.loadedAt < BASE_CACHE_TTL_MS);
  const [bases, setBases] = useState<Base[]>(initialBaseCacheFresh ? initialBaseCache!.bases : []);
  const [baseId, setBaseId] = useState(() => initialBaseCacheFresh && initialBaseCache!.selectedId && initialBaseCache!.bases.some(item => item.id === initialBaseCache!.selectedId) ? initialBaseCache!.selectedId! : initialBaseCacheFresh && initialBaseCache!.bases.length === 1 ? initialBaseCache!.bases[0]!.id : '');
  const [baseLoadState, setBaseLoadState] = useState<BaseLoadState>(() => initialBaseCacheFresh ? (initialBaseCache!.bases.length ? 'LOADED_WITH_BASES' : 'LOADED_EMPTY') : 'LOADING');
  const [baseLoadError, setBaseLoadError] = useState('');
  const [baseRetry, setBaseRetry] = useState(0);
  const [showCreateBase, setShowCreateBase] = useState(false);
  const baseSelectionTouched = useRef(false);
  const baseScopeKey = useRef(`${sessionGeneration}:${slug}`);
  const [capabilities, setCapabilities] = useState<{ uploadAvailable: boolean; maxBytes: number; maxPages: number; workerEnabled: boolean; blockedReason: string | null } | null>(null);
  const [capabilityCheckError, setCapabilityCheckError] = useState('');
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE'>('INTERNAL_RESTRICTED');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(sourceId));
  const [error, setError] = useState('');
  const [uploadFailed, setUploadFailed] = useState(false);
  const [pageLimit, setPageLimit] = useState(10);
  const [refresh, setRefresh] = useState(0);
  const [newBaseName, setNewBaseName] = useState('Business Knowledge');
  const [baseBusy, setBaseBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getDocumentCapabilities(slug, controller.signal).then(value => { if (!controller.signal.aborted) { setCapabilities(value); setCapabilityCheckError(''); } })
      .catch(reason => { if (!controller.signal.aborted) { setCapabilities({ uploadAvailable: false, maxBytes: 0, maxPages: 0, workerEnabled: false, blockedReason: reason instanceof ApiError && reason.code ? reason.code : 'CAPABILITY_CHECK_FAILED' }); setCapabilityCheckError(errorMessage(reason)); } });
    return () => controller.abort();
  }, [slug, capabilityRetry]);

  useEffect(() => {
    const controller = new AbortController();
    const nextScopeKey = `${getApiSessionGeneration()}:${slug}`;
    if (baseScopeKey.current !== nextScopeKey) {
      baseScopeKey.current = nextScopeKey;
      baseSelectionTouched.current = false;
      setShowCreateBase(false);
    }
    const cached = knowledgeBaseCache.get(baseCacheKey(slug));
    if (cached && Date.now() - cached.loadedAt < BASE_CACHE_TTL_MS) {
      setBases(cached.bases);
      setBaseLoadState(cached.bases.length ? 'LOADED_WITH_BASES' : 'LOADED_EMPTY');
      setBaseId(current => current && cached.bases.some(item => item.id === current) ? current : baseSelectionTouched.current ? current : cached.selectedId && cached.bases.some(item => item.id === cached.selectedId) ? cached.selectedId : cached.bases.length === 1 ? cached.bases[0]!.id : '');
    } else {
      if (cached?.bases.length) {
        setBases(cached.bases);
        setBaseId(current => current && cached.bases.some(item => item.id === current) ? current : baseSelectionTouched.current ? current : cached.selectedId && cached.bases.some(item => item.id === cached.selectedId) ? cached.selectedId : cached.bases.length === 1 ? cached.bases[0]!.id : '');
      } else { setBases([]); setBaseId(''); }
      setBaseLoadState(cached?.bases.length ? 'LOADED_WITH_BASES' : 'LOADING');
      requestKnowledgeBases(slug).then(rows => {
        if (controller.signal.aborted) return;
        setBases(rows);
        setBaseLoadState(rows.length ? 'LOADED_WITH_BASES' : 'LOADED_EMPTY');
        setBaseLoadError('');
        setBaseId(current => current && rows.some(item => item.id === current) ? current : baseSelectionTouched.current ? (rows.some(item => item.id === current) ? current : '') : cached?.selectedId && rows.some(item => item.id === cached.selectedId) ? cached.selectedId : rows.length === 1 ? rows[0]!.id : '');
      }).catch(reason => {
        if (!controller.signal.aborted) {
          setBaseLoadState('ERROR');
          setBaseLoadError(errorMessage(reason));
        }
      });
    }
    return () => controller.abort();
  }, [slug, baseRetry, sessionGeneration]);

  useEffect(() => {
    if (!activeSourceId) { setSource(null); setProcessing(null); setLoading(false); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    setLoading(true); setError('');
    const load = async () => {
      try {
        const [record, state] = await Promise.all([getKnowledgeSource(slug, activeSourceId, controller.signal), getKnowledgeProcessing(slug, activeSourceId, controller.signal)]);
        if (controller.signal.aborted) return;
        setSource(record); setProcessing(state); setTitle(record.name);
        setVisibility(record.visibility ?? 'INTERNAL_RESTRICTED');
        const linkedBase = record.knowledgeBaseMemberships?.find(item => item.status.toLowerCase() === 'active')?.id;
        if (linkedBase) { setBaseId(linkedBase); rememberBaseSelection(slug, linkedBase); }
        const activeJob = ['QUEUED', 'PROCESSING', 'RETRY_WAIT'].includes(state.jobs[0]?.status ?? '');
        const complete = (!activeJob && ['ready', 'failed', 'archived'].includes(record.processingStatus)) || record.status === 'archived';
        if (!complete && polls++ < 120) timer = setTimeout(() => void load(), 2500);
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [slug, activeSourceId, refresh]);

  const pages = source?.document?.pages ?? [];
  const accessSummary = useMemo(() => source?.knowledgeBaseMemberships?.map(item => item.name).join(', ') || 'No active Knowledge Base assignment reported', [source]);
  const assistantAccessSummary = useMemo(() => {
    const assistants = source?.knowledgeBaseMemberships?.flatMap(item => item.assistantAssignments ?? []) ?? [];
    return assistants.length ? [...new Set(assistants.map(item => item.name))].join(', ') : 'Not assigned through an active Knowledge Base';
  }, [source]);
  const provenanceVerified = source?.document?.provenance === 'AUTHENTICATED_PDF_EXTRACTION_V1';
  const lexicalStatus = !provenanceVerified ? 'Unavailable · verification required' : source?.processingStatus === 'ready' && source.activeIndexGeneration != null && (processing?.chunkCount ?? 0) > 0 ? 'Ready' : source?.processingStatus === 'failed' ? 'Failed' : source?.processingStatus === 'processing' || source?.processingStatus === 'queued' ? 'Processing' : 'Not published';
  const semanticVectorCount = processing?.semanticVectorCount ?? 0;
  const semanticProfileIsValid = Boolean(processing && ((processing.semanticEmbeddingProvider === 'openrouter' && processing.semanticEmbeddingModel === 'openai/text-embedding-3-small') || (processing.semanticEmbeddingProvider === 'openai' && processing.semanticEmbeddingModel === 'text-embedding-3-small')) && processing.semanticEmbeddingDimensions === 1536);
  const semanticEmbeddingProfile = processing?.semanticEmbeddingProvider && processing.semanticEmbeddingModel
    ? `${processing.semanticEmbeddingProvider}/${processing.semanticEmbeddingModel} · ${processing.semanticEmbeddingDimensions ?? 'dimensions not reported'}`
    : 'Not recorded';
  const semanticIndexStatus = processing?.semanticIndexStatus ?? source?.semanticIndexStatus;
  const semanticIndexErrorCode = processing?.semanticIndexErrorCode ?? source?.semanticIndexErrorCode;
  const semanticStatus = !provenanceVerified ? 'Unavailable · verification required'
    : semanticIndexStatus === 'READY' && semanticVectorCount > 0 && semanticProfileIsValid
      ? `Ready · ${semanticVectorCount} vectors · ${semanticEmbeddingProfile}`
      : semanticIndexStatus === 'READY' ? 'Status inconsistent · vector metadata unavailable'
        : semanticIndexStatus === 'FAILED' ? `Failed${semanticIndexErrorCode ? ` · ${semanticIndexErrorCode}` : ''}`
          : semanticIndexStatus === 'NOT_CONFIGURED' ? `Not configured${semanticIndexErrorCode ? ` · ${semanticIndexErrorCode}` : ''}`
            : semanticIndexStatus === 'PENDING' ? 'Pending · verified PDF is ready for semantic reindexing'
              : semanticIndexStatus?.replaceAll('_', ' ') ?? 'Not reported';
  const fileTooLarge = Boolean(file && capabilities && file.size > capabilities.maxBytes);

  async function createBase() {
    if (!newBaseName.trim() || baseBusy) return;
    setBaseBusy(true); setError('');
    try {
      const created = await createKnowledgeBase(slug, { name: newBaseName.trim(), description: 'PDF business knowledge documents.' });
      const row = { id: created.id, name: created.name, status: created.status };
      const updatedBases = [...bases, row];
      knowledgeBaseCache.set(baseCacheKey(slug), { bases: updatedBases, loadedAt: Date.now(), selectedId: created.id });
      setBases(updatedBases); setBaseId(created.id); baseSelectionTouched.current = true;
      setBaseLoadState('LOADED_WITH_BASES'); setShowCreateBase(false);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBaseBusy(false); }
  }

  async function submitUpload() {
    if (!file || !baseId || !manager || !capabilities?.uploadAvailable || fileTooLarge || busy) return;
    setBusy(true); setError(''); setUploadFailed(false);
    try {
      const result = await uploadKnowledgePdf(slug, file, { knowledgeBaseId: baseId, knowledgeSection: section, visibility, ...(title.trim() ? { title: title.trim() } : {}) }, activeSourceId || undefined);
        setFile(null); setPageLimit(10); setActiveSourceId(result.id); setRefresh(value => value + 1); onSaved(result.id);
    } catch (reason) { setUploadFailed(true); setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function reprocess() {
    if (!activeSourceId || busy || !manager) return;
    setBusy(true); setError('');
    try { await reindexKnowledge(slug, activeSourceId); setRefresh(value => value + 1); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function removeDocument() {
    if (!activeSourceId || busy || !manager || !window.confirm(owner ? 'Permanently delete this document and revoke its indexed knowledge?' : 'Archive this document and revoke its indexed knowledge?')) return;
    setBusy(true); setError('');
    try {
      if (owner) {
        const result = await getKnowledgeDeleteImpact(slug, activeSourceId);
        if (result.impact.chunks && !window.confirm(`This will remove ${result.impact.chunks} indexed chunks. Continue?`)) return;
        await permanentlyDeleteKnowledge(slug, activeSourceId);
      } else await archiveKnowledge(slug, activeSourceId);
      onDeleted();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  return <div className="knowledge-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="knowledge-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-dialog-title">
      <header className="knowledge-dialog-header"><div><p className="knowledge-eyebrow">{activeSourceId ? 'DOCUMENT DETAILS' : 'PDF KNOWLEDGE'}</p><h2 id="knowledge-dialog-title">{activeSourceId ? source?.name ?? 'Document details' : 'Upload PDF'}</h2>{!activeSourceId && <p className="knowledge-dialog-subtitle">Add verified business information to your Knowledge Base.</p>}</div><button type="button" aria-label="Close document dialog" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      {error && <p className="knowledge-error" role="alert"><AlertCircle size={16}/>{error}</p>}
      {!activeSourceId && <div className="knowledge-upload-form">
        {!manager && <p className="knowledge-error" role="alert">Owner or admin access is required to upload Knowledge documents.</p>}
        <p className="knowledge-section-label">Section · {section.replaceAll('_', ' ')}</p>
        <label className="knowledge-dialog-field">Knowledge Base<select aria-label="Knowledge Base" value={baseId} onChange={event => { baseSelectionTouched.current = true; setBaseId(event.target.value); rememberBaseSelection(slug, event.target.value); }} disabled={busy || !manager || baseLoadState === 'LOADING' || baseLoadState === 'ERROR' || baseLoadState === 'LOADED_EMPTY'}><option value="">{baseLoadState === 'LOADING' ? 'Loading Knowledge Bases…' : baseLoadState === 'LOADED_EMPTY' ? 'No Knowledge Base yet' : 'Choose a Knowledge Base'}</option>{bases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="knowledge-base-state">
          {baseLoadState === 'LOADING' && <p className="knowledge-upload-note" role="status">Loading your Knowledge Bases…</p>}
          {baseLoadState === 'ERROR' && <p className="knowledge-error" role="alert">Could not load Knowledge Bases. {baseLoadError} <button type="button" className="knowledge-inline-action" onClick={() => { setBaseLoadState('LOADING'); setBaseLoadError(''); setBaseRetry(value => value + 1); }}>Retry</button></p>}
          {baseLoadState === 'LOADED_EMPTY' && manager && !showCreateBase && <button type="button" className="knowledge-secondary-action" onClick={() => setShowCreateBase(true)}>Create a Knowledge Base</button>}
          {baseLoadState === 'LOADED_EMPTY' && showCreateBase && <div className="knowledge-create-base"><label className="knowledge-dialog-field">Knowledge Base name<input value={newBaseName} onChange={event => setNewBaseName(event.target.value)} maxLength={200}/></label><button type="button" className="knowledge-secondary-action" disabled={baseBusy || !newBaseName.trim()} onClick={() => void createBase()}>{baseBusy ? 'Creating…' : 'Create Knowledge Base'}</button></div>}
        </div>
        <label className="knowledge-dialog-field">Document title<input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Uses the filename if left blank" disabled={busy}/></label>
        <label className="knowledge-dialog-field">Customer access<select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} disabled={busy}><option value="INTERNAL_RESTRICTED">Restricted — internal only</option><option value="PUBLIC_REFERENCE">Customer-facing reference</option></select><small>Restricted is the safe default. Customer-facing answers also require approved visibility and saved assistant Knowledge access.</small></label>
        <label className="knowledge-file-picker"><Upload size={20}/><strong>{file?.name ?? 'Choose a PDF file'}</strong><span>{file ? `${(file.size / 1024).toFixed(1)} KiB` : `Text based PDFs · up to ${((capabilities?.maxBytes ?? 0) / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB · ${capabilities?.maxPages ?? '…'} pages`}</span><input aria-label="PDF file" type="file" accept="application/pdf,.pdf" disabled={busy || !manager || !capabilities?.uploadAvailable} onChange={event => { setFile(event.target.files?.[0] ?? null); setUploadFailed(false); setError(''); }}/></label>
        {fileTooLarge && <p className="knowledge-error" role="alert">This file exceeds the configured upload limit. Choose a smaller PDF.</p>}
        {uploadFailed && <p className="knowledge-error" role="status">Upload failed. The PDF was not saved; correct the issue and upload again.</p>}
        {!capabilities && <p className="knowledge-upload-note" role="status">Checking PDF processing availability…</p>}
        {capabilities && !capabilities.uploadAvailable && <div className="knowledge-upload-note" role="status">{capabilityCheckError ? 'Could not check PDF processing availability. Check your connection and retry.' : capabilities.blockedReason === 'DOCUMENTS_DISABLED' ? 'PDF uploads are paused by server configuration. Ask your administrator to enable Knowledge documents.' : capabilities.blockedReason === 'PDF_PARSER_NOT_INSTALLED' ? 'PDF extraction is unavailable on this server. Contact your administrator.' : 'PDF upload is unavailable. Contact your administrator.'}{capabilityCheckError && <button type="button" className="knowledge-inline-action" onClick={() => setCapabilityRetry(value => value + 1)}>Retry</button>}{manager && capabilities.blockedReason && <details><summary>Technical details</summary><code>{capabilities.blockedReason}{capabilityCheckError ? ` · ${capabilityCheckError}` : ''}</code></details>}</div>}
        {capabilities?.uploadAvailable && !capabilities.workerEnabled && <p className="knowledge-upload-note">Extraction is available, but indexing waits for the Knowledge worker to run.</p>}
        <div className="knowledge-dialog-actions"><button type="button" disabled={busy || !file || !baseId || !manager || !capabilities?.uploadAvailable || fileTooLarge || baseLoadState !== 'LOADED_WITH_BASES'} onClick={() => void submitUpload()}>{busy ? <><LoaderCircle size={16}/> Uploading & processing…</> : 'Upload & Process'}</button><span>English text is extracted and saved before indexing. Original PDF bytes are discarded after this request.</span></div>
        {busy && <p className="knowledge-processing-message" role="status">Uploading and extracting the document. No page percentage is available during this request.</p>}
      </div>}
      {activeSourceId && <>
        {loading && <p className="knowledge-processing-message" role="status"><LoaderCircle size={16}/> Loading saved document details…</p>}
        {source && <div className="knowledge-document-details">
          <div className="knowledge-document-facts"><div><span>Status</span><strong>{processingLabel(source, processing ?? undefined)}</strong></div><div><span>Section</span><strong>{source.knowledgeSection?.replaceAll('_', ' ') ?? 'Unassigned'}</strong></div><div><span>PDF provenance</span><strong>{provenanceVerified ? 'Verified authenticated PDF extraction' : 'Original PDF verification required'}</strong></div><div><span>Lexical indexing</span><strong>{lexicalStatus}</strong></div><div><span>Semantic indexing</span><strong>{semanticStatus}</strong></div><div><span>Persisted semantic vectors</span><strong>{processing?.semanticVectorCount ?? 'Not reported'}</strong></div><div><span>Embedding profile</span><strong>{semanticEmbeddingProfile}</strong></div><div><span>Source version / published generation</span><strong>{source.sourceVersion} / {processing?.activeIndexGeneration ?? source.activeIndexGeneration ?? 'None'}</strong></div><div><span>Language</span><strong>{source.document?.sourceLanguage?.toUpperCase() ?? 'English'}</strong></div><div><span>Pages extracted / saved</span><strong>{processing?.documentProgress?.pagesExtracted ?? source.document?.pageCount ?? pages.length} / {processing?.documentProgress?.pagesPersisted ?? source.document?.pageCount ?? pages.length}</strong></div><div><span>Words</span><strong>{(source.document?.wordCount ?? 0).toLocaleString()}</strong></div><div><span>Indexed chunks in last published generation</span><strong>{processing?.documentProgress?.chunksIndexed ?? processing?.chunkCount ?? 0}</strong></div><div><span>Customer visible</span><strong>{source.visibility === 'PUBLIC_REFERENCE' ? 'Yes' : 'No'}</strong></div><div><span>Knowledge Base access</span><strong>{accessSummary}</strong></div><div><span>Assistant access</span><strong>{assistantAccessSummary}</strong></div><div><span>Last indexed</span><strong>{processing?.lastIndexedAt ? new Date(processing.lastIndexedAt).toLocaleString() : 'Not recorded'}</strong></div><div><span>Last updated</span><strong>{new Date(source.updatedAt).toLocaleString()}</strong></div></div>
          {source.document?.provenance !== 'AUTHENTICATED_PDF_EXTRACTION_V1' && <p className="knowledge-processing-message" role="status">Original PDF verification required. This stored document is unavailable to customer AI until you replace it with the original PDF and indexing publishes a new generation.</p>}
          {processing?.documentProgress?.stage === 'INDEXING' && <p className="knowledge-processing-message" role="status"><LoaderCircle size={16}/> Indexing persisted text. {processing.documentProgress.chunksIndexed} chunks remain in the last published generation until this index is ready.</p>}
          {busy && <p className="knowledge-processing-message" role="status"><LoaderCircle size={16}/> Uploading, extracting and saving the PDF. Progress is indeterminate during this request.</p>}
          {source.processingStatus === 'failed' && <p className="knowledge-error" role="alert">{source.processingErrorCode ?? processing?.documentProgress?.failureReason ?? 'Indexing failed.'} Reprocess the saved text or replace the PDF.</p>}
          <div className="knowledge-page-list"><h3>Extracted pages</h3>{pages.slice(0, pageLimit).map(page => <details key={page.page}><summary><strong>Page {page.page}</strong>{page.heading && <span>{page.heading}</span>}<small>{(page.wordCount ?? 0).toLocaleString()} words</small></summary><pre>{source.contentBody?.slice(page.start, page.end) ?? 'Page text is unavailable.'}</pre></details>)}{pages.length > pageLimit && <button type="button" className="knowledge-secondary-action" onClick={() => setPageLimit(value => Math.min(value + 10, pages.length))}>Show next pages</button>}</div>
          {manager && <div className="knowledge-dialog-actions knowledge-document-actions"><label className="knowledge-secondary-action knowledge-replace-action">Replace PDF<input type="file" accept="application/pdf,.pdf" disabled={busy || !capabilities?.uploadAvailable} onChange={event => { setFile(event.target.files?.[0] ?? null); setTitle(source.name); }}/></label>{file && <><span>{file.name} · {(file.size / 1024).toFixed(1)} KiB</span><button type="button" disabled={busy || !baseId || !capabilities?.uploadAvailable || fileTooLarge} onClick={() => void submitUpload()}>{busy ? 'Uploading and extracting…' : 'Confirm replacement'}</button></>}<button type="button" className="knowledge-secondary-action" disabled={busy || !source.document?.extracted} onClick={() => void reprocess()}>Reprocess saved text</button><button type="button" className="knowledge-danger-action" disabled={busy} onClick={() => void removeDocument()}>{owner ? 'Delete permanently' : 'Archive document'}</button></div>}
        </div>}
      </>}
    </section>
  </div>;
}
