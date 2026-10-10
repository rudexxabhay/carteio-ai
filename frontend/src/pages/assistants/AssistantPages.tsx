import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Plus, RefreshCw, Save, ArrowLeft, Pencil, Power, CircleHelp } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../../services/api/client';
import { createAssistant, getAssistant, listAssistants, setAssistantActive, updateAssistant, type Assistant, type AssistantInput, type ResponseTone } from '../../services/api/assistants';
import { attachKnowledge, detachKnowledge, getAssistantKnowledge, type AssistantKnowledge, type KnowledgeSource } from '../../services/api/knowledge';

const emptyInput: AssistantInput = {
  name: '', description: '', businessPurpose: '', systemInstructions: '', defaultLanguage: 'en',
  responseTone: 'professional', fallbackMessage: 'I’m not able to help with that right now. Please contact the business directly.',
};
const safeMessage = (cause: unknown, fallback: string) => cause instanceof ApiError && cause.kind === 'http' && cause.status !== undefined && cause.status < 500
  ? cause.message : fallback;
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(date));
const canManage = (role: string) => role === 'owner' || role === 'admin';

export function AssistantListPage() {
  const { workspace } = useWorkspaceRoute();
  const navigate = useNavigate();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reloadCount, setReloadCount] = useState(0);
  const manager = canManage(workspace.role);

  useEffect(() => { setPage(1); }, [workspace.slug]);
  useEffect(() => {
    const controller = new AbortController();
    setAssistants([]); setTotal(0); setLoading(true); setError('');
    listAssistants(workspace.slug, page, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setAssistants(result.assistants); setTotal(result.total); }
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(safeMessage(cause, 'We could not load assistants for this workspace.'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, page, reloadCount]);

  return <>
    <header className="workspace-page-heading assistant-page-heading"><span className="workspace-feature-icon"><Bot size={20}/></span><div><span className="eyebrow">WORKSPACE AI</span><h1>AI Assistants</h1><p>Configure assistants for {workspace.name}. Saved settings do not enable live AI responses or a deployed chatbot.</p></div>{manager && <button className="button button-primary assistant-create-action" onClick={() => navigate(`/workspace/${encodeURIComponent(workspace.slug)}/assistants/new`)}><Plus size={16}/> Create assistant</button>}</header>
    {loading ? <div className="workspace-panel assistant-loading" role="status"><span className="workspace-spinner"/>Loading assistants…</div> : error ? <div className="workspace-panel assistant-empty"><p role="alert">{error}</p><button className="button button-secondary" onClick={() => setReloadCount((count) => count + 1)}><RefreshCw size={15}/> Try again</button></div> : assistants.length === 0 ? <section className="workspace-panel assistant-empty"><span className="workspace-feature-icon"><Bot size={19}/></span><h2>No assistants yet</h2><p>Create an assistant to save its purpose, instructions, language and response style for this workspace.</p>{manager && <button className="button button-primary" onClick={() => navigate(`/workspace/${encodeURIComponent(workspace.slug)}/assistants/new`)}><Plus size={15}/> Create your first assistant</button>}</section> : <div className="assistant-list" aria-label="Workspace assistants">
      {assistants.map((assistant) => <Link key={assistant.id} className="assistant-card" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants/${encodeURIComponent(assistant.id)}`}>
        <span className="workspace-feature-icon"><Bot size={18}/></span><span className="assistant-card-main"><strong>{assistant.name}</strong><span>{assistant.description || assistant.businessPurpose || 'No description provided'}</span><small>{assistant.defaultLanguage} · Updated {dateLabel(assistant.updatedAt)}</small></span><span className={`assistant-status assistant-status-${assistant.status}`}>{assistant.status}</span>
      </Link>)}
    </div>}
    {!loading && !error && total > 100 && <div className="workspace-pagination assistant-pagination"><span>Page {page} of {Math.ceil(total / 100)} · {total} assistants</span><div><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button disabled={page >= Math.ceil(total / 100)} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>}
  </>;
}

export function AssistantEditorPage() {
  const { workspace } = useWorkspaceRoute();
  const { assistantId } = useParams();
  const navigate = useNavigate();
  const manager = canManage(workspace.role);
  const creating = assistantId === undefined || assistantId === 'new';
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [input, setInput] = useState<AssistantInput>(emptyInput);
  const [loading, setLoading] = useState(!creating);
  const [editing, setEditing] = useState(creating);
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');

  useEffect(() => {
    if (creating || !assistantId) return;
    const controller = new AbortController();
    setAssistant(null); setLoading(true); setError(''); setEditing(false);
    getAssistant(workspace.slug, assistantId, controller.signal).then((record) => {
      if (!controller.signal.aborted) { setAssistant(record); setInput(fromAssistant(record)); }
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(safeMessage(cause, 'This assistant is unavailable in the selected workspace.'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, assistantId, creating]);

  function setField<K extends keyof AssistantInput>(field: K, value: AssistantInput[K]) {
    setInput((current) => ({ ...current, [field]: value }));
    setFieldError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingLock.current) return;
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2) { setFieldError('Enter an assistant name with at least 2 characters.'); return; }
    if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(input.defaultLanguage.trim())) { setFieldError('Enter a valid language tag, such as en or en-US.'); return; }
    savingLock.current = true; setSaving(true); setError(''); setFieldError('');
    const normalized = { ...input, name, defaultLanguage: input.defaultLanguage.trim() };
    try {
      if (creating) {
        const created = await createAssistant(workspace.slug, normalized);
        navigate(`/workspace/${encodeURIComponent(workspace.slug)}/assistants/${encodeURIComponent(created.id)}`, { replace: true });
      } else if (assistantId) {
        const updated = await updateAssistant(workspace.slug, assistantId, normalized);
        setAssistant(updated); setInput(fromAssistant(updated)); setEditing(false);
      }
    } catch (cause) {
      setError(safeMessage(cause, 'We could not save this assistant. Your changes are still here; please try again.'));
    } finally { savingLock.current = false; setSaving(false); }
  }

  async function changeStatus(active: boolean) {
    if (!assistant || savingLock.current) return;
    savingLock.current = true; setSaving(true); setError('');
    try { setAssistant(await setAssistantActive(workspace.slug, assistant.id, active)); }
    catch (cause) { setError(safeMessage(cause, 'We could not update the assistant status. Please try again.')); }
    finally { savingLock.current = false; setSaving(false); }
  }

  if (loading) return <div className="workspace-panel assistant-loading" role="status"><span className="workspace-spinner"/>Loading assistant…</div>;
  if (creating && !manager) return <section className="workspace-panel assistant-empty"><h2>Assistant management restricted</h2><p>Only workspace owners and admins can create assistants.</p><Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}><ArrowLeft size={15}/> Back to assistants</Link></section>;
  if (error && !assistant && !creating) return <section className="workspace-panel assistant-empty"><p role="alert">{error}</p><Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}><ArrowLeft size={15}/> Back to assistants</Link></section>;

  return <>
    <Link className="assistant-back-link" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}><ArrowLeft size={15}/> All assistants</Link>
    <header className="workspace-page-heading assistant-page-heading"><span className="workspace-feature-icon"><Bot size={20}/></span><div><span className="eyebrow">{creating ? 'NEW CONFIGURATION' : 'ASSISTANT CONFIGURATION'}</span><h1>{creating ? 'Create assistant' : assistant?.name || 'Assistant'}</h1><p>Configuration is saved for this workspace. Activation does not connect an AI provider or deploy a chatbot.</p></div>{assistant && <span className={`assistant-status assistant-status-${assistant.status}`}>{assistant.status}</span>}</header>
    {!creating && assistant && !editing && <div className="assistant-toolbar">{manager && <><button className="button button-secondary" onClick={() => { setInput(fromAssistant(assistant)); setEditing(true); setError(''); }}><Pencil size={15}/> Edit settings</button><button className="button button-secondary" disabled={saving} onClick={() => void changeStatus(assistant.status !== 'active')}><Power size={15}/>{saving ? 'Updating…' : assistant.status === 'active' ? 'Deactivate' : 'Activate'}</button></>}</div>}
    {!manager && !creating && <p className="assistant-readonly"><CircleHelp size={15}/> Your workspace role allows viewing assistant settings only.</p>}
    {error && <div className="workspace-form-error assistant-error" role="alert">{error}</div>}
    {(editing || creating) ? <form className="workspace-panel workspace-settings-form assistant-form" onSubmit={(event) => void submit(event)}>
      <div className="assistant-form-grid">
        <label className="workspace-field">Assistant name<input required minLength={2} maxLength={200} value={input.name} disabled={!manager || saving} onChange={(event) => setField('name', event.target.value)} placeholder="For example, Customer Support Assistant"/></label>
        <label className="workspace-field">Default language<input required maxLength={35} value={input.defaultLanguage} disabled={!manager || saving} onChange={(event) => setField('defaultLanguage', event.target.value)} placeholder="en or en-US"/><small>Use a language tag such as en, fr, or en-US.</small></label>
        <label className="workspace-field assistant-span-two">Description <span className="optional-label">Optional</span><textarea maxLength={1000} rows={2} value={input.description || ''} disabled={!manager || saving} onChange={(event) => setField('description', event.target.value)} placeholder="A short summary for your team"/></label>
        <label className="workspace-field assistant-span-two">Business purpose <span className="optional-label">Optional</span><textarea maxLength={500} rows={2} value={input.businessPurpose || ''} disabled={!manager || saving} onChange={(event) => setField('businessPurpose', event.target.value)} placeholder="What should this assistant help people accomplish?"/></label>
        <label className="workspace-field assistant-span-two">Instructions <span className="optional-label">Optional</span><textarea maxLength={10000} rows={6} value={input.systemInstructions || ''} disabled={!manager || saving} onChange={(event) => setField('systemInstructions', event.target.value)} placeholder="Describe the assistant's role, boundaries and response guidance."/><small>Stored as configuration only. Application security rules always take precedence.</small></label>
        <label className="workspace-field">Response tone<select value={input.responseTone} disabled={!manager || saving} onChange={(event) => setField('responseTone', event.target.value as ResponseTone)}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="concise">Concise</option><option value="empathetic">Empathetic</option></select></label>
        <label className="workspace-field">Fallback message<input required minLength={1} maxLength={500} value={input.fallbackMessage} disabled={!manager || saving} onChange={(event) => setField('fallbackMessage', event.target.value)} placeholder="Message shown when help is unavailable"/></label>
      </div>
      {fieldError && <p className="workspace-form-error" role="alert">{fieldError}</p>}
      {manager && <div className="assistant-form-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={() => creating ? navigate(`/workspace/${encodeURIComponent(workspace.slug)}/assistants`) : (setInput(fromAssistant(assistant!)), setEditing(false), setError(''))}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : <><Save size={15}/>{creating ? 'Create assistant' : 'Save changes'}</>}</button></div>}
    </form> : assistant && <><section className="workspace-panel assistant-read-view"><AssistantValue label="Description" value={assistant.description}/><AssistantValue label="Business purpose" value={assistant.businessPurpose}/><AssistantValue label="Instructions" value={assistant.systemInstructions}/><div className="assistant-value-grid"><AssistantValue label="Default language" value={assistant.defaultLanguage}/><AssistantValue label="Response tone" value={assistant.responseTone}/></div><AssistantValue label="Fallback message" value={assistant.fallbackMessage}/><small>Created {dateLabel(assistant.createdAt)} · Updated {dateLabel(assistant.updatedAt)}</small></section><KnowledgeAssignments assistantId={assistant.id}/></>}
  </>;
}

function fromAssistant(assistant: Assistant): AssistantInput {
  return { name: assistant.name, description: assistant.description || '', businessPurpose: assistant.businessPurpose || '', systemInstructions: assistant.systemInstructions || '', defaultLanguage: assistant.defaultLanguage, responseTone: assistant.responseTone, fallbackMessage: assistant.fallbackMessage };
}

function AssistantValue({ label, value }: { label: string; value: string | null }) {
  return <div className="assistant-value"><strong>{label}</strong><p>{value || 'Not provided'}</p></div>;
}

function KnowledgeAssignments({ assistantId }: { assistantId: string }) {
  const { workspace } = useWorkspaceRoute();
  const manager = canManage(workspace.role);
  const [data, setData] = useState<AssistantKnowledge | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setLoading(true); setError(''); setSelected('');
    getAssistantKnowledge(workspace.slug, assistantId, controller.signal).then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(safeMessage(cause, 'We could not load this assistant’s knowledge sources.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, assistantId, refresh]);
  const linked = data?.linked || [];
  const linkedIds = new Set(linked.map((source) => source.id));
  const available = (data?.available || []).filter((source) => !linkedIds.has(source.id));
  async function changeLink(source: KnowledgeSource, attach: boolean) {
    setBusy(true); setError('');
    try {
      if (attach) await attachKnowledge(workspace.slug, assistantId, source.id);
      else await detachKnowledge(workspace.slug, assistantId, source.id);
      setRefresh((value) => value + 1);
    } catch (cause) { setError(safeMessage(cause, 'We could not update linked sources. Please try again.')); }
    finally { setBusy(false); }
  }
  return <section className="workspace-panel assistant-knowledge-panel"><div className="workspace-panel-heading"><div><h2>Knowledge sources</h2><p>Linked configuration is not processed or available for AI retrieval yet.</p></div></div>
    {error && <p className="workspace-form-error" role="alert">{error}</p>}
    {loading ? <div className="assistant-loading" role="status"><span className="workspace-spinner"/>Loading linked sources…</div> : <>
      {linked.length ? <div className="assistant-knowledge-list">{linked.map((source) => <div key={source.id} className="assistant-knowledge-row"><span><strong>{source.name}</strong><small>{source.type} · {source.processingStatus.replace('_', ' ')}</small></span>{manager && <button className="button button-secondary" disabled={busy} onClick={() => void changeLink(source, false)}>Unlink</button>}</div>)}</div> : <p className="knowledge-footnote">No sources are linked to this assistant.</p>}
      {manager && available.length > 0 && <div className="assistant-knowledge-add"><label className="workspace-field" htmlFor="knowledge-source-select">Available source<select id="knowledge-source-select" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}><option value="">Select a source</option>{available.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.type}</option>)}</select></label><button className="button button-primary" disabled={busy || !selected} onClick={() => { const source = available.find((item) => item.id === selected); if (source) void changeLink(source, true); }}>Link source</button></div>}
      {available.length === 0 && linked.length === 0 && <p className="knowledge-footnote">There are no available sources. Register them in the workspace Knowledge Base.</p>}
      {linked.some((source) => source.processingStatus !== 'ready') && <p className="knowledge-footnote">One or more linked sources are not processed and cannot be used for AI retrieval.</p>}
    </>}
  </section>;
}
