import { useEffect, useState } from 'react';
import { archiveKnowledge, getDocumentCapabilities, getKnowledgeSource, getKnowledgeProcessing, reindexKnowledge, uploadKnowledgePdf, updateKnowledge, type KnowledgeSection, type KnowledgeSource, type ProcessingDetails } from '../services/api/knowledge';
import { createKnowledgeBase, type KnowledgeBase } from '../services/api/knowledge-bases';
import { ApiError } from '../services/api/client';
import { Btn, Notice } from './ui';

export function KnowledgePdfPanel({ slug, section, bases, baseId, setBaseId, manager, sourceId, closeSource, onChange, openSource }: {
  slug: string; section: KnowledgeSection; bases: KnowledgeBase[]; baseId: string; setBaseId: (id: string) => void; manager: boolean;
  sourceId: string | null; closeSource: () => void; onChange: () => void; openSource: (id: string) => void;
}) {
  const [capability, setCapability] = useState<Awaited<ReturnType<typeof getDocumentCapabilities>> | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE'>('INTERNAL_RESTRICTED');
  const [source, setSource] = useState<KnowledgeSource | null>(null);
  const [processing, setProcessing] = useState<ProcessingDetails | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [baseName, setBaseName] = useState('');
  const [title, setTitle] = useState('');
  async function rename() {
    if (!sourceId || !title.trim() || busy) return;
    setBusy(true); setError('');
    try { await updateKnowledge(slug, sourceId, { name: title.trim() }); onChange(); setRevision(value => value + 1); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Title could not be saved.'); }
    finally { setBusy(false); }
  }
  async function createBase() {
    if (!baseName.trim() || busy) return;
    setBusy(true); setError('');
    try { const base = await createKnowledgeBase(slug, { name: baseName.trim() }); setBaseId(base.id); setBaseName(''); onChange(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Knowledge Base creation failed.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    getDocumentCapabilities(slug, controller.signal).then(setCapability).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : 'PDF availability could not be checked.'); });
    return () => controller.abort();
  }, [slug]);
  useEffect(() => {
    setSource(null); setProcessing(null); setFile(null); setReplace(false);
    if (!sourceId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let attempts = 0;
    async function load() {
      try {
        const [record, status] = await Promise.all([getKnowledgeSource(slug, sourceId!, controller.signal), getKnowledgeProcessing(slug, sourceId!, controller.signal)]);
        if (controller.signal.aborted) return;
        setSource(record); setTitle(record.name); setProcessing(status);
        if (['queued', 'processing'].includes(record.processingStatus) && ++attempts < 40) timer = setTimeout(() => void load(), 3000);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : 'Document details unavailable.'); }
    }
    void load(); return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [slug, sourceId, revision]);
  async function upload() {
    if (!file || !baseId || !capability?.uploadAvailable || busy) return;
    setBusy(true); setError('');
    try {
      const result = await uploadKnowledgePdf(slug, file, { knowledgeBaseId: baseId, knowledgeSection: section, visibility }, replace ? sourceId ?? undefined : undefined);
      setUploadOpen(false); setFile(null); setReplace(false); onChange(); openSource(result.id); setRevision(value => value + 1);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'PDF upload failed.'); }
    finally { setBusy(false); }
  }
  async function action(kind: 'reindex' | 'archive') {
    if (!sourceId || busy || !manager) return;
    if (kind === 'archive' && !window.confirm('Archive this source? It will no longer be available for retrieval.')) return;
    setBusy(true); setError('');
    try { if (kind === 'archive') { await archiveKnowledge(slug, sourceId); closeSource(); } else await reindexKnowledge(slug, sourceId); onChange(); setRevision(value => value + 1); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Source operation failed.'); }
    finally { setBusy(false); }
  }
  return <>
    {manager && <div className="action-line"><Btn disabled={!capability?.uploadAvailable} onClick={() => { setUploadOpen(true); setReplace(false); setFile(null); }}>+ Upload PDF</Btn><small>{!capability ? 'Checking PDF availability…' : !capability.uploadAvailable ? `PDF setup required: ${capability.blockedReason}` : 'Text-based PDFs · up to 10 MiB / 200 pages'}</small></div>}
    {capability?.uploadAvailable && !capability.workerEnabled && <Notice tone="amber">Uploads will queue. A configured Knowledge worker must be running to extract and index them.</Notice>}
    {error && <Notice tone="amber">{error}</Notice>}
    {uploadOpen && <section className="card knowledge-editor" role="region" aria-label="Upload PDF">
      <h3>{replace ? 'Replace PDF' : 'Upload PDF'}</h3>
      <label className="field">Knowledge Base<select value={baseId} onChange={event => setBaseId(event.target.value)} disabled={busy || replace}><option value="">Select Knowledge Base</option>{bases.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>
      {!bases.length && <div className="action-line"><label className="field">Create your first Knowledge Base<input value={baseName} disabled={busy} maxLength={120} onChange={event => setBaseName(event.target.value)}/></label><Btn secondary disabled={busy || !baseName.trim()} onClick={() => void createBase()}>Create Knowledge Base</Btn></div>}
      {!replace && <label className="field">Visibility<select value={visibility} disabled={busy} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="INTERNAL_RESTRICTED">Restricted — internal only</option><option value="PUBLIC_REFERENCE">Customer-facing — approved for customers</option></select></label>}
      <label className="field">PDF document<input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => { const selected = event.target.files?.[0] ?? null; setError(''); if (selected && (selected.size > (capability?.maxBytes ?? 0) || !selected.name.toLowerCase().endsWith('.pdf'))) { setFile(null); setError('Choose a PDF within the displayed size limit.'); } else setFile(selected); }}/></label>
      {file && <p>{file.name} · {(file.size / 1024).toFixed(1)} KiB</p>}
      <div className="action-line"><Btn disabled={busy || !file || !baseId} onClick={() => void upload()}>{busy ? 'Uploading…' : 'Upload & Process'}</Btn><Btn secondary disabled={busy} onClick={() => setUploadOpen(false)}>Cancel</Btn></div>
    </section>}
    {sourceId && <section className="card knowledge-editor" aria-label="PDF source details">
      <div className="action-line"><h3>{source?.name ?? 'Loading document…'}</h3><Btn secondary disabled={busy} onClick={() => { closeSource(); onChange(); }}>Close</Btn><Btn secondary onClick={() => setRevision(value => value + 1)}>Refresh status</Btn></div>
      {source && <><p>{source.processingStatus === 'processing' ? source.document?.extracted ? 'Indexing' : 'Extracting' : source.processingStatus} · Version {source.sourceVersion} · {source.document?.pages.length ?? 0} extracted pages · {processing?.chunkCount ?? '…'} indexed chunks</p>
        {manager && <div className="action-line"><label className="field">Source title<input value={title} maxLength={200} disabled={busy} onChange={event => setTitle(event.target.value)}/></label><Btn secondary disabled={busy || !title.trim() || title === source.name} onClick={() => void rename()}>Save title</Btn></div>}
        {source.processingErrorCode && <Notice tone="amber">{source.processingErrorCode}. {source.processingErrorCode.includes('OCR') ? 'Upload a PDF with selectable text; OCR is not configured.' : 'Review the PDF and processing configuration, then reprocess.'}</Notice>}
        {!!source.document?.warnings.length && <Notice tone="amber">{source.document.warnings.join(', ')}</Notice>}
        <p>{source.document?.filename} · {source.document?.bytes} bytes · {source.visibility === 'PUBLIC_REFERENCE' ? 'Customer-facing, subject to assistant authorization' : 'Restricted'}</p>
        <details><summary>View extracted content</summary><div className="knowledge-extracted-content">{source.document?.pages.map(page => <section key={page.page}><h4>Page {page.page}</h4><pre>{source.contentBody?.slice(page.start, page.end)}</pre></section>)}</div></details>
        {manager && <div className="action-line"><Btn secondary disabled={busy} onClick={() => void action('reindex')}>Reprocess</Btn><Btn secondary disabled={busy || !capability?.uploadAvailable} onClick={() => { setReplace(true); setFile(null); setUploadOpen(true); }}>Replace PDF</Btn><Btn secondary disabled={busy} onClick={() => void action('archive')}>Archive source</Btn></div>}
      </>}
    </section>}
  </>;
}
