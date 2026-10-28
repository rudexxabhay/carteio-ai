import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Headset, RefreshCw, Send } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { addTicketNote, assignTicket, getTicket, getTickets, replyToTicket, updateTicket, type TicketDetail, type TicketMessage, type TicketPage } from '../../services/api/saas';
import { Badge, Card, Empty, FilterInput, PageHeader, SectionHeader, Stat, TableWrap, Toggle, Notice } from '../../layouts/DashboardLayout/dashboard-v2-ui';

export function SourceTicketsPage() {
  const { slug = '', ticketId = '' } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState<TicketPage | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [page, setPage] = useState(1);
  const [reply, setReply] = useState('');
  const [replyKey, setReplyKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const root = `/workspace/${encodeURIComponent(slug)}`;

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getTickets(slug, { page, pageSize: 25, search, status, priority, assigneeId: assignee }, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setList(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Handoff cases could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, page, search, status, priority, assignee, retry]);

  useEffect(() => {
    if (!ticketId) { setDetail(null); return; }
    const controller = new AbortController(); setDetailLoading(true); setError('');
    getTicket(slug, ticketId, controller.signal).then((value) => { if (!controller.signal.aborted) setDetail(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Handoff case could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [slug, ticketId, retry]);

  async function saveTicket(input: { status?: string; priority?: string; assigneeUserId?: string | null }) {
    if (!ticketId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (input.assigneeUserId !== undefined) await assignTicket(slug, ticketId, input.assigneeUserId);
      else await updateTicket(slug, ticketId, input);
      setNotice('Case updated.'); setRetry((value) => value + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Case update failed.'); }
    finally { setBusy(false); }
  }
  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ticketId || !reply.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const key = replyKey || crypto.randomUUID(); setReplyKey(key);
      const result = await replyToTicket(slug, ticketId, reply.trim(), key);
      setNotice(result.deliveryState === 'DELIVERED' ? 'Reply delivery confirmed.' : result.deliveryState === 'FAILED' ? 'Reply saved, but channel delivery failed.' : 'Reply saved; channel delivery is pending confirmation.');
      setReply(''); setReplyKey(''); setRetry((value) => value + 1);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Reply could not be sent.'); }
    finally { setBusy(false); }
  }
  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ticketId || !note.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await addTicketNote(slug, ticketId, note.trim()); setNotice('Internal note saved.'); setNote(''); setRetry((value) => value + 1); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Internal note could not be saved.'); }
    finally { setBusy(false); }
  }

  const rows = list?.items ?? [];
  const messages: TicketMessage[] = detail?.messages ?? [];
  return <>
    <PageHeader eyebrow="Customer Support / Handoff" title={ticketId ? (detail?.reference || 'Handoff case') : 'Human handoff'} desc="Review AI-created customer issues and respond through supported workspace operations." action={<button className="btn btn-secondary" type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15}/> Refresh</button>}/>
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading handoff cases…</span><div className="dashboard-page-loading-metrics">{[0,1,2,3].map((item) => <i key={item}/>)}</div></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Handoff data could not be loaded</strong><p>{error}</p><button className="btn btn-primary" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && list && <>
      {!ticketId && <div className="metrics-grid"><Stat label="Total cases" value={String(list.summary.total)} change="Authorized workspace queue" icon={Headset}/><Stat label="Open" value={String(list.summary.OPEN)} change="Current API status count" icon={Headset}/><Stat label="Active" value={String(list.summary.ACTIVE)} change="Current API status count" icon={Headset}/><Stat label="Pending" value={String(list.summary.PENDING)} change="Current API status count" icon={Headset}/></div>}
      {ticketId ? <div className="two-col content-sidebar">
        <Card><SectionHeader title="Conversation timeline" desc={detail?.assistant?.name ? `Transferred from ${detail.assistant.name}` : 'Case conversation history from the authorized ticket API'}/>
          {detailLoading ? <div role="status">Loading case history…</div> : messages.length ? <div className="case-thread">{messages.map((message) => <article className={`message ${message.kind === 'CUSTOMER' ? 'visitor' : 'assistant'}`} key={message.id}><small>{String(message.kind || message.author?.name || 'MESSAGE')} · {message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Time unavailable'}</small><p>{message.content}</p></article>)}</div> : <Empty title="No case messages" desc="The connected ticket service has not returned conversation messages."/>}
          {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
          <form className="field" onSubmit={(event) => void submitReply(event)}><label htmlFor="ticket-reply">Reply to customer</label><textarea id="ticket-reply" value={reply} onChange={(event) => { if (event.target.value !== reply) setReplyKey(''); setReply(event.target.value); }} placeholder="Write your message…"/><button type="submit" className="btn btn-primary" disabled={!reply.trim() || busy}><Send size={15}/>{busy ? 'Sending…' : 'Send response'}</button></form>
          <form className="field" onSubmit={(event) => void submitNote(event)}><label htmlFor="ticket-note">Internal note</label><textarea id="ticket-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an internal note…"/><button type="submit" className="btn btn-secondary" disabled={!note.trim() || busy}>Save note</button></form>
        </Card>
        <Card><SectionHeader title="Case details"/><div className="detail-row"><span>Reference</span><strong>{detail?.reference || ticketId}</strong></div><div className="detail-row"><span>Subject</span><strong>{detail?.title || 'Unavailable'}</strong></div><div className="detail-row"><span>Channel</span><strong>{detail?.conversation?.channel || 'Unavailable'}</strong></div><div className="detail-row"><span>Priority</span><select aria-label="Case priority" value={detail?.priority || 'MEDIUM'} onChange={(event) => void saveTicket({ priority: event.target.value })}>{['LOW','MEDIUM','HIGH','URGENT'].map((item) => <option key={item}>{item}</option>)}</select></div><div className="detail-row"><span>Status</span><select aria-label="Case status" value={detail?.status || 'OPEN'} onChange={(event) => void saveTicket({ status: event.target.value })}>{['OPEN','ACTIVE','PENDING','CLOSED'].map((item) => <option key={item}>{item}</option>)}</select></div><div className="detail-row"><span>Assigned to</span><select aria-label="Assign case" value={detail?.assignee?.id || ''} onChange={(event) => void saveTicket({ assigneeUserId: event.target.value || null })}><option value="">Unassigned</option>{list.assigneeOptions.map((item) => <option key={item.userId} value={item.userId}>{item.name || item.role}</option>)}</select></div><Link className="text-link" to={`${root}/tickets`}>All handoff cases <ArrowLeft size={14}/></Link><Link className="btn btn-secondary full" to={`${root}/escalation-rules`}>Handoff rules</Link></Card>
      </div> : <>
        <div className="filter-line"><FilterInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search reference, title or customer"/><select aria-label="Case status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['OPEN','ACTIVE','PENDING','CLOSED'].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Case priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option>{['LOW','MEDIUM','HIGH','URGENT'].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Case assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">All assignees</option><option value="UNASSIGNED">Unassigned</option>{list.assigneeOptions.map((item) => <option key={item.userId} value={item.userId}>{item.name || item.role}</option>)}</select></div>
        <Card className="major"><SectionHeader title="Open cases" desc="Case assignments and statuses returned by the workspace service"/><TableWrap><thead><tr><th>Case</th><th>Subject</th><th>Priority</th><th>Assigned to</th><th>Updated</th><th>Channel</th><th/></tr></thead><tbody>{rows.map((item) => <tr className="selectable" key={item.id} onClick={() => navigate(`${root}/tickets/${encodeURIComponent(item.id)}`)}><td className="link-cell"><button className="text-link" type="button" aria-label={`${item.reference} ${item.title}`} onClick={(event) => { event.stopPropagation(); navigate(`${root}/tickets/${encodeURIComponent(item.id)}`); }}>{item.reference}</button></td><td className="semi">{item.title}</td><td><Badge tone={item.priority === 'HIGH' || item.priority === 'URGENT' ? 'amber' : 'neutral'}>{item.priority}</Badge></td><td>Open the case for assignment details</td><td>{new Date(item.updatedAt).toLocaleString()}</td><td>{item.conversation.channel}</td><td><ChevronRight size={16}/></td></tr>)}</tbody></TableWrap>{!rows.length && <Empty title="No handoff cases" desc="Customer cases will appear when the ticket service creates an escalation."/>}<div className="table-footer"><span>Page {page} · {list.total} total</span><div className="action-line"><button className="text-link" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button className="text-link" type="button" disabled={page * list.pageSize >= list.total} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></Card>
      </>}
    </>}
  </>;
}

export function SourceEscalationRulesPage() {
  const unavailable = () => undefined;
  return <>
    <PageHeader eyebrow="Support / Handoff / Rules" title="Handoff Rules" desc="Review escalation controls supported by this workspace."/>
    <div className="two-col content-sidebar">
      <Card><SectionHeader title="Automatic escalation" desc="Policy controls are read-only until a supported configuration API is available."/>{[
        ['Customer explicitly asks for a human', 'Offer a respectful escalation'],
        ['Trusted knowledge unavailable', 'Escalate when grounded evidence is missing'],
        ['Payment or sensitive account issue', 'Use authorized support channels'],
        ['Repeated unresolved turns', 'Offer a human after repeated unsuccessful replies'],
        ['Low model certainty', 'Calibrate against actual model behavior'],
      ].map(([label, description], index) => <Toggle key={label || index} label={label || 'Escalation rule'} desc={description || ''} checked={false} onChange={unavailable} disabled/>)}
      <Notice tone="amber">Rule changes cannot be saved because no handoff routing configuration API is available.</Notice></Card>
      <Card><SectionHeader title="Routing and coverage" desc="No routing settings are returned by the current API."/>{[['Default team','Unavailable'],['Priority rules','Unavailable'],['Working hours','Unavailable'],['After-hours behavior','Unavailable'],['SLA window','Unavailable'],['Notifications','Unavailable']].map(([label, value]) => <div className="detail-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}<Badge tone="neutral">Routing configuration unavailable</Badge></Card>
    </div>
  </>;
}
