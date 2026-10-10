import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, FileText, Globe2, Plus, RefreshCw, Trash2, Pencil, Save } from 'lucide-react';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../../services/api/client';
import { archiveKnowledge, createFaqSource, createTextSource, createWebsiteSource, listKnowledge, updateKnowledge, type KnowledgeSource, type KnowledgeType } from '../../services/api/knowledge';

const canManage = (role: string) => role === 'owner' || role === 'admin';
const failureMessage = (error: unknown) => error instanceof ApiError && error.kind === 'http' && error.status !== undefined && error.status < 500 ? error.message : 'We could not complete that request. Please try again.';
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(date));

export function KnowledgeBasePage() {
  const { workspace } = useWorkspaceRoute();
  const manager = canManage(workspace.role);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [kind, setKind] = useState<KnowledgeType>('website');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteName, setWebsiteName] = useState('');
  const [websiteDescription, setWebsiteDescription] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setSources([]); setLoading(true); setError(''); setSuccess(''); setEditing(null);
    listKnowledge(workspace.slug, controller.signal).then((sourcePage) => {
      if (!controller.signal.aborted) setSources(sourcePage.sources);
    }).catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug]);

  async function refresh() {
    const controller = new AbortController();
    setLoading(true); setError('');
    try { const page = await listKnowledge(workspace.slug, controller.signal); setSources(page.sources); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setLoading(false); }
  }

  function showForm(next: KnowledgeType) { setKind(next); setFormOpen(true); setError(''); setSuccess(''); }
  function setWebsite(value: string) {
    setWebsiteUrl(value);
    if (!websiteName.trim()) {
      try { const host = new URL(value.startsWith('http') ? value : `https://${value}`).hostname; if (host && host.includes('.')) setWebsiteName(host.replace(/^www\./, '')); } catch { /* wait for a valid URL */ }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current) return;
    locked.current = true; setSaving(true); setError(''); setSuccess('');
    try {
      let created: KnowledgeSource;
      if (kind === 'website') created = await createWebsiteSource(workspace.slug, { sourceUrl: websiteUrl.trim(), ...(websiteName.trim() ? { name: websiteName.trim() } : {}), ...(websiteDescription.trim() ? { description: websiteDescription.trim() } : {}) });
      else if (kind === 'faq') created = await createFaqSource(workspace.slug, { question: question.trim(), answer: answer.trim(), ...(category.trim() ? { category: category.trim() } : {}) });
      else created = await createTextSource(workspace.slug, { title: title.trim(), content: content.trim(), ...(category.trim() ? { category: category.trim() } : {}) });
      setSources((current) => [created, ...current]); setFormOpen(false); setWebsiteUrl(''); setWebsiteName(''); setWebsiteDescription(''); setQuestion(''); setAnswer(''); setTitle(''); setContent(''); setCategory('');
      setSuccess(kind === 'website' ? 'Website registered as a source. Automatic content import is not available yet.' : 'Knowledge saved. It has not been processed for AI retrieval.');
    } catch (cause) { setError(failureMessage(cause)); }
    finally { locked.current = false; setSaving(false); }
  }

  async function saveEdit(source: KnowledgeSource) {
    if (locked.current) return;
    locked.current = true; setSaving(true); setError('');
    try {
      const input: Record<string, string> = {};
      if (source.type === 'website') { input.name = editName; input.description = editDescription; input.sourceUrl = editUrl; }
      else if (source.type === 'faq') { input.question = editName; input.answer = editDescription; }
      else { input.name = editName; input.content = editDescription; }
      const updated = await updateKnowledge(workspace.slug, source.id, input);
      setSources((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditing(null); setSuccess('Source settings saved. Processing status reset to not processed.');
    } catch (cause) { setError(failureMessage(cause)); }
    finally { locked.current = false; setSaving(false); }
  }

  async function remove(source: KnowledgeSource) {
    if (!window.confirm(`Archive “${source.name}”? Existing assistant links will remain, but this source will no longer be available for linking.`)) return;
    setError('');
    try { await archiveKnowledge(workspace.slug, source.id); setSources((current) => current.filter((item) => item.id !== source.id)); }
    catch (cause) { setError(failureMessage(cause)); }
  }

  return <>
    <header className="workspace-page-heading assistant-page-heading"><span className="workspace-feature-icon"><BookOpen size={20}/></span><div><span className="eyebrow">WORKSPACE KNOWLEDGE</span><h1>Knowledge Base</h1><p>Register approved reference sources for {workspace.name}. Saved sources are not scanned, indexed, or used for live answers yet.</p></div>{manager && <button className="button button-primary assistant-create-action" onClick={() => showForm('website')}><Plus size={16}/> Connect your website</button>}</header>
    {success && <p className="workspace-success" role="status">{success}</p>}
    {error && <div className="workspace-form-error knowledge-error" role="alert">{error}<button className="button button-secondary" onClick={() => void refresh()}><RefreshCw size={14}/> Try again</button></div>}
    {formOpen && manager && <form className="workspace-panel workspace-settings-form knowledge-form" onSubmit={(event) => void submit(event)}>
      <div className="knowledge-form-heading"><div><h2>{kind === 'website' ? 'Connect Your Website' : kind === 'faq' ? 'Add a FAQ' : 'Add reference text'}</h2><p>Knowledge remains registered but is not processed for AI retrieval in this phase.</p></div><button type="button" className="button button-secondary" disabled={saving} onClick={() => setFormOpen(false)}>Close</button></div>
      <div className="knowledge-tabs" role="group" aria-label="Knowledge source type">
        <button type="button" className={kind === 'website' ? 'selected' : ''} onClick={() => setKind('website')}><Globe2 size={14}/> Website</button>
        <button type="button" className={kind === 'faq' ? 'selected' : ''} onClick={() => setKind('faq')}><BookOpen size={14}/> FAQ</button>
        <button type="button" className={kind === 'text' ? 'selected' : ''} onClick={() => setKind('text')}><FileText size={14}/> Text</button>
      </div>
      {kind === 'website' ? <div className="knowledge-form-grid"><label className="workspace-field">Website URL<input type="url" required maxLength={2048} value={websiteUrl} onChange={(event) => setWebsite(event.target.value)} placeholder="https://example.com"/><small>Public HTTP or HTTPS website. No pages are fetched when you register it.</small></label><label className="workspace-field">Display name <span className="optional-label">Optional</span><input maxLength={200} value={websiteName} onChange={(event) => setWebsiteName(event.target.value)} placeholder="Your company website"/></label><label className="workspace-field knowledge-span-two">Description <span className="optional-label">Optional</span><textarea rows={2} maxLength={1000} value={websiteDescription} onChange={(event) => setWebsiteDescription(event.target.value)}/></label></div>
        : kind === 'faq' ? <div className="knowledge-form-grid"><label className="workspace-field knowledge-span-two">Question<input required minLength={1} maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)}/></label><label className="workspace-field knowledge-span-two">Answer<textarea required minLength={1} maxLength={20000} rows={5} value={answer} onChange={(event) => setAnswer(event.target.value)}/></label><label className="workspace-field">Category <span className="optional-label">Optional</span><input maxLength={120} value={category} onChange={(event) => setCategory(event.target.value)}/></label></div>
        : <div className="knowledge-form-grid"><label className="workspace-field knowledge-span-two">Title<input required minLength={2} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)}/></label><label className="workspace-field knowledge-span-two">Content<textarea required minLength={1} maxLength={50000} rows={7} value={content} onChange={(event) => setContent(event.target.value)}/></label><label className="workspace-field">Category <span className="optional-label">Optional</span><input maxLength={120} value={category} onChange={(event) => setCategory(event.target.value)}/></label></div>}
      <div className="assistant-form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : <><Save size={15}/> {kind === 'website' ? 'Register website' : 'Save source'}</>}</button></div>
    </form>}
    <section className="workspace-panel knowledge-panel"><div className="workspace-panel-heading"><div><h2>Sources</h2><p>Registered sources are stored for this workspace. Only processed sources can later be used for retrieval.</p></div><button className="button button-secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button></div>
      <div className="knowledge-actions">{manager && <><button className="button button-secondary" onClick={() => showForm('faq')}><Plus size={14}/> Add FAQ</button><button className="button button-secondary" onClick={() => showForm('text')}><Plus size={14}/> Add text</button><span className="knowledge-disabled-action" title="Private durable storage is not configured"><Plus size={14}/> Upload document · unavailable</span></>}<span className="knowledge-disabled-action" title="Authorized connector execution is planned for a future phase">Application/API connection · future phase</span></div>
      {loading ? <div className="assistant-loading" role="status"><span className="workspace-spinner"/>Loading knowledge sources…</div> : error && sources.length === 0 ? null : sources.length === 0 ? <div className="knowledge-empty"><Globe2 size={22}/><h3>No knowledge sources yet</h3><p>Start by registering your public website. FAQ and text sources are optional additions.</p>{manager && <button className="button button-primary" onClick={() => showForm('website')}><Plus size={14}/> Connect your website</button>}</div> : <div className="knowledge-list">{sources.map((source) => <article className="knowledge-source-card" key={source.id}>
        <span className="workspace-feature-icon">{source.type === 'website' ? <Globe2 size={17}/> : source.type === 'faq' ? <BookOpen size={17}/> : <FileText size={17}/>}</span>
        <div className="knowledge-source-main"><div className="knowledge-source-title"><strong>{source.name}</strong><span className="assistant-status">{source.status}</span></div>{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceUrl}</a>}<small>{source.type.toUpperCase()} · {source.processingStatus === 'not_processed' ? 'Not processed' : source.processingStatus} · Updated {dateLabel(source.updatedAt)}{source.lastSuccessfulSyncAt ? ` · Last sync ${dateLabel(source.lastSuccessfulSyncAt)}` : ''}{source.linkedAssistantCount !== undefined ? ` · ${source.linkedAssistantCount} linked assistant${source.linkedAssistantCount === 1 ? '' : 's'}` : ''}</small>
          {source.description && <p>{source.description}</p>}
          {editing === source.id ? <div className="knowledge-edit">{source.type === 'website' && <label className="workspace-field">Website URL<input type="url" maxLength={2048} value={editUrl} onChange={(event) => setEditUrl(event.target.value)}/></label>}<label className="workspace-field">{source.type === 'faq' ? 'Question' : source.type === 'website' ? 'Display name' : 'Title'}<input value={editName} onChange={(event) => setEditName(event.target.value)}/></label><label className="workspace-field">{source.type === 'faq' ? 'Answer' : source.type === 'text' ? 'Content' : 'Description'}<textarea rows={4} value={editDescription} onChange={(event) => setEditDescription(event.target.value)}/></label><div className="assistant-form-actions"><button className="button button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void saveEdit(source)}><Save size={14}/> Save</button></div></div> : source.type !== 'website' && source.contentBody && <details className="knowledge-content"><summary>View saved content</summary><p>{source.contentBody}</p></details>}
        </div>
        {manager && source.status !== 'archived' && <div className="knowledge-source-actions"><button className="button button-secondary" onClick={() => { setEditing(source.id); setEditName(source.name); setEditUrl(source.sourceUrl || ''); setEditDescription(source.type === 'faq' || source.type === 'text' ? source.contentBody || '' : source.description || ''); setError(''); }} aria-label={`Edit ${source.name}`}><Pencil size={14}/></button><button className="button button-secondary" onClick={() => void remove(source)} aria-label={`Archive ${source.name}`}><Trash2 size={14}/></button></div>}
      </article>)}</div>}
    </section>
    <section className="workspace-panel knowledge-truth"><strong>Source lifecycle</strong><p>Registered does not mean synchronized, indexed, or ready for AI retrieval. Automatic website import, private document storage, and business API connectors are not available yet.</p></section>
  </>;
}
