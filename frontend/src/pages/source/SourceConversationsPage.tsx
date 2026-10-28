import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw, Send } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { addConversationNote, getConversation, getConversations, markConversationRead, updateConversation, type InboxDetail, type InboxPage } from '../../services/api/saas';
import { Badge, Card, Empty, FilterInput, PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

export function SourceConversationsPage() {
  const { slug = '' } = useParams();
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<InboxPage | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<InboxDetail | null>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getConversations(slug, { page, pageSize: 25, search, state, channel }, controller.signal)
      .then((value) => { if (!controller.signal.aborted) { setList(value); if (!selected && value.items[0]) setSelected(value.items[0].id); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Conversations could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, page, search, state, channel, retry]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const controller = new AbortController(); setDetailLoading(true); setDetailError('');
    getConversation(slug, selected, controller.signal).then(async (value) => {
      if (controller.signal.aborted) return;
      setDetail(value);
      const row = list?.items.find((item) => item.id === selected);
      if (row?.unread) { try { await markConversationRead(slug, selected); } catch { /* Keep the message history visible if marking read fails. */ } }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setDetailError(cause instanceof ApiError ? cause.message : 'Conversation details could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [slug, selected, retry]);

  async function changeState(next: string) {
    if (!selected || !detail) return;
    setDetailError('');
    try { await updateConversation(slug, selected, { state: next }); setDetail({ ...detail, state: next }); setRetry((value) => value + 1); }
    catch (cause) { setDetailError(cause instanceof ApiError ? cause.message : 'Conversation status could not be updated.'); }
  }
  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !note.trim() || saving) return;
    setSaving(true); setNotice(''); setDetailError('');
    try { await addConversationNote(slug, selected, note.trim()); setNote(''); setNotice('Internal note saved.'); setRetry((value) => value + 1); }
    catch (cause) { setDetailError(cause instanceof ApiError ? cause.message : 'Internal note could not be saved.'); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Customer Support" title="Conversations" desc="Customer history from connected channels, scoped to this workspace." action={<button className="btn btn-secondary" type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15}/> Refresh</button>}/>
    <div className="conversation-grid">
      <Card className="inbox-list"><div className="section-header"><div><h3>All conversations</h3><p>{list ? `${list.total} conversations` : 'Loading authorized conversations…'}</p></div><Badge>All</Badge></div><FilterInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search conversations"/><div className="filter-line"><select aria-label="Conversation status" value={state} onChange={(event) => setState(event.target.value)}><option value="">All statuses</option>{['OPEN','PENDING','RESOLVED','CLOSED'].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Conversation channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">All channels</option>{list?.channelOptions.map((item) => <option key={item}>{item}</option>)}</select></div>
        {loading ? <div role="status">Loading conversations…</div> : error ? <p role="alert">{error} <button className="text-link" onClick={() => setRetry((value) => value + 1)}>Retry</button></p> : list?.items.length ? <div>{list.items.map((item) => <button type="button" className={`inbox-row ${selected === item.id ? 'active' : ''}`} key={item.id} onClick={() => { setSelected(item.id); setNotice(''); }}><span className="avatar">{item.customerReference.slice(0,2).toUpperCase()}</span><div><strong>{item.customerReference}</strong><p>{item.lastMessagePreview || 'Conversation started'}</p><small>{item.assistant.name} · {item.channel} · {item.state.toLowerCase()}</small></div></button>)}</div> : <Empty title="No conversations found" desc="Conversation history appears when a supported customer channel is connected."/>}
        {list && <div className="table-footer"><span>Page {page} · {list.total} total</span><div className="action-line"><button type="button" className="text-link" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" className="text-link" disabled={page * list.pageSize >= list.total} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
      </Card>
      <Card className="transcript"><div className="chat-head"><div><h3>{detail?.assistant.name || 'Conversation details'}</h3><p>{detail ? `${detail.customerReference} · ${detail.channel}` : 'Select a conversation'}</p></div>{detail && <select aria-label="Conversation status" value={detail.state} onChange={(event) => void changeState(event.target.value)}>{['OPEN','PENDING','RESOLVED','CLOSED'].map((item) => <option key={item}>{item}</option>)}</select>}</div>
        {detailError && <p role="alert">{detailError}</p>}{notice && <p role="status">{notice}</p>}
        {detailLoading ? <div role="status">Loading message history…</div> : detail ? <div className="chat-messages">{detail.messages.length ? detail.messages.map((message) => <article className={`chat-message ${message.kind === 'CUSTOMER' ? 'visitor' : 'assistant'}`} key={message.id}><small>{message.kind.replaceAll('_',' ')} · {new Date(message.createdAt).toLocaleString()}</small><p>{message.content}</p></article>) : <Empty title="No messages yet" desc="This conversation has no message history yet."/>}</div> : <Empty title="Select a conversation" desc="Authorized conversation history will appear here."/>}
        {detail && <form className="conversation-note" onSubmit={(event) => void saveNote(event)}><label htmlFor="conversation-note-input">Internal note</label><textarea id="conversation-note-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an internal note…"/><button className="btn btn-primary" type="submit" disabled={!note.trim() || saving}><Send size={15}/>{saving ? 'Saving…' : 'Save note'}</button><small>Customer replies are not available through the current conversation API.</small></form>}
    </Card>
      <Card className="chat-context"><div className="section-header"><div><h3>Visitor context</h3><p>Authorized conversation metadata</p></div></div>{detail ? <><div className="detail-row"><span>Reference</span><strong>{detail.customerReference}</strong></div><div className="detail-row"><span>Channel</span><strong>{detail.channel}</strong></div><div className="detail-row"><span>Assistant</span><strong>{detail.assistant.name}</strong></div><div className="detail-row"><span>Messages</span><strong>{detail.messages.length}</strong></div><Badge tone="neutral">Customer reply API unavailable</Badge></> : <Empty title="No visitor selected" desc="Select a conversation to inspect its authorized context."/>}</Card>
  </div>
  </>;
}
