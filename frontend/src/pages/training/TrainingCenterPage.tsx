import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowRight, BookOpen, Bot, Check, CircleAlert, CircleCheck, Clock3, FileText, ListChecks, MessageSquare, Plus, RefreshCw, Save, Settings2, Shield, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../../services/api/client';
import { createAssistantRule, deleteAssistantRule, getAssistantTrainingHistory, getAssistantTrainingOverview, listAssistantRules, listAssistants, updateAssistant, updateAssistantRule, type Assistant, type AssistantAuditEvent, type AssistantRule, type AssistantTrainingOverview } from '../../services/api/assistants';
import { getAssistantKnowledgeBases, linkAssistantToKnowledgeBase, unlinkAssistantFromKnowledgeBase, type AssistantKnowledgeBases, type KnowledgeBase } from '../../services/api/knowledge-bases';
import { PlaygroundDialog } from './PlaygroundDialog';
import { PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';
import './training-center.css';

type Tab = 'overview' | 'knowledge' | 'behavior' | 'rules' | 'playground' | 'history';
type AssistantListState = { workspaceSlug: string; status: 'loading' | 'success' | 'error'; assistants: Assistant[]; error: string };
type KnowledgeLinksState = { requestKey: string; status: 'loading' | 'success' | 'error'; error: string };
const labels: Record<Tab, string> = { overview: 'Overview', knowledge: 'Knowledge', behavior: 'Bot Behavior', rules: 'Rules', playground: 'Playground', history: 'History' };
const trainingHistoryActions = ['assistant.created', 'assistant.behavior_updated', 'assistant.activated', 'assistant.deactivated', 'assistant.business_rule_created', 'assistant.business_rule_updated', 'assistant.business_rule_deleted', 'assistant.knowledge_base_linked', 'assistant.knowledge_base_unlinked', 'knowledge.faq_batch_created', 'knowledge.faq_imported', 'knowledge.source_linked', 'knowledge.source_unlinked', 'knowledge.processing_enqueued', 'knowledge_base.created', 'knowledge_base.updated', 'knowledge_base.archived', 'knowledge_base.source_added', 'knowledge_base.sources_added', 'knowledge_base.sources_removed', 'knowledge_base.assistant_linked', 'knowledge_base.assistant_unlinked'];
const historyDateBoundary = (value: string, endOfDay = false) => { const date = new Date(`${value}T00:00:00`); if (endOfDay) { date.setDate(date.getDate() + 1); date.setMilliseconds(-1); } return date.toISOString(); };
const safeError = (error: unknown) => error instanceof ApiError && error.kind === 'http' && error.status !== undefined && error.status < 500 ? error.message : 'We could not complete that request. Please try again.';
const emptyBehavior = (a: Assistant) => ({ name: a.name, description: a.description || '', businessPurpose: a.businessPurpose || '', defaultLanguage: a.defaultLanguage, responseTone: a.responseTone, responseStyle: a.responseStyle || 'balanced', systemInstructions: a.systemInstructions || '', fallbackMessage: a.fallbackMessage, greetingMessage: a.greetingMessage || '', escalationMessage: a.escalationMessage || '' });

export function TrainingCenterPage() {
  const { workspace } = useWorkspaceRoute();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialAssistantId = useRef(searchParams.get('assistantId'));
  const manager = workspace.role === 'owner' || workspace.role === 'admin';
  const [assistantList, setAssistantList] = useState<AssistantListState>({ workspaceSlug: '', status: 'loading', assistants: [], error: '' });
  const [assistantListRetry, setAssistantListRetry] = useState(0);
  const [knowledgeLinksRetry, setKnowledgeLinksRetry] = useState(0);
  const [assistantId, setAssistantId] = useState('');
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(() => requestedTab && Object.prototype.hasOwnProperty.call(labels, requestedTab) ? requestedTab as Tab : 'overview');
  const [overview, setOverview] = useState<AssistantTrainingOverview | null>(null);
  const [links, setLinks] = useState<AssistantKnowledgeBases | null>(null);
  const [baseSearch, setBaseSearch] = useState('');
  const [debouncedBaseSearch, setDebouncedBaseSearch] = useState('');
  const [basePage, setBasePage] = useState(1);
  const [pendingBaseIds, setPendingBaseIds] = useState<Set<string>>(new Set());
  const pendingBaseLocks = useRef(new Set<string>());
  const [rules, setRules] = useState<AssistantRule[]>([]);
  const [history, setHistory] = useState<AssistantAuditEvent[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [historyAction, setHistoryAction] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyRetry, setHistoryRetry] = useState(0);
  const [behavior, setBehavior] = useState<ReturnType<typeof emptyBehavior> | null>(null);
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleInstruction, setRuleInstruction] = useState('');
  const [editingRule, setEditingRule] = useState<AssistantRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [summaryRetry, setSummaryRetry] = useState(0);
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [summaryLoad, setSummaryLoad] = useState<{ workspaceSlug: string; assistantId: string; status: 'loading' | 'success' | 'error'; error: string }>({ workspaceSlug: '', assistantId: '', status: 'loading', error: '' });
  const [knowledgeLinksLoad, setKnowledgeLinksLoad] = useState<KnowledgeLinksState>({ requestKey: '', status: 'loading', error: '' });
  const loadedKnowledgeLinksKey = useRef('');
  const currentAssistantList = assistantList.workspaceSlug === workspace.slug ? assistantList : { workspaceSlug: workspace.slug, status: 'loading' as const, assistants: [], error: '' };
  const assistants = currentAssistantList.assistants;

  useEffect(() => { const controller = new AbortController(); loadedKnowledgeLinksKey.current = ''; setAssistantList({ workspaceSlug: workspace.slug, status: 'loading', assistants: [], error: '' }); setAssistantId(''); setAssistant(null); setOverview(null); setLinks(null); setBaseSearch(''); setDebouncedBaseSearch(''); setBasePage(1); setRules([]); setHistory([]); setBehavior(null); setEditingRule(null); setRuleTitle(''); setRuleInstruction(''); setError(''); listAssistants(workspace.slug, 1, controller.signal).then((data) => { if (!controller.signal.aborted) { setAssistantList({ workspaceSlug: workspace.slug, status: 'success', assistants: data.assistants, error: '' }); const requestedId = data.assistants.find((item) => item.id === initialAssistantId.current); setAssistantId(requestedId?.id ?? data.assistants[0]?.id ?? ''); } }).catch((e) => { if (!controller.signal.aborted) setAssistantList({ workspaceSlug: workspace.slug, status: 'error', assistants: [], error: safeError(e) }); }); return () => controller.abort(); }, [workspace.slug, assistantListRetry]);
  useEffect(() => { if (!assistantId) { setAssistant(null); setOverview(null); setLinks(null); return; } const controller = new AbortController(); setSummaryLoad({ workspaceSlug: workspace.slug, assistantId, status: 'loading', error: '' }); setRules([]); setHistory([]); getAssistantTrainingOverview(workspace.slug, assistantId, controller.signal).then((summary) => { if (controller.signal.aborted) return; setAssistant(summary.assistant); setBehavior((current) => assistant?.id === summary.assistant.id ? current : emptyBehavior(summary.assistant)); setOverview(summary); setSummaryLoad({ workspaceSlug: workspace.slug, assistantId, status: 'success', error: '' }); }).catch((e) => { if (!controller.signal.aborted) setSummaryLoad({ workspaceSlug: workspace.slug, assistantId, status: 'error', error: safeError(e) }); }); return () => controller.abort(); }, [workspace.slug, assistantId, summaryRetry]);
  const knowledgeLinksKey = `${workspace.slug}:${assistantId}`;
  const activeKnowledgeLinksKey = useRef(knowledgeLinksKey);
  activeKnowledgeLinksKey.current = knowledgeLinksKey;
  useEffect(() => { const timer = setTimeout(() => { setDebouncedBaseSearch(baseSearch.trim()); setBasePage(1); }, 250); return () => clearTimeout(timer); }, [baseSearch, assistantId]);
  const knowledgeRequestKey = `${knowledgeLinksKey}:${debouncedBaseSearch}:${basePage}`;
  useEffect(() => { if (!assistantId || tab !== 'knowledge') return; const controller = new AbortController(); const includeLinked = loadedKnowledgeLinksKey.current !== knowledgeLinksKey; setKnowledgeLinksLoad({ requestKey: knowledgeRequestKey, status: 'loading', error: '' }); getAssistantKnowledgeBases(workspace.slug, assistantId, { search: debouncedBaseSearch, page: basePage, pageSize: 20, includeLinked: String(includeLinked) }, controller.signal).then((result) => { if (controller.signal.aborted) return; setLinks((current) => ({ linked: includeLinked ? result.linked : current?.linked ?? [], available: result.available, totalAvailable: result.totalAvailable, page: result.page, pageSize: result.pageSize })); if (includeLinked) loadedKnowledgeLinksKey.current = knowledgeLinksKey; setKnowledgeLinksLoad({ requestKey: knowledgeRequestKey, status: 'success', error: '' }); }).catch((e) => { if (!controller.signal.aborted) setKnowledgeLinksLoad({ requestKey: knowledgeRequestKey, status: 'error', error: safeError(e) }); }); return () => controller.abort(); }, [workspace.slug, assistantId, tab, knowledgeLinksRetry, knowledgeLinksKey, debouncedBaseSearch, basePage, knowledgeRequestKey]);
  useEffect(() => { if (!assistantId || tab !== 'rules') return; const controller = new AbortController(); setRecordsLoading(true); listAssistantRules(workspace.slug, assistantId, controller.signal).then((result) => { if (!controller.signal.aborted) setRules(result); }).catch((e) => { if (!controller.signal.aborted) setError(safeError(e)); }).finally(() => { if (!controller.signal.aborted) setRecordsLoading(false); }); return () => controller.abort(); }, [workspace.slug, assistantId, tab]);
  useEffect(() => { if (!assistantId || tab !== 'history') return; const controller = new AbortController(); setHistoryLoading(true); setHistoryError(''); getAssistantTrainingHistory(workspace.slug, assistantId, { page: historyPage, pageSize: historyPageSize, ...(historyAction ? { action: historyAction } : {}), ...(historyFrom ? { from: historyDateBoundary(historyFrom) } : {}), ...(historyTo ? { to: historyDateBoundary(historyTo, true) } : {}) }, controller.signal).then((result) => { if (!controller.signal.aborted) { setHistory(result.events); setHistoryTotal(result.total); setHistoryPageSize(result.pageSize); } }).catch((e) => { if (!controller.signal.aborted) setHistoryError(safeError(e)); }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); }); return () => controller.abort(); }, [workspace.slug, assistantId, tab, historyPage, historyPageSize, historyAction, historyFrom, historyTo, historyRetry]);

  const currentSummaryLoad = summaryLoad.workspaceSlug === workspace.slug && summaryLoad.assistantId === assistantId ? summaryLoad : { workspaceSlug: workspace.slug, assistantId, status: 'loading' as const, error: '' };
  const currentKnowledgeLinksLoad = knowledgeLinksLoad.requestKey === knowledgeRequestKey ? knowledgeLinksLoad : { requestKey: knowledgeRequestKey, status: 'loading' as const, error: '' };
  const linkedKnowledgeBase = overview?.linkedKnowledgeBases[0];
  function changeAssistant(id: string) {
    initialAssistantId.current = id;
    setError(''); setMessage('');
    loadedKnowledgeLinksKey.current = ''; setLinks(null); setBasePage(1); setBaseSearch(''); setDebouncedBaseSearch('');
    setHistoryPage(1); setHistoryError('');
    setAssistantId(id);
    setSearchParams((current) => { const next = new URLSearchParams(current); if (id) next.set('assistantId', id); else next.delete('assistantId'); return next; }, { replace: true });
  }
  function openKnowledgeAction(action: 'faq' | 'import' | 'text') {
    if (!manager || !linkedKnowledgeBase || !assistant) { setTab('knowledge'); setMessage('Link an active Knowledge Base to this assistant before adding knowledge.'); return; }
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('assistantId', assistant.id); return next; }, { replace: true });
    navigate(`/workspace/${encodeURIComponent(workspace.slug)}/knowledge/${encodeURIComponent(linkedKnowledgeBase.id)}?assistantId=${encodeURIComponent(assistant.id)}&action=${action}`);
  }

  async function saveBehavior(event: FormEvent) {
    event.preventDefault();
    if (!assistant || !behavior || !manager || busy) return;
    const selectedKey = knowledgeLinksKey;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await updateAssistant(workspace.slug, assistant.id, { ...behavior, name: behavior.name.trim() });
      if (activeKnowledgeLinksKey.current !== selectedKey) return;
      setAssistant(updated); setBehavior(emptyBehavior(updated));
      setOverview((current) => current ? { ...current, assistant: updated, behaviorConfigured: Boolean(updated.businessPurpose?.trim() || updated.systemInstructions?.trim() || updated.greetingMessage?.trim() || updated.escalationMessage?.trim() || updated.responseTone !== 'professional' || updated.responseStyle !== 'balanced' || updated.defaultLanguage !== 'auto') } : current);
      setMessage('Behavior settings saved.');
    } catch (e) {
      if (activeKnowledgeLinksKey.current === selectedKey) setError(safeError(e));
    } finally { setBusy(false); }
  }
  async function setBaseLinked(base: KnowledgeBase, linked: boolean) {
    if (!assistant || !manager || pendingBaseLocks.current.has(base.id) || links?.linked.some((item) => item.id === base.id) === linked) return;
    pendingBaseLocks.current.add(base.id);
    const selectedAssistantId = assistant.id;
    const selectedWorkspace = workspace.slug;
    const selectedKey = knowledgeLinksKey;
    setPendingBaseIds((current) => new Set(current).add(base.id)); setError(''); setMessage('');
    try {
      if (linked) await linkAssistantToKnowledgeBase(selectedWorkspace, base.id, selectedAssistantId);
      else await unlinkAssistantFromKnowledgeBase(selectedWorkspace, base.id, selectedAssistantId);
      if (activeKnowledgeLinksKey.current !== selectedKey) return;
      setLinks((current) => {
        if (!current) return current;
        const nextLinked = linked ? (current.linked.some((item) => item.id === base.id) ? current.linked : [...current.linked, base]) : current.linked.filter((item) => item.id !== base.id);
        const nextAvailable = linked ? current.available.filter((item) => item.id !== base.id) : current.available;
        return { ...current, linked: nextLinked, available: nextAvailable, totalAvailable: Math.max(0, current.totalAvailable + (linked ? -1 : 1)) };
      });
      setKnowledgeLinksRetry((current) => current + 1);
      setSummaryRetry((current) => current + 1);
      setMessage(linked ? 'Knowledge Base linked. Its eligible sources remain shared.' : 'Knowledge Base unlinked. Direct source links were preserved.');
    } catch (e) { if (activeKnowledgeLinksKey.current === selectedKey) setError(safeError(e)); }
    finally { pendingBaseLocks.current.delete(base.id); setPendingBaseIds((current) => { const next = new Set(current); next.delete(base.id); return next; }); }
  }
  async function addRule(event: FormEvent) { event.preventDefault(); if (!assistant || !manager || busy) return; setBusy(true); setError(''); try { if (editingRule) { const updated = await updateAssistantRule(workspace.slug, assistant.id, editingRule.id, { title: ruleTitle, instruction: ruleInstruction }); setRules((current) => current.map((rule) => rule.id === updated.id ? updated : rule)); setMessage('Rule updated.'); } else { const rule = await createAssistantRule(workspace.slug, assistant.id, { title: ruleTitle, instruction: ruleInstruction }); setRules((current) => [rule, ...current]); setMessage('Rule saved as assistant configuration.'); } setSummaryRetry((current) => current + 1); setEditingRule(null); setRuleTitle(''); setRuleInstruction(''); } catch (e) { setError(safeError(e)); } finally { setBusy(false); } }
  async function toggleRule(rule: AssistantRule) { if (!assistant || !manager || busy) return; setBusy(true); try { const updated = await updateAssistantRule(workspace.slug, assistant.id, rule.id, { enabled: !rule.enabled }); setRules((current) => current.map((item) => item.id === updated.id ? updated : item)); setSummaryRetry((current) => current + 1); } catch (e) { setError(safeError(e)); } finally { setBusy(false); } }
  async function removeRule(rule: AssistantRule) { if (!assistant || !manager || !window.confirm(`Remove the rule “${rule.title}”?`)) return; try { await deleteAssistantRule(workspace.slug, assistant.id, rule.id); setRules((current) => current.filter((item) => item.id !== rule.id)); setSummaryRetry((current) => current + 1); } catch (e) { setError(safeError(e)); } }

  if (currentAssistantList.status === 'loading') return <TrainingOverviewSkeleton />;
  if (currentAssistantList.status === 'error') return <section className="workspace-panel training-empty"><p role="alert">{currentAssistantList.error}</p><button className="button button-secondary" onClick={() => setAssistantListRetry((current) => current + 1)}>Try again</button></section>;
  if (assistants.length === 0) return <section className="workspace-panel training-empty"><Bot/><h1>Create an assistant to start training</h1><p>Assistant settings, knowledge links and rules will live here.</p><Link className="button button-primary" to={`/workspace/${encodeURIComponent(workspace.slug)}/assistants`}>Open AI Assistants</Link></section>;
  if (currentSummaryLoad.status === 'loading' && (!overview || overview.assistant.id !== assistantId)) return <TrainingOverviewSkeleton />;
  if (currentSummaryLoad.status === 'error' && (!overview || overview.assistant.id !== assistantId)) return <section className="workspace-panel training-empty"><p role="alert">{currentSummaryLoad.error}</p><button className="button button-secondary" onClick={() => setSummaryRetry((current) => current + 1)}><RefreshCw size={15}/> Try again</button></section>;
  if (!assistant || !overview) return <TrainingOverviewSkeleton />;
  return <main className="training-page">
    <PageHeader eyebrow="Assistant Workspace" title="AI Training" desc="Manage what your assistant knows and how it should communicate." action={<label className="workspace-field training-assistant-select">AI Assistant<select aria-label="Select AI assistant" value={assistantId} onChange={(e) => changeAssistant(e.target.value)}>{assistants.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}/>
    {error && <div className="workspace-form-error" role="alert">{error}</div>}{message && <p className="workspace-success" role="status">{message}</p>}
    {currentSummaryLoad.status === 'error' && <div className="workspace-form-error" role="alert">Summary refresh failed: {currentSummaryLoad.error} <button type="button" className="button button-secondary" onClick={() => setSummaryRetry((current) => current + 1)}>Retry summary</button></div>}
    <nav className="training-tabs" aria-label="AI Training sections">{(Object.keys(labels) as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} aria-current={tab === item ? 'page' : undefined} onClick={() => { setTab(item); setSearchParams((current) => { const next = new URLSearchParams(current); item === 'overview' ? next.delete('tab') : next.set('tab', item); return next; }, { replace: true }); setError(''); setMessage(''); }}>{labels[item]}</button>)}</nav>
    {currentSummaryLoad.status === 'loading' && <p className="training-note" role="status"><span className="workspace-spinner"/> Refreshing assistant summary…</p>}
    {!assistant ? <TrainingOverviewSkeleton /> : <>
      {tab === 'overview' && <div className="training-dashboard">
        <section className="overview-assistant-hero">
          <div className="overview-identity"><span className="overview-kicker">ASSISTANT OVERVIEW</span><h2>{assistant.name}</h2><p>{assistant.businessPurpose || assistant.description || 'Add a purpose to clarify what this assistant helps customers with.'}</p><div className="overview-meta"><span className={`assistant-status assistant-status-${assistant.status}`}>{assistant.status}</span><span>{effectiveProviderLabel(assistant)}</span><span>Updated {new Date(assistant.updatedAt).toLocaleDateString()}</span></div></div>
          <div className="overview-hero-actions"><button className="button button-primary" onClick={() => setTab('playground')}><MessageSquare size={15}/> {manager ? 'Test Assistant' : 'View Playground'}</button><button className="button button-secondary" onClick={() => setTab('behavior')}><Settings2 size={15}/> {manager ? 'Edit Bot Behavior' : 'View Bot Behavior'}</button></div>
        </section>

        <section className="overview-summary-grid" aria-label="Assistant summary">
          <SummaryCard icon={<BookOpen/>} label="Total Knowledge" value={overview.totalKnowledge} detail={`${overview.faqCount} questions & answers · ${overview.textCount} text items`} />
          <SummaryCard icon={<CircleCheck/>} label="Knowledge Ready" value={overview.readyCount} detail="Indexed and available to retrieval" />
          <SummaryCard icon={<ListChecks/>} label="Active Rules" value={overview.activeRuleCount} detail={`${overview.disabledRuleCount} disabled`} />
          <SummaryCard icon={<CircleAlert/>} label="Needs Attention" value={overview.attentionCount} detail={`${overview.processingCount} processing · ${overview.notIndexedCount} not indexed · ${overview.failedCount} failed`} attention={overview.attentionCount > 0} />
        </section>

        <div className="overview-content-grid">
          <section className="overview-card overview-knowledge-card">
            <div className="overview-card-heading"><div><span className="overview-kicker">KNOWLEDGE HEALTH</span><h3>Knowledge breakdown</h3><p>Only active FAQ and Text sources linked to this assistant are counted.</p></div><button className="overview-text-action" onClick={() => setTab('knowledge')}>Manage Knowledge <ArrowRight size={14}/></button></div>
            <div className="overview-type-grid"><div><span>Questions &amp; Answers</span><strong>{overview.faqCount}</strong></div><div><span>Text Knowledge</span><strong>{overview.textCount}</strong></div></div>
            <div className="overview-health-list"><HealthRow label="Ready" value={overview.readyCount} total={overview.totalKnowledge} tone="ready"/><HealthRow label="Processing" value={overview.processingCount} total={overview.totalKnowledge} tone="processing"/><HealthRow label="Not indexed" value={overview.notIndexedCount} total={overview.totalKnowledge} tone="pending"/><HealthRow label="Failed" value={overview.failedCount} total={overview.totalKnowledge} tone="failed"/></div>
            {!overview.totalKnowledge && <p className="overview-empty-note">No active FAQ or Text knowledge is linked yet.</p>}
          </section>

          <section className="overview-card overview-setup-card">
            <div className="overview-card-heading"><div><span className="overview-kicker">GETTING STARTED</span><h3>Assistant setup</h3></div></div>
            <div className="overview-checklist">
              <SetupStep label="Assistant created" done/>
              <SetupStep label="Knowledge linked" done={overview.totalKnowledge > 0 || overview.linkedKnowledgeBaseCount > 0} onAction={() => setTab('knowledge')} />
              <SetupStep label="Knowledge indexed" done={overview.totalKnowledge > 0 && overview.readyCount === overview.totalKnowledge} onAction={() => setTab('knowledge')} />
              <SetupStep label="Bot Behavior configured" done={overview.behaviorConfigured} onAction={() => setTab('behavior')} />
              <SetupStep label="AI provider configured" done={Boolean(assistant.effectiveProviderConfiguration?.ready)} detail={effectiveProviderLabel(assistant)} onAction={() => setTab('playground')} />
              <SetupStep label="Business rules" done={overview.activeRuleCount + overview.disabledRuleCount > 0} optional onAction={() => setTab('rules')} />
            </div>
            <p className="overview-footnote">Provider and model are server-managed. A configured key does not confirm provider connectivity.</p>
          </section>

          <section className="overview-card overview-behavior-card">
            <div className="overview-card-heading"><div><span className="overview-kicker">SAVED PREFERENCES</span><h3>Bot Behavior</h3></div><button className="overview-text-action" onClick={() => setTab('behavior')}>{manager ? 'Edit Behavior' : 'View Behavior'} <ArrowRight size={14}/></button></div>
            <div className="overview-behavior-grid"><BehaviorValue label="Language" value={assistant.defaultLanguage === 'auto' ? 'Automatic' : assistant.defaultLanguage === 'en' ? 'English' : assistant.defaultLanguage === 'hi' ? 'Hindi' : assistant.defaultLanguage === 'hi-Latn' ? 'Hinglish' : assistant.defaultLanguage}/><BehaviorValue label="Tone" value={assistant.responseTone}/><BehaviorValue label="Response style" value={assistant.responseStyle}/><BehaviorValue label="Custom instructions" value={overview.hasCustomInstructions ? 'Configured' : 'Not configured'}/><BehaviorValue label="Greeting" value={overview.hasGreeting ? 'Configured' : 'Not configured'}/><BehaviorValue label="Fallback message" value={overview.hasCustomFallback ? 'Customized' : 'Default message'}/></div>
            {overview.hasCustomInstructions && <details className="overview-instructions"><summary>View custom instructions</summary><p>{assistant.systemInstructions}</p></details>}
          </section>

          <section className="overview-card overview-rules-card">
            <div className="overview-card-heading"><div><span className="overview-kicker">BUSINESS CONFIGURATION</span><h3>Business Rules</h3><p>{overview.activeRuleCount} active · {overview.disabledRuleCount} disabled</p></div><button className="overview-text-action" onClick={() => setTab('rules')}>{manager ? 'Manage Rules' : 'View Rules'} <ArrowRight size={14}/></button></div>
            {overview.activeRulesPreview.length ? <ul className="overview-rule-list">{overview.activeRulesPreview.map((rule) => <li key={rule.id}><strong>{rule.title}</strong><p>{rule.instruction}</p></li>)}</ul> : <p className="overview-empty-note">No active business rules yet. Rules are optional guidance and do not replace platform security.</p>}
          </section>

          <section className="overview-card overview-activity-card">
            <div className="overview-card-heading"><div><span className="overview-kicker">WORKSPACE AUDIT</span><h3>Recent Activity</h3></div><button className="overview-text-action" onClick={() => setTab('history')}>View History <ArrowRight size={14}/></button></div>
            {overview.recentActivity.length ? <ul className="overview-activity-list">{overview.recentActivity.map((event) => <li key={event.id}><span className="overview-activity-icon"><Activity size={15}/></span><div><strong>{activityLabel(event.action)}</strong><small>{event.actorUser?.name || event.actorUser?.email || 'Workspace member'} · {new Date(event.createdAt).toLocaleString()}</small></div></li>)}</ul> : <p className="overview-empty-note">No recent assistant training activity has been recorded.</p>}
          </section>

          <section className="overview-card overview-quick-card">
            <div className="overview-card-heading"><div><span className="overview-kicker">NEXT STEPS</span><h3>Quick Actions</h3></div></div>
            <div className="overview-quick-grid">
              {manager && <><QuickAction icon={<Plus/>} label="Add FAQ" onClick={() => openKnowledgeAction('faq')}/><QuickAction icon={<Upload/>} label="Import Excel / CSV" onClick={() => openKnowledgeAction('import')}/><QuickAction icon={<FileText/>} label="Add Text Knowledge" onClick={() => openKnowledgeAction('text')}/></>}
              <QuickAction icon={<Settings2/>} label={manager ? 'Configure Behavior' : 'View Behavior'} onClick={() => setTab('behavior')}/>
              <QuickAction icon={<Shield/>} label={manager ? 'Manage Rules' : 'View Rules'} onClick={() => setTab('rules')}/>
              <QuickAction icon={<MessageSquare/>} label="Open Playground" onClick={() => setTab('playground')}/>
            </div>
            {manager && !linkedKnowledgeBase && <p className="overview-footnote">Link an active Knowledge Base in Manage Knowledge before adding FAQ or Text items.</p>}
          </section>
        </div>
      </div>}
      {tab === 'knowledge' && <section className="workspace-panel training-panel training-knowledge-panel" aria-busy={currentKnowledgeLinksLoad.status === 'loading'}><div className="workspace-panel-heading"><div><h2>Knowledge Bases</h2><p>Link reusable collections once. New FAQ and Text entries are included after indexing; visibility and access rules stay in force.</p></div></div><label className="training-base-search"><span>Search Knowledge Bases</span><input type="search" value={baseSearch} onChange={(event) => setBaseSearch(event.target.value)} placeholder="Search by base name" aria-describedby="training-base-search-help"/><small id="training-base-search-help">Search available bases by name. Linked bases remain listed below.</small></label>{currentKnowledgeLinksLoad.status === 'loading' && <div className="training-note" role="status" aria-live="polite"><span className="workspace-spinner"/> Loading Knowledge Bases…</div>}{currentKnowledgeLinksLoad.status === 'error' && <div className="training-empty"><p role="alert">{currentKnowledgeLinksLoad.error}</p><button className="button button-secondary" onClick={() => setKnowledgeLinksRetry((current) => current + 1)}><RefreshCw size={15}/> Try again</button></div>}{links && <><h3 className="training-base-section-title">Linked Knowledge Bases <span>{links.linked.length}</span></h3>{links.linked.map((base) => <KnowledgeBaseLinkRow key={base.id} base={base} linked pending={pendingBaseIds.has(base.id)} manager={manager} workspaceSlug={workspace.slug} onLink={() => void setBaseLinked(base, false)}/>)}{!links.linked.length && <p className="training-note">No Knowledge Bases are linked to this assistant yet.</p>}<h3 className="training-base-section-title">Available Knowledge Bases <span>{links.totalAvailable}</span></h3>{links.available.map((base) => <KnowledgeBaseLinkRow key={base.id} base={base} linked={false} pending={pendingBaseIds.has(base.id)} manager={manager} workspaceSlug={workspace.slug} onLink={() => void setBaseLinked(base, true)}/>)}{!links.available.length && <p className="training-note" role="status">{debouncedBaseSearch ? 'No available Knowledge Bases match this search.' : 'No available Knowledge Bases.'}</p>}{links.totalAvailable > links.pageSize && <div className="kb-pagination training-base-pagination"><span>Page {links.page} of {Math.ceil(links.totalAvailable / links.pageSize)} · {links.totalAvailable} available</span><div><button className="button button-secondary" disabled={basePage <= 1 || currentKnowledgeLinksLoad.status === 'loading'} onClick={() => setBasePage((current) => Math.max(1, current - 1))}>Previous</button><button className="button button-secondary" disabled={basePage >= Math.ceil(links.totalAvailable / links.pageSize) || currentKnowledgeLinksLoad.status === 'loading'} onClick={() => setBasePage((current) => current + 1)}>Next</button></div></div>}<p className="training-note">Changes to shared knowledge may affect every assistant linked to that Knowledge Base.</p></>}</section>}
      {tab === 'behavior' && behavior && <form className="workspace-panel training-panel training-form" onSubmit={(e) => void saveBehavior(e)}><div className="workspace-panel-heading"><div><h2>Bot Behavior</h2><p>Save communication preferences for the conversation engine.</p></div></div><label className="workspace-field">Display name<input maxLength={200} disabled={!manager || busy} value={behavior.name} onChange={(e) => setBehavior({ ...behavior, name: e.target.value })}/></label><label className="workspace-field">Assistant purpose<input maxLength={500} disabled={!manager || busy} value={behavior.businessPurpose} onChange={(e) => setBehavior({ ...behavior, businessPurpose: e.target.value })}/></label><label className="workspace-field">Business description<textarea maxLength={1000} rows={3} disabled={!manager || busy} value={behavior.description} onChange={(e) => setBehavior({ ...behavior, description: e.target.value })}/></label><div className="training-form-grid"><label className="workspace-field">Preferred language<input list="assistant-language-options" maxLength={35} disabled={!manager || busy} value={behavior.defaultLanguage} onChange={(e) => setBehavior({ ...behavior, defaultLanguage: e.target.value })} aria-describedby="assistant-language-help" placeholder="auto, en, ar, fr, pt-BR"/><datalist id="assistant-language-options"><option value="auto"/><option value="en"/><option value="hi"/><option value="hi-Latn"/><option value="ar"/><option value="fr"/><option value="es"/><option value="pt-BR"/></datalist><small id="assistant-language-help">Use auto to follow each customer, or enter a BCP 47 language tag such as ar, fr, es, or pt-BR. Latin-script Hindi uses hi-Latn.</small></label><label className="workspace-field">Tone<select disabled={!manager || busy} value={behavior.responseTone} onChange={(e) => setBehavior({ ...behavior, responseTone: e.target.value as Assistant['responseTone'] })}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="casual">Casual</option><option value="supportive">Supportive</option></select></label><label className="workspace-field">Response style<select disabled={!manager || busy} value={behavior.responseStyle} onChange={(e) => setBehavior({ ...behavior, responseStyle: e.target.value as Assistant['responseStyle'] })}><option value="short">Short</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label></div><label className="workspace-field">How should your assistant communicate?<textarea maxLength={10000} rows={5} disabled={!manager || busy} value={behavior.systemInstructions} onChange={(e) => setBehavior({ ...behavior, systemInstructions: e.target.value })}/></label><label className="workspace-field">Greeting<input maxLength={500} disabled={!manager || busy} value={behavior.greetingMessage} onChange={(e) => setBehavior({ ...behavior, greetingMessage: e.target.value })}/></label><label className="workspace-field">Fallback when information is missing<input maxLength={500} disabled={!manager || busy} value={behavior.fallbackMessage} onChange={(e) => setBehavior({ ...behavior, fallbackMessage: e.target.value })}/></label><label className="workspace-field">Human support message<input maxLength={500} disabled={!manager || busy} value={behavior.escalationMessage} onChange={(e) => setBehavior({ ...behavior, escalationMessage: e.target.value })}/></label>{manager && <div className="assistant-form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setBehavior(emptyBehavior(assistant))}>Cancel</button><button className="button button-primary" disabled={busy}><Save size={14}/>{busy ? 'Saving…' : 'Save behavior'}</button></div>}<p className="training-note">Automatic language detection follows the selected model's supported languages. Accuracy varies by language and context.</p></form>}
      {tab === 'rules' && <section className="workspace-panel training-panel"><div className="workspace-panel-heading"><div><h2>Business Rules</h2><p>Saved instructions guide future model orchestration. Platform privacy and authorization safeguards cannot be overridden.</p></div></div>{manager && <form className="training-rule-form" onSubmit={(e) => void addRule(e)}><label className="workspace-field">{editingRule ? 'Edit rule title' : 'Rule title'}<input required minLength={2} maxLength={160} value={ruleTitle} onChange={(e) => setRuleTitle(e.target.value)}/></label><label className="workspace-field">Instruction<textarea required minLength={3} maxLength={2000} rows={3} value={ruleInstruction} onChange={(e) => setRuleInstruction(e.target.value)}/></label><div className="assistant-form-actions">{editingRule && <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setEditingRule(null); setRuleTitle(''); setRuleInstruction(''); }}>Cancel edit</button>}<button className="button button-primary" disabled={busy}>{editingRule ? <Save size={14}/> : <Plus size={14}/>} {editingRule ? 'Save rule' : 'Add rule'}</button></div></form>}{recordsLoading && tab === 'rules' && <p className="training-note" role="status">Loading business rules…</p>}{rules.map((rule) => <article className="training-rule-row" key={rule.id}><Shield size={16}/><div><strong>{rule.title}</strong><p>{rule.instruction}</p></div><label><input type="checkbox" disabled={!manager || busy} checked={rule.enabled} onChange={() => void toggleRule(rule)}/> Enabled</label>{manager && <><button aria-label={`Edit ${rule.title}`} className="button button-secondary" onClick={() => { setEditingRule(rule); setRuleTitle(rule.title); setRuleInstruction(rule.instruction); }}><Settings2 size={14}/></button><button aria-label={`Remove ${rule.title}`} className="button button-secondary" onClick={() => void removeRule(rule)}><Trash2 size={14}/></button></>}</article>)}{!recordsLoading && !rules.length && <p>No business rules have been added yet.</p>}<p className="training-note">Rules are configuration records, not a guarantee of model compliance. They are not enforced until Phase 09 orchestration is implemented.</p></section>}
      {tab === 'playground' && <section className="workspace-panel training-panel playground-launcher" aria-labelledby="playground-launcher-title">
        <header className="playground-launcher-heading"><span className="overview-kicker">PLAYGROUND</span><h2 id="playground-launcher-title">Test your assistant</h2><p>Try real customer questions using saved behavior and linked public knowledge.</p></header>
        <article className="playground-assistant-card">
          <span className="playground-assistant-avatar" aria-hidden="true"><Bot size={22}/></span>
          <div className="playground-assistant-identity"><strong>{assistant.name}</strong><div className="playground-assistant-meta"><span className={`assistant-status assistant-status-${assistant.status}`}>{assistant.status}</span><span>{effectiveProviderLabel(assistant)}</span></div></div>
          <div className="playground-readiness" role="status"><CircleCheck size={15}/><span>{overview.playgroundReadyCount === undefined ? 'Knowledge readiness unavailable' : overview.playgroundReadyCount === 1 ? '1 public knowledge entry ready' : `${overview.playgroundReadyCount} public knowledge entries ready`}</span></div>
          {manager && <button type="button" className="button button-primary playground-open-button" onClick={() => setPlaygroundOpen(true)}><MessageSquare size={15}/> Open Chat</button>}
        </article>
        <p className="playground-launcher-footnote">Provider connectivity is checked when you send a message.</p>
        {!manager && <p className="training-note">Only workspace owners and admins can run Playground conversations.</p>}
      </section>}
      {tab === 'history' && <section className="workspace-panel training-panel training-history-panel" aria-busy={historyLoading}><div className="workspace-panel-heading"><div><h2>Training History</h2><p>Recorded changes for this assistant, newest first.</p></div></div><div className="training-history-filters"><label className="workspace-field">Action<select value={historyAction} onChange={(event) => { setHistoryAction(event.target.value); setHistoryPage(1); }}><option value="">All actions</option>{trainingHistoryActions.map((action) => <option key={action} value={action}>{activityLabel(action)}</option>)}</select></label><label className="workspace-field">From<input type="date" value={historyFrom} onChange={(event) => { setHistoryFrom(event.target.value); setHistoryPage(1); }}/></label><label className="workspace-field">To<input type="date" value={historyTo} onChange={(event) => { setHistoryTo(event.target.value); setHistoryPage(1); }}/></label></div>{historyError && <div className="workspace-form-error" role="alert">{historyError}<button type="button" className="button button-secondary" onClick={() => setHistoryRetry((current) => current + 1)}>Retry</button></div>}{historyLoading && <p className="training-note" role="status" aria-live="polite"><span className="workspace-spinner"/> Loading training history…</p>}{history.map((event) => <article className="training-history-row" key={event.id}><Clock3 size={15}/><div><strong>{activityLabel(event.action)}</strong><small>Related: {event.entityType.replaceAll('_', ' ')}{event.entityId ? ` · ${event.entityId}` : ''} · {event.actorUser?.name || event.actorUser?.email || 'System'} · <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></small></div></article>)}{!historyLoading && !historyError && !history.length && <p>No recorded assistant configuration changes match these filters.</p>}{historyTotal > historyPageSize && <div className="workspace-pagination training-history-pagination"><span>Page {historyPage} of {Math.ceil(historyTotal / historyPageSize)} · {historyTotal} events</span><div><button type="button" disabled={historyPage <= 1 || historyLoading} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}>Previous</button><button type="button" disabled={historyPage >= Math.ceil(historyTotal / historyPageSize) || historyLoading} onClick={() => setHistoryPage((current) => current + 1)}>Next</button></div></div>}</section>}
    </>}
    {playgroundOpen && <PlaygroundDialog workspaceSlug={workspace.slug} assistantId={assistant.id} manager={manager} onClose={() => setPlaygroundOpen(false)} onAssistantUpdated={(updated) => { setAssistant(updated); setBehavior(emptyBehavior(updated)); setOverview((current) => current ? { ...current, assistant: updated } : current); }}/>} 
  </main>;
}

function effectiveProviderLabel(assistant: Assistant) {
  const config = assistant.effectiveProviderConfiguration;
  if (!config?.provider || !config.model) return `Provider unavailable · ${config?.status || 'configuration unavailable'}`;
  const provider = config.provider === 'gemini' ? 'Google Gemini' : config.provider === 'groq' ? 'Groq' : config.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
  return `${provider} · ${config.model} · ${config.ready ? 'key configured' : config.status}`;
}

function TrainingOverviewSkeleton() {
  return <main className="training-page" role="status" aria-label="Loading AI Training overview">Loading assistant training overview…</main>;
}

function KnowledgeBaseLinkRow({ base, linked, pending, manager, workspaceSlug, onLink }: { base: KnowledgeBase; linked: boolean; pending: boolean; manager: boolean; workspaceSlug: string; onLink: () => void }) {
  const readiness = base.sourceCount === 0 ? 'No eligible FAQ or Text knowledge' : base.failedCount ? 'Needs attention' : base.readyCount === base.sourceCount ? 'Ready' : 'Preparing';
  return <article className={`training-base-row${linked ? ' is-linked' : ''}`} aria-busy={pending}>
    <div className="training-base-copy"><strong>{base.name}</strong><small>{base.faqCount} FAQs · {base.textCount} Text entries · {base.readyCount}/{base.sourceCount} ready · {readiness}{linked ? ' · Linked' : ''}</small></div>
    <Link className="training-base-view" to={`/workspace/${encodeURIComponent(workspaceSlug)}/knowledge/${encodeURIComponent(base.id)}`}>View Knowledge</Link>
    {manager && <button type="button" className="button button-secondary" disabled={pending} aria-label={`${linked ? 'Unlink' : 'Link'} ${base.name}`} onClick={onLink}>{pending ? linked ? 'Unlinking…' : 'Linking…' : linked ? 'Unlink' : 'Link base'}</button>}
  </article>;
}

function SummaryCard({ icon, label, value, detail, attention = false }: { icon: ReactNode; label: string; value: number; detail: string; attention?: boolean }) {
  return <article className={`overview-summary-card${attention ? ' overview-summary-attention' : ''}`}><span className="overview-summary-icon">{icon}</span><span className="overview-summary-label">{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function HealthRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: 'ready' | 'processing' | 'pending' | 'failed' }) {
  const width = total ? Math.min(100, (value / total) * 100) : 0;
  return <div className="overview-health-row"><div><span>{label}</span><strong>{value}</strong></div><div className="overview-health-track"><span className={`overview-health-fill overview-health-${tone}`} style={{ width: `${width}%` }}/></div></div>;
}

function SetupStep({ label, done, optional = false, detail, onAction }: { label: string; done: boolean; optional?: boolean; detail?: string; onAction?: () => void }) {
  return <div className="overview-setup-step"><span className={done ? 'overview-step-icon is-done' : 'overview-step-icon'}>{done ? <Check size={14}/> : <CircleAlert size={14}/>}</span><span className="overview-step-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>{done ? <span className="overview-step-status">Done</span> : optional ? <><span className="overview-step-status">Optional</span>{onAction && <button className="overview-step-action" onClick={onAction}>Review</button>}</> : onAction ? <button className="overview-step-action" onClick={onAction}>Set up</button> : <span className="overview-step-status">Needed</span>}</div>;
}

function BehaviorValue({ label, value }: { label: string; value: string }) {
  const formatted = value ? value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) : 'Not configured';
  return <div className="overview-behavior-value"><small>{label}</small><strong>{formatted}</strong></div>;
}

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button className="overview-quick-action" onClick={onClick}><span>{icon}</span><strong>{label}</strong><ArrowRight size={14}/></button>;
}

function activityLabel(action: string) {
  const labels: Record<string, string> = {
    'assistant.created': 'Assistant created',
    'assistant.behavior_updated': 'Bot Behavior updated',
    'assistant.activated': 'Assistant activated',
    'assistant.deactivated': 'Assistant deactivated',
    'assistant.business_rule_created': 'Business Rule created',
    'assistant.business_rule_updated': 'Business Rule changed',
    'assistant.business_rule_deleted': 'Business Rule removed',
    'assistant.knowledge_base_linked': 'Knowledge Base linked',
    'assistant.knowledge_base_unlinked': 'Knowledge Base unlinked',
    'assistant.knowledge_bases_replaced': 'Knowledge Base links updated',
    'knowledge.faq_created': 'FAQ added',
    'knowledge.faq_batch_created': 'FAQs added',
    'knowledge.faq_imported': 'FAQs imported',
    'knowledge.text_created': 'Text Knowledge added',
    'knowledge.source_updated': 'Knowledge source updated',
    'knowledge.source_linked': 'Knowledge linked to assistant',
    'knowledge.source_unlinked': 'Knowledge unlinked from assistant',
    'knowledge.processing_enqueued': 'Knowledge indexing started',
  };
  return labels[action] ?? action.replace(/^(assistant|knowledge)\./, '').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
