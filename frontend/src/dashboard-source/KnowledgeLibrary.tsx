import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, FileText, Search, ShoppingBag, Users } from 'lucide-react';
import { BusinessDataVisibility } from '../pages/knowledge/BusinessDataVisibility';
import { listAssistants } from '../services/api/assistants';
import { ApiError } from '../services/api/client';
import { getEffectiveKnowledge } from '../services/api/knowledge-bases';
import { listKnowledge, type KnowledgeSection, type KnowledgeSource, type SourcePage } from '../services/api/knowledge';
import { KnowledgeDocumentDialog } from './KnowledgeDocumentDialog';
import './knowledge-library.css';
import '../pages/knowledge/knowledge-bases.css';

const sections: Array<{ id: KnowledgeSection; title: string; description: string }> = [
  { id: 'BUSINESS_INTRODUCTION', title: 'Business Introduction', description: 'Company overview, services, locations and key business details.' },
  { id: 'SHIPPING_DELIVERY', title: 'Shipping & Delivery', description: 'Dispatch, delivery timelines, charges and tracking.' },
  { id: 'RETURNS_REFUNDS', title: 'Returns & Refunds', description: 'Return windows, exchanges and refund conditions.' },
  { id: 'PAYMENT_CANCELLATION', title: 'Payment & Cancellation', description: 'Payment methods and cancellation policies.' },
  { id: 'WARRANTY_SUPPORT_FAQS', title: 'Warranty, Support & FAQs', description: 'Warranty terms, support contacts and common questions.' },
];
type Assistant = { id: string; name: string; status: string };
const message = (error: unknown) => error instanceof ApiError ? error.message : 'Knowledge could not be loaded. Please try again.';
const processing = new Set(['queued', 'processing']);
const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

export function KnowledgeLibrary({ slug, role, openDocument }: { slug: string; role: string; openDocument?: (id: string) => void }) {
  const [section, setSection] = useState<KnowledgeSection | 'SHOPIFY' | null>(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SourcePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [assistantId, setAssistantId] = useState('');
  const [effective, setEffective] = useState<Awaited<ReturnType<typeof getEffectiveKnowledge>> | null>(null);
  const [accessError, setAccessError] = useState('');
  const [uploadSection, setUploadSection] = useState<KnowledgeSection | null>(null);
  const [detailSourceId, setDetailSourceId] = useState('');
  const [reload, setReload] = useState(0);
  const manager = ['owner', 'admin'].includes(role.toLowerCase());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    listKnowledge(slug, controller.signal, { page: 1, pageSize: 100, ...(section && section !== 'SHOPIFY' ? { section, pdfOnly: true } : {}), ...(query.trim() ? { search: query.trim() } : {}) })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(message(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, section, query, reload]);

  useEffect(() => {
    const controller = new AbortController();
    listAssistants(slug, 1, controller.signal, 'ALL').then(result => {
      if (controller.signal.aborted) return;
      const rows = result.assistants.map(item => ({ id: item.id, name: item.name, status: item.status }));
      setAssistants(rows);
      setAssistantId(current => rows.some(item => item.id === current) ? current : rows[0]?.id ?? '');
    }).catch(reason => { if (!controller.signal.aborted) setAccessError(message(reason)); });
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    setEffective(null); setAccessError('');
    if (!assistantId) return;
    const controller = new AbortController();
    getEffectiveKnowledge(slug, assistantId, controller.signal).then(value => { if (!controller.signal.aborted) setEffective(value); })
      .catch(reason => { if (!controller.signal.aborted) setAccessError(message(reason)); });
    return () => controller.abort();
  }, [slug, assistantId]);

  const counts = useMemo(() => {
    const values = data?.pdfCounts ?? [];
    return {
      total: values.reduce((sum, row) => sum + row.count, 0),
      ready: values.filter(row => row.status === 'ready').reduce((sum, row) => sum + row.count, 0),
      processing: values.filter(row => processing.has(row.status)).reduce((sum, row) => sum + row.count, 0),
      failed: values.filter(row => row.status === 'failed').reduce((sum, row) => sum + row.count, 0),
    };
  }, [data]);

  const sectionCounts = useMemo(() => {
    const result = new Map<KnowledgeSection, number>();
    for (const item of sections) result.set(item.id, (data?.pdfCounts ?? []).filter(row => row.section === item.id).reduce((sum, row) => sum + row.count, 0));
    return result;
  }, [data]);
  const accessibleIds = useMemo(() => new Set(effective?.sources.map(source => source.id) ?? []), [effective]);
  const documents = data?.sources ?? [];
  const closeDialog = () => { setUploadSection(null); setDetailSourceId(''); };

  return <main className="knowledge-library">
    <header className="knowledge-library-header">
      {section && <button className="knowledge-back" onClick={() => { setSection(null); setQuery(''); }}><ArrowLeft size={16}/> Knowledge Base</button>}
      <div><p className="knowledge-eyebrow">WORKSPACE KNOWLEDGE</p><h1>{section === 'SHOPIFY' ? 'Products & Collections' : sections.find(item => item.id === section)?.title ?? 'Knowledge Base'}</h1><p className="knowledge-description">{section ? section === 'SHOPIFY' ? 'Shopify catalog data managed by your existing connector.' : sections.find(item => item.id === section)?.description : 'Manage the information your AI uses to answer customers.'}</p></div>
    </header>

    {!section && <>
      <section className="knowledge-metrics" aria-label="Knowledge statistics">
        {[['PDF documents', counts.total], ['Ready for AI', counts.ready], ['Processing', counts.processing], ['Failed', counts.failed]].map(([label, value]) => <article className="knowledge-metric" key={String(label)}><span>{label}</span><strong>{loading ? '—' : Number(value).toLocaleString()}</strong></article>)}
      </section>
      <section className="knowledge-section-grid" aria-label="Knowledge sections">
        {sections.map(item => <button className="knowledge-section-card" key={item.id} onClick={() => setSection(item.id)}><span className="knowledge-card-icon"><BookOpen size={18}/></span><span className="knowledge-card-copy"><strong>{item.title}</strong><small>{item.description}</small></span><span className="knowledge-count">{loading ? '—' : sectionCounts.get(item.id) ?? 0} PDFs</span><ArrowRight className="knowledge-arrow" size={17}/></button>)}
        <button className="knowledge-section-card knowledge-shopify-card" onClick={() => setSection('SHOPIFY')}><span className="knowledge-card-icon"><ShoppingBag size={18}/></span><span className="knowledge-card-copy"><strong>Products & Collections</strong><small>Browse authorized Shopify catalog data and connection status.</small></span><span className="knowledge-count">Shopify connector</span><ArrowRight className="knowledge-arrow" size={17}/></button>
      </section>
      <section className="knowledge-access" aria-label="Assistant knowledge access"><div><span className="knowledge-card-icon"><Users size={18}/></span><div><h2>Assistant access</h2><p>Review the saved Knowledge access for an assistant. Server permissions remain authoritative.</p></div></div><label>Assistant<select aria-label="Assistant for Knowledge access" value={assistantId} onChange={event => setAssistantId(event.target.value)}><option value="">{assistants.length ? 'Choose an assistant' : 'No assistants available'}</option>{assistants.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><p role="status">{accessError || (assistantId && effective ? `${effective.searchableSourceCount ?? effective.effectiveSourceCount ?? 0} searchable sources · ${accessibleIds.size} assigned or eligible sources` : assistantId ? 'Loading saved access…' : 'Select an assistant to inspect its saved access.')}</p></section>
    </>}

    {section === 'SHOPIFY' && <BusinessDataVisibility slug={slug} manager={manager} initialTab="shopify" compact/>}
    {section && section !== 'SHOPIFY' && <section className="knowledge-documents">
      <div className="knowledge-documents-toolbar"><label className="knowledge-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search documents in this section" aria-label="Search documents in section"/></label><button className="knowledge-upload" disabled={!manager} title={manager ? 'Upload English PDF knowledge' : 'Owner or admin access is required'} onClick={() => setUploadSection(section)}><FileText size={16}/> Upload PDF</button></div>
      {error && <div className="knowledge-error" role="alert">{error}</div>}
      {loading && <p className="knowledge-empty" role="status">Loading documents…</p>}
      {!loading && !error && documents.length === 0 && <div className="knowledge-empty"><span className="knowledge-card-icon"><FileText size={20}/></span><h2>No documents yet.</h2><p>Upload a PDF containing your {sections.find(item => item.id === section)?.title.toLowerCase()} information to make it available to your AI assistant.</p></div>}
      {!loading && documents.length > 0 && <div className="knowledge-document-list">{documents.map((source: KnowledgeSource) => <article className="knowledge-document-row" key={source.id}><span className="knowledge-card-icon"><FileText size={17}/></span><div><strong>{source.name}</strong><small>{source.document?.filename ?? 'PDF'} · Updated {date(source.updatedAt)}</small></div><span className={`knowledge-status knowledge-status-${source.processingStatus}`}>{source.processingStatus.replaceAll('_', ' ')}</span><span className="knowledge-access-state">{accessibleIds.has(source.id) ? 'Searchable for selected assistant' : 'Not available to selected assistant'} · {source.visibility === 'PUBLIC_REFERENCE' ? 'Customer-visible' : 'Internal only'}</span><button className="knowledge-document-open" onClick={() => setDetailSourceId(source.id)}>Details</button></article>)}</div>}
      {data && data.total > documents.length && <p className="knowledge-pagination">Showing {documents.length} of {data.total} PDF documents. Narrow your search to find a document.</p>}
    </section>}
    {(uploadSection || detailSourceId) && <KnowledgeDocumentDialog slug={slug} section={uploadSection ?? section as KnowledgeSection} role={role} sourceId={detailSourceId || undefined} onClose={closeDialog} onSaved={sourceId => { setUploadSection(null); setDetailSourceId(sourceId); setReload(value => value + 1); }} onDeleted={() => { closeDialog(); setReload(value => value + 1); }}/ >}
  </main>;
}
