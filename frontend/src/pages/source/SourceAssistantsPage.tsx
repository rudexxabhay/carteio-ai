import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, Plus, RefreshCw } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { listAssistants, type Assistant } from '../../services/api/assistants';
import { getWorkspaceDashboardSummary } from '../../services/api/dashboard';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { Badge, Btn, Card, Empty, FilterInput, PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

export function SourceAssistantsPage() {
  const { workspace } = useWorkspaceRoute();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'DRAFT' | 'INACTIVE' | 'ARCHIVED'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const manager = workspace.role === 'owner' || workspace.role === 'admin';
  const root = `/workspace/${encodeURIComponent(workspace.slug)}`;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    Promise.allSettled([listAssistants(workspace.slug, page, controller.signal, status), getWorkspaceDashboardSummary(workspace.slug, controller.signal)])
      .then(([assistantResult, summaryResult]) => {
        if (controller.signal.aborted) return;
        if (assistantResult.status === 'fulfilled') { setAssistants(assistantResult.value.assistants); setTotal(assistantResult.value.total); }
        else setError(assistantResult.reason instanceof ApiError ? assistantResult.reason.message : 'Assistants could not be loaded.');
        if (summaryResult.status === 'fulfilled' && summaryResult.value.assistants.status === 'success') setCounts(Object.fromEntries((summaryResult.value.assistants.data?.items ?? []).map((item) => [item.id, item.linkedKnowledgeBaseCount + item.directKnowledgeCount])));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace.slug, status, page, retry]);

  const filtered = useMemo(() => assistants.filter((assistant) => `${assistant.name} ${assistant.description || ''} ${assistant.businessPurpose || ''}`.toLowerCase().includes(search.toLowerCase())), [assistants, search]);
  const create = () => navigate(`${root}/assistants/new`);
  return <>
    <PageHeader eyebrow="Train AI / Assistants" title="AI Assistants" desc={`Create and manage customer-facing assistants for ${workspace.name}.`} action={manager && <Btn onClick={create}><Plus size={16}/> Create assistant</Btn>}/>
    <div className="filter-line"><FilterInput value={search} onChange={setSearch} placeholder="Search your assistants..."/><div className="filter-pills">{([['ALL','All assistants'],['ACTIVE','Active'],['DRAFT','Draft'],['INACTIVE','Inactive'],['ARCHIVED','Archived']] as const).map(([value,label]) => <button type="button" key={value} className={'filter-pill '+(status===value?'active':'')} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div><button type="button" className="text-link" onClick={() => setRetry((value) => value + 1)} aria-label="Refresh assistants"><RefreshCw size={15}/></button></div>
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading assistants…</span><div className="dashboard-page-loading-metrics">{[0,1,2,3].map((item) => <i key={item}/>)}</div></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Assistants could not be loaded</strong><p>{error}</p><button className="btn btn-primary" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && filtered.length === 0 && <Empty title={search ? 'No matching assistants' : 'No assistants yet'} desc={search ? 'Try another name or description.' : 'Create an assistant to configure its authorized business experience.'}/>}
    {!loading && !error && filtered.length > 0 && <div className="assistant-grid">{filtered.map((assistant) => <Card key={assistant.id} className="assistant-card"><div className="assistant-head"><span className="circle-icon large"><Bot size={27}/></span><Badge tone={assistant.status === 'active' ? 'green' : assistant.status === 'draft' ? 'amber' : 'neutral'}>{assistant.status}</Badge></div><h3>{assistant.name}</h3><p>{assistant.description || assistant.businessPurpose || 'No description provided'}</p><hr/><div className="assistant-footer"><span>{counts[assistant.id] === undefined ? 'Knowledge count unavailable' : `${counts[assistant.id]} knowledge sources`}</span><span>Chat count unavailable</span></div><Link className="text-link" to={`${root}/assistants/${encodeURIComponent(assistant.id)}`}>Manage assistant <span aria-hidden="true">→</span></Link></Card>)}</div>}
    {!loading && !error && total > 100 && <div className="table-footer"><span>Page {page} of {Math.ceil(total / 100)} · {total} assistants</span><div className="action-line"><button type="button" className="text-link" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" className="text-link" disabled={page >= Math.ceil(total / 100)} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
    {!manager && <p className="page-footer">Assistant creation is available to workspace owners and admins.</p>}
  </>;
}
