import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, Save, ArrowLeft, Pencil, Power, CircleHelp, Search, RotateCcw, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../../services/api/client';
import { archiveAssistant, createAssistant, getAssistant, getProviderConfigurationStatus, restoreAssistant, setAssistantActive, updateAssistant, validateOpenRouterModel, type Assistant, type AssistantInput, type EffectiveProviderConfiguration, type ProviderConfigurationStatus, type ResponseTone } from '../../services/api/assistants';
import { getAssistantKnowledge, type AssistantKnowledge } from '../../services/api/knowledge';
import { getAssistantKnowledgeBases, getEffectiveKnowledge, replaceAssistantKnowledgeBases, type AssistantKnowledgeBases, type EffectiveKnowledge } from '../../services/api/knowledge-bases';
import { PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

const emptyInput: AssistantInput = {
  name: '', description: '', businessPurpose: '', systemInstructions: '', defaultLanguage: 'auto',
  responseTone: 'professional', fallbackMessage: 'I’m not able to help with that right now. Please contact the business directly.',
  providerMode: 'MANUAL', providerFallbacks: [],
};
const safeMessage = (cause: unknown, fallback: string) => cause instanceof ApiError && cause.kind === 'http' && cause.status !== undefined && cause.status < 500
  ? cause.message : fallback;
const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(date));
const canManage = (role: string) => role === 'owner' || role === 'admin';

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
  const [providerStatus, setProviderStatus] = useState<ProviderConfigurationStatus | null>(null);
  const [validatingOpenRouter, setValidatingOpenRouter] = useState(false);
  const [openRouterValidation, setOpenRouterValidation] = useState('');
  const [lifecycleAction, setLifecycleAction] = useState<'archive' | 'restore' | null>(null);

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

  useEffect(() => {
    if (!manager) return;
    const controller = new AbortController();
    void getProviderConfigurationStatus(workspace.slug, controller.signal).then(setProviderStatus).catch(() => setProviderStatus(null));
    return () => controller.abort();
  }, [workspace.slug, manager]);

  const runOpenRouterValidation = async () => {
    setValidatingOpenRouter(true); setOpenRouterValidation('');
    try {
      const result = await validateOpenRouterModel(workspace.slug);
      setOpenRouterValidation(`${result.model}: available · tool calling ${result.toolCalling.toLowerCase()}`);
      setProviderStatus(await getProviderConfigurationStatus(workspace.slug));
    } catch (cause) {
      setOpenRouterValidation(safeMessage(cause, 'OpenRouter model validation failed. Check the server configuration and try again.'));
    } finally { setValidatingOpenRouter(false); }
  };

  function setField<K extends keyof AssistantInput>(field: K, value: AssistantInput[K]) {
    setInput((current) => ({ ...current, [field]: value }));
    setFieldError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingLock.current) return;
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2) { setFieldError('Enter an assistant name with at least 2 characters.'); return; }
    if (!/^(?:auto|[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*)$/.test(input.defaultLanguage.trim())) { setFieldError('Enter a valid language tag, such as en or en-US.'); return; }
    savingLock.current = true; setSaving(true); setError(''); setFieldError('');
    const normalized = { ...input, name, defaultLanguage: input.defaultLanguage.trim() };
    try {
      if (creating) {
        const creationInput: AssistantInput = { ...normalized };
        delete creationInput.providerMode; delete creationInput.providerFallbacks;
        const created = await createAssistant(workspace.slug, creationInput);
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

  async function changeArchiveState() {
    if (!assistant || !lifecycleAction || savingLock.current) return;
    savingLock.current = true; setSaving(true); setError('');
    try {
      const updated = lifecycleAction === 'archive'
        ? await archiveAssistant(workspace.slug, assistant.id)
        : await restoreAssistant(workspace.slug, assistant.id);
      setAssistant(updated); setInput(fromAssistant(updated)); setLifecycleAction(null);
    } catch (cause) {
      setError(safeMessage(cause, `We could not ${lifecycleAction} this assistant. Please try again.`));
    } finally { savingLock.current = false; setSaving(false); }
  }

  if (loading) return <div className="workspace-panel assistant-loading" role="status"><span className="workspace-spinner"/>Loading assistant…</div>;
  if (creating && !manager) return <section className="workspace-panel assistant-empty"><h2>Assistant management restricted</h2><p>Only workspace owners and admins can create assistants.</p><Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}><ArrowLeft size={15}/> Back to assistants</Link></section>;
  if (error && !assistant && !creating) return <section className="workspace-panel assistant-empty"><p role="alert">{error}</p><Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}><ArrowLeft size={15}/> Back to assistants</Link></section>;

  return <>
    <Link className="assistant-back-link" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}><ArrowLeft size={15}/> All assistants</Link>
    <PageHeader eyebrow={creating ? 'New Configuration' : 'Assistant Configuration'} title={creating ? 'Create assistant' : assistant?.name || 'Assistant'} desc="Configuration is saved for this workspace. Activation does not connect an AI provider or deploy a chatbot." statusLabel={assistant?.status}/>
    {!creating && assistant && !editing && <div className="assistant-toolbar">{manager && <>{assistant.status !== 'archived' && <><button className="button button-secondary" onClick={() => { setInput(fromAssistant(assistant)); setEditing(true); setError(''); }}><Pencil size={15}/> Edit settings</button><button className="button button-secondary" disabled={saving} onClick={() => void changeStatus(assistant.status !== 'active')}><Power size={15}/>{saving ? 'Updating…' : assistant.status === 'active' ? 'Deactivate' : 'Activate'}</button><button className="button button-secondary" disabled={saving} onClick={() => setLifecycleAction('archive')}><Archive size={15}/> Archive</button></>}{assistant.status === 'archived' && <button className="button button-primary" disabled={saving} onClick={() => setLifecycleAction('restore')}><RotateCcw size={15}/> Restore assistant</button>}<button className="button button-secondary assistant-delete-disabled" disabled title="Permanent deletion is unavailable while historical conversation and workflow records may depend on this assistant."><Trash2 size={15}/> Permanent deletion unavailable</button></>}</div>}
    {assistant?.status === 'archived' && <div className="assistant-archive-notice" role="status"><strong>This assistant is archived.</strong><span>It cannot be activated or used in the Playground. Its configuration, Knowledge links and historical records are retained.</span></div>}
    {manager && assistant && <p className="assistant-delete-unavailable">Permanent deletion is unavailable while linked conversations and workflow history may be retained. Archive this assistant to stop its use without removing historical records.</p>}
    {lifecycleAction && assistant && <div className="assistant-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setLifecycleAction(null); }}><section className="assistant-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="assistant-lifecycle-title" aria-describedby="assistant-lifecycle-description"><h2 id="assistant-lifecycle-title">{lifecycleAction === 'archive' ? `Archive ${assistant.name}?` : `Restore ${assistant.name}?`}</h2><p id="assistant-lifecycle-description">{lifecycleAction === 'archive' ? 'This prevents new Playground use and deactivates an active assistant. Configuration, linked Knowledge permissions and historical records are retained. Restore it later to make it available for activation.' : 'This removes the archive restriction. The assistant remains inactive and must be explicitly activated before it can be used.'}</p>{error && <p role="alert" className="workspace-form-error">{error}</p>}<div className="assistant-form-actions"><button className="button button-secondary" disabled={saving} onClick={() => setLifecycleAction(null)}>Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void changeArchiveState()}>{saving ? 'Saving…' : lifecycleAction === 'archive' ? 'Archive assistant' : 'Restore assistant'}</button></div></section></div>}
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
        <div className="assistant-provider-status assistant-span-two" role="status"><strong>Server-managed provider</strong><span>{providerStatus ? effectiveProviderLabel(providerStatus.effective) : assistant ? effectiveProviderLabel(assistant.effectiveProviderConfiguration) : 'Loading server configuration…'}</span><small>Provider and model are managed by the server configuration.</small></div>
        {!creating && <>
          <label className="workspace-field">Provider selection mode<select value={input.providerMode || 'MANUAL'} disabled={!manager || saving} onChange={(event) => setField('providerMode', event.target.value as 'MANUAL' | 'AUTO_FALLBACK')}><option value="MANUAL">Manual · configured provider only</option><option value="AUTO_FALLBACK">Automatic fallback · transient failures only</option></select></label>
          {input.providerMode === 'AUTO_FALLBACK' && <label className="workspace-field assistant-span-two">Approved backup routes<input value={(input.providerFallbacks || []).map((route) => `${route.provider}:${route.model}`).join(', ')} disabled={!manager || saving} onChange={(event) => setField('providerFallbacks', event.target.value.split(',').map((route) => { const [provider, ...modelParts] = route.trim().split(':'); return { provider: provider as 'groq' | 'gemini' | 'openai' | 'openrouter', model: modelParts.join(':').trim() }; }).filter((route) => route.provider && route.model))} placeholder="gemini:gemini-3.8-flash"/><small>List up to two approved backups in order. Enabling fallback permits authorized request content to be sent to those providers.</small></label>}
          <p className="assistant-provider-status assistant-span-two" role="status">{providerStatus ? (['groq', 'gemini', 'openai', 'openrouter'] as const).map((provider) => `${provider === 'gemini' ? 'Google Gemini' : provider === 'groq' ? 'Groq' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'}: ${providerStatus[provider].keyConfigured ? 'key configured · connectivity not verified' : 'backend key missing'}`).join(' · ') : 'Provider key status is unavailable.'}</p>
          {providerStatus?.effective.provider === 'openrouter' && <div className="assistant-provider-status assistant-span-two" role="status"><span>OpenRouter model: {providerStatus.openrouter.modelValidation?.toolCalling || 'UNVERIFIED'}{providerStatus.openrouter.modelValidation?.checkedAt ? ` · checked ${dateLabel(providerStatus.openrouter.modelValidation.checkedAt)}` : ''}</span>{manager && <button type="button" className="button button-secondary" disabled={validatingOpenRouter || saving || !providerStatus.openrouter.keyConfigured} onClick={() => void runOpenRouterValidation()}>{validatingOpenRouter ? 'Checking model…' : 'Validate OpenRouter model'}</button>}{openRouterValidation && <small>{openRouterValidation}</small>}</div>}
        </>}
      </div>
      {fieldError && <p className="workspace-form-error" role="alert">{fieldError}</p>}
      {manager && <div className="assistant-form-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={() => creating ? navigate(`/workspace/${encodeURIComponent(workspace.slug)}/assistants`) : (setInput(fromAssistant(assistant!)), setEditing(false), setError(''))}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : <><Save size={15}/>{creating ? 'Create assistant' : 'Save changes'}</>}</button></div>}
    </form> : assistant && <><section className="workspace-panel assistant-read-view"><AssistantValue label="Provider and model" value={effectiveProviderLabel(assistant.effectiveProviderConfiguration)}/><AssistantValue label="Description" value={assistant.description}/><AssistantValue label="Business purpose" value={assistant.businessPurpose}/><AssistantValue label="Instructions" value={assistant.systemInstructions}/><div className="assistant-value-grid"><AssistantValue label="Default language" value={assistant.defaultLanguage}/><AssistantValue label="Response tone" value={assistant.responseTone}/></div><AssistantValue label="Fallback message" value={assistant.fallbackMessage}/><small>Created {dateLabel(assistant.createdAt)} · Updated {dateLabel(assistant.updatedAt)}</small></section><KnowledgeBaseAssignments assistantId={assistant.id}/><KnowledgeAssignments assistantId={assistant.id}/></>}
  </>;
}

function fromAssistant(assistant: Assistant): AssistantInput {
  return { name: assistant.name, description: assistant.description || '', businessPurpose: assistant.businessPurpose || '', systemInstructions: assistant.systemInstructions || '', defaultLanguage: assistant.defaultLanguage, responseTone: assistant.responseTone, fallbackMessage: assistant.fallbackMessage, providerMode: assistant.providerMode || 'MANUAL', providerFallbacks: assistant.providerFallbacks || [] };
}

function effectiveProviderLabel(config: EffectiveProviderConfiguration | undefined) {
  if (!config?.provider || !config.model) return `Not configured · ${config?.status || 'status unavailable'}`;
  const name = config.provider === 'gemini' ? 'Google Gemini' : config.provider === 'groq' ? 'Groq' : config.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
  return `${name} · ${config.model} · ${config.ready ? 'key configured' : config.status}`;
}

function AssistantValue({ label, value }: { label: string; value: string | null }) {
  return <div className="assistant-value"><strong>{label}</strong><p>{value || 'Not provided'}</p></div>;
}

function KnowledgeBaseAssignments({ assistantId }: { assistantId: string }) {
  const { workspace } = useWorkspaceRoute();
  const manager = canManage(workspace.role);
  const [data, setData] = useState<AssistantKnowledgeBases | null>(null);
  const [effectiveKnowledge, setEffectiveKnowledge] = useState<EffectiveKnowledge | null>(null);
  const [effectiveKnowledgeError, setEffectiveKnowledgeError] = useState('');
  const [effectiveKnowledgeLoading, setEffectiveKnowledgeLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [workspacePolicySaving, setWorkspacePolicySaving] = useState(false);
  const [reload, setReload] = useState(0);
  const initialKey = useRef('');
  const key = `${workspace.slug}:${assistantId}`;
  useEffect(() => { setData(null); setSelected([]); initialKey.current = ''; }, [key]);
  useEffect(() => { setPage(1); }, [search, key]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getAssistantKnowledgeBases(workspace.slug, assistantId, { search, page, pageSize: 20 }, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setData(result);
        if (initialKey.current !== key) { setSelected(result.linked.map((base) => base.id)); initialKey.current = key; }
      }
    }).catch((cause) => { if (!controller.signal.aborted) setError(safeMessage(cause, 'We could not load linked Knowledge Bases.')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, assistantId, search, page, reload]);
  useEffect(() => {
    const controller = new AbortController();
    setEffectiveKnowledge(null); setEffectiveKnowledgeLoading(true); setEffectiveKnowledgeError('');
    getEffectiveKnowledge(workspace.slug, assistantId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setEffectiveKnowledge(result); })
      .catch((cause) => { if (!controller.signal.aborted) setEffectiveKnowledgeError(safeMessage(cause, 'We could not load effective knowledge access.')); })
      .finally(() => { if (!controller.signal.aborted) setEffectiveKnowledgeLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, assistantId, reload]);
  const linkedIds = new Set(data?.linked.map((base) => base.id) || []);
  const dirty = selected.length !== linkedIds.size || selected.some((id) => !linkedIds.has(id));
  async function save() {
    if (saving || !dirty) return;
    setSaving(true); setError(''); setSuccess('');
    try { const result = await replaceAssistantKnowledgeBases(workspace.slug, assistantId, selected); setData((current) => current ? { ...current, linked: result.linked } : current); setSelected(result.linked.map((base) => base.id)); setReload((value) => value + 1); setSuccess('Knowledge Base links saved. Direct source links were preserved.'); }
    catch (cause) { setError(safeMessage(cause, 'We could not save Knowledge Base links. No partial changes were applied.')); }
    finally { setSaving(false); }
  }
  async function setWorkspaceKnowledgePolicy(enabled: boolean) {
    if (workspacePolicySaving || !manager) return;
    setWorkspacePolicySaving(true); setError(''); setSuccess('');
    try {
      const saved = await updateAssistant(workspace.slug, assistantId, { useAllEligibleWorkspaceKnowledge: enabled });
      setEffectiveKnowledge((current) => current ? { ...current, useAllEligibleWorkspaceKnowledge: saved.useAllEligibleWorkspaceKnowledge, resolution: enabled ? 'ALL_ELIGIBLE_WORKSPACE_KNOWLEDGE' : current.resolution } : current);
      setReload((value) => value + 1);
      setSuccess(enabled ? 'Automatic workspace knowledge access enabled. Eligible public indexed sources are now available to this assistant.' : 'Automatic workspace knowledge access disabled. Existing direct and Knowledge Base assignments remain in effect.');
    } catch (cause) { setError(safeMessage(cause, 'The workspace knowledge access setting could not be saved.')); }
    finally { setWorkspacePolicySaving(false); }
  }
  return <section className="workspace-panel assistant-knowledge-panel"><div className="workspace-panel-heading"><div><h2>Knowledge access</h2><p>Manage Knowledge Base access or enable one assistant-level policy for all eligible public workspace knowledge.</p></div>{manager && <button className="button button-primary" onClick={() => setManageOpen((open) => !open)}>{manageOpen ? 'Close picker' : 'Manage Knowledge Base access'}</button>}</div>
    {workspace.role === 'owner' ? <label className="kb-select-all"><span><strong>Use all eligible workspace knowledge</strong><small>Includes existing and future PUBLIC FAQ, text and website sources only when indexed and authorized. Restricted/private sources remain unavailable. Direct and Knowledge Base assignments are preserved.</small></span><input aria-label="Use all eligible workspace knowledge" type="checkbox" checked={Boolean(effectiveKnowledge?.useAllEligibleWorkspaceKnowledge)} disabled={workspacePolicySaving || effectiveKnowledgeLoading || Boolean(effectiveKnowledgeError)} onChange={(event) => void setWorkspaceKnowledgePolicy(event.target.checked)}/></label> : <p className="knowledge-footnote">Only the workspace owner can change all-workspace knowledge access. Admins and members can still view effective access according to their role.</p>}
    <div className="assistant-knowledge-effective" aria-label="Effective knowledge availability"><h3>Effective knowledge for this assistant</h3>
      {effectiveKnowledgeLoading ? <p role="status">Checking knowledge availability…</p> : effectiveKnowledgeError ? <p className="workspace-form-error" role="alert">{effectiveKnowledgeError}</p> : effectiveKnowledge ? <>
        {effectiveKnowledge.knowledgeBases.length ? <div className="assistant-knowledge-list">{effectiveKnowledge.knowledgeBases.map((base) => <article className="assistant-knowledge-row" key={base.id}><span><strong>{base.name}</strong><small>{base.assignment === 'WORKSPACE_DEFAULT' ? 'Workspace default · automatic for active assistants' : 'Explicit assistant assignment'} · {base.eligibleSourceCount} ready public source(s)</small></span><Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/knowledge/${encodeURIComponent(base.id)}`}>View Knowledge</Link></article>)}</div> : effectiveKnowledge.useAllEligibleWorkspaceKnowledge ? <p className="knowledge-footnote">Workspace-wide access is enabled. Current searchable sources are counted below, independently of Knowledge Base membership.</p> : <p className="knowledge-footnote">No eligible Knowledge Base is available to this assistant. In a workspace with multiple bases, link the intended base explicitly.</p>}
        <p className="knowledge-footnote">Effective searchable sources: {effectiveKnowledge.searchableSourceCount ?? effectiveKnowledge.effectiveSourceCount ?? effectiveKnowledge.sources.length}. Public knowledge retrieval: {effectiveKnowledge.retrievalEnabled ? 'available for authorized requests' : 'no ready public sources'}. Semantic indexes ready: {effectiveKnowledge.sources.filter((source) => source.semanticIndexStatus === 'READY').length}/{effectiveKnowledge.sources.length}. Search continues to use the configured hybrid or lexical path; this status does not assert vector retrieval for every source. Widget origin and session checks remain separate.</p>
        {effectiveKnowledge.blockedReasonCounts && Object.keys(effectiveKnowledge.blockedReasonCounts).length > 0 && <p className="knowledge-footnote">Sources excluded from automatic/public access: {Object.entries(effectiveKnowledge.blockedReasonCounts).map(([reason, count]) => `${reason.replaceAll('_', ' ').toLowerCase()} ${count}`).join(' · ')}.</p>}
      </> : null}
    </div>
    {error && <p className="workspace-form-error" role="alert">{error}</p>}{success && <p className="workspace-success" role="status">{success}</p>}
    {data?.linked.length ? <div className="assistant-knowledge-list">{data.linked.map((base) => <article className="assistant-knowledge-row kb-linked-card" key={base.id}><span><strong>{base.name}</strong><small>{base.faqCount} FAQs · {base.textCount} Text entries · {base.readyCount}/{base.sourceCount} ready · Linked</small>{base.sourceCount === 0 && <small className="kb-attention">No eligible FAQ or Text knowledge in this base yet.</small>}</span><div><Link className="button button-secondary" to={`/workspace/${encodeURIComponent(workspace.slug)}/knowledge/${encodeURIComponent(base.id)}`}>View Knowledge</Link>{manager && <button className="button button-secondary" disabled={saving} onClick={() => { setSelected(data.linked.filter((item) => item.id !== base.id).map((item) => item.id)); void (async () => { setSaving(true); setError(''); try { const result = await replaceAssistantKnowledgeBases(workspace.slug, assistantId, data.linked.filter((item) => item.id !== base.id).map((item) => item.id)); setData((current) => current ? { ...current, linked: result.linked } : current); setSuccess('Knowledge Base unlinked. Direct source links were preserved.'); setReload((value) => value + 1); } catch (cause) { setError(safeMessage(cause, 'We could not unlink this Knowledge Base.')); } finally { setSaving(false); } })(); }}>Unlink</button>}</div></article>)}</div> : !loading && <p className="knowledge-footnote">No Knowledge Bases are linked to this assistant yet.</p>}
    {manageOpen && <div className="kb-assistant-picker"><label className="kb-search"><Search size={14}/><input aria-label="Search Knowledge Bases" placeholder="Search Knowledge Bases" value={search} onChange={(event) => setSearch(event.target.value)}/></label>{loading ? <div className="assistant-loading" role="status"><span className="workspace-spinner"/>Loading Knowledge Bases…</div> : <div className="assistant-knowledge-list">{data?.available.map((base) => <label className="kb-assistant-option" key={base.id}><input type="checkbox" checked={selected.includes(base.id)} disabled={!manager || saving} onChange={() => setSelected((current) => current.includes(base.id) ? current.filter((id) => id !== base.id) : [...current, base.id])}/><span><strong>{base.name}</strong><small>{base.faqCount} FAQs · {base.textCount} Text entries · {base.readyCount}/{base.sourceCount} ready{base.status !== 'active' ? ` · ${base.status}` : ''}</small>{base.sourceCount === 0 && <small className="kb-attention">No eligible knowledge yet</small>}</span></label>)}</div>}{data && data.totalAvailable > 20 && <div className="kb-pagination"><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</button><span>Page {page} of {Math.ceil(data.totalAvailable / 20)}</span><button className="button button-secondary" disabled={page >= Math.ceil(data.totalAvailable / 20)} onClick={() => setPage((n) => n + 1)}>Next</button></div>}<div className="assistant-form-actions"><button className="button button-primary" disabled={!dirty || saving} onClick={() => void save()}><Save size={14}/>{saving ? 'Linking…' : 'Link selected bases'}</button></div></div>}
    {!manager && <p className="knowledge-footnote">Your workspace role allows viewing Knowledge Base links only.</p>}
    </section>;
}

function KnowledgeAssignments({ assistantId }: { assistantId: string }) {
  const { workspace } = useWorkspaceRoute();
  const [data, setData] = useState<AssistantKnowledge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setLoading(true); setError('');
    getAssistantKnowledge(workspace.slug, assistantId, controller.signal).then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(safeMessage(cause, 'We could not load this assistant’s knowledge sources.')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, assistantId]);
  const linked = data?.linked || [];
  return <details className="workspace-panel assistant-knowledge-panel assistant-legacy-knowledge"><summary><strong>Advanced: legacy direct source links</strong><span>Existing direct links remain active and are preserved.</span></summary>
    {error && <p className="workspace-form-error" role="alert">{error}</p>}
    {loading ? <div className="assistant-loading" role="status"><span className="workspace-spinner"/>Loading linked sources…</div> : <>
      {linked.length ? <div className="assistant-knowledge-list">{linked.map((source) => <div key={source.id} className="assistant-knowledge-row"><span><strong>{source.name}</strong><small>{source.type} · {source.processingStatus.replace('_', ' ')}</small></span></div>)}</div> : <p className="knowledge-footnote">No sources are linked to this assistant.</p>}
      {!linked.length && <p className="knowledge-footnote">There are no legacy direct links. Link a Knowledge Base above to provide assistant knowledge.</p>}
      {linked.some((source) => source.processingStatus !== 'ready') && <p className="knowledge-footnote">One or more linked sources are not processed and cannot be used for AI retrieval.</p>}
    </>}
  </details>;
}

export { SourceAssistantsPage as AssistantListPage } from '../source/SourceAssistantsPage';
