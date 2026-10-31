import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Activity, BookOpen, Bot, ChevronDown, CircleAlert, Copy, LoaderCircle, Plus, Send, Settings2, UserRound, X } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { GEMINI_MODEL_OPTIONS_FALLBACK, geminiModelOptionLabel, getPlaygroundConversation, getProviderConfigurationStatus, sendPlaygroundMessage, updateAssistant, type Assistant, type AssistantProvider, type ProviderConfigurationStatus, type ProviderRoute, type PlaygroundChatReply, type ResponseProvenance } from '../../services/api/assistants';
import { formatPlaygroundDiagnostics, formatPlaygroundHistory, formatPlaygroundMessage, loadCompletePlaygroundHistory, PLAYGROUND_EXPORT_MAX_BYTES, PLAYGROUND_EXPORT_MAX_MESSAGES } from './playground-copy';
import { resolveKnowledgeEvidenceMetadata, type KnowledgeEvidenceMetadataItem } from '../../services/api/knowledge';
import './playground-chat.css';

type Message = { id: string; role: 'user' | 'assistant' | 'notice' | 'error'; content: string; createdAt: number; sources?: PlaygroundChatReply['sources']; provenance?: ResponseProvenance; providerUsed?: AssistantProvider | null; modelUsed?: string | null; diagnostics?: PlaygroundChatReply['diagnostics']; retryText?: string; retryTurnId?: string };

export function PlaygroundChat({ workspaceSlug, assistant, manager, onAssistantUpdated, onClose }: { workspaceSlug: string; assistant: Assistant; manager: boolean; onAssistantUpdated: (assistant: Assistant) => void; onClose: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(() => storedSessionId(workspaceSlug, assistant));
  const [sessionNeedsNewChat, setSessionNeedsNewChat] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => assistant.greetingMessage ? [{ id: crypto.randomUUID(), role: 'assistant', content: assistant.greetingMessage, provenance: 'SYSTEM_RESPONSE', createdAt: Date.now() }] : []);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerSaved, setProviderSaved] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captureResponseDebug, setCaptureResponseDebug] = useState(false);
  useEffect(() => {
    const expiries = messages.flatMap((message) => message.diagnostics?.protectedResponseDebug ? [Date.parse(message.diagnostics.protectedResponseDebug.expiresAt)] : []).filter(Number.isFinite);
    if (!expiries.length) return;
    const timer = setTimeout(() => setMessages((current) => current.map((message) => {
      if (!message.diagnostics?.protectedResponseDebug || Date.parse(message.diagnostics.protectedResponseDebug.expiresAt) > Date.now()) return message;
      const { protectedResponseDebug: _expired, ...diagnostics } = message.diagnostics;
      return { ...message, diagnostics: { ...diagnostics, protectedCaptureStatus: 'EXPIRED' } };
    })), Math.max(0, Math.min(...expiries) - Date.now()));
    return () => clearTimeout(timer);
  }, [messages]);
  const [providerMode, setProviderMode] = useState<'MANUAL' | 'AUTO_FALLBACK'>(assistant.providerMode || 'MANUAL');
  const [fallbacks, setFallbacks] = useState<ProviderRoute[]>(assistant.providerFallbacks || []);
  const [providerStatus, setProviderStatus] = useState<ProviderConfigurationStatus | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'trace' | 'sources' | 'diagnostics'>('trace');
  const [selectedTraceMessageId, setSelectedTraceMessageId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const copyLock = useRef(false);
  const copyToken = useRef(0);
  const copyRequest = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const configured = Boolean(assistant.effectiveProviderConfiguration?.ready);

  useEffect(() => {
    generation.current++;
    request.current?.abort();
    copyToken.current++; copyRequest.current?.abort(); copyRequest.current = null; copyLock.current = false;
    const nextSessionId = storedSessionId(workspaceSlug, assistant);
    setSessionId(nextSessionId);
    setSessionNeedsNewChat(false);
    setMessages(assistant.greetingMessage ? [{ id: crypto.randomUUID(), role: 'assistant', content: assistant.greetingMessage, provenance: 'SYSTEM_RESPONSE', createdAt: Date.now() }] : []);
    setProviderMode(assistant.providerMode || 'MANUAL'); setFallbacks(assistant.providerFallbacks || []); setText(''); setSettingsError(''); setSending(false); lock.current = false;
    const loadGeneration = generation.current;
    if (!nextSessionId) return;
    const controller = new AbortController();
    void getPlaygroundConversation(workspaceSlug, assistant.id, nextSessionId, controller.signal, { latest: true }).then((conversation) => {
      if (generation.current !== loadGeneration || conversation.messages.length === 0) return;
      setMessages(conversation.messages.map((item) => ({ id: item.id, role: item.responseType === 'knowledge_setup' ? 'notice' : item.role, content: item.content, sources: item.sources, provenance: item.provenance, providerUsed: item.providerUsed, modelUsed: item.modelUsed, createdAt: new Date(item.createdAt).getTime() })));
    }).catch((cause: unknown) => {
      if (generation.current !== loadGeneration || controller.signal.aborted || !isMissingSession(cause)) return;
      clearStoredSessionId(workspaceSlug, assistant, nextSessionId);
      setSessionId(null);
      setSessionNeedsNewChat(true);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'notice', content: 'This saved conversation is no longer available. Select New Chat to continue.', createdAt: Date.now() }]);
    });
    return () => controller.abort();
  }, [assistant.id, workspaceSlug]);

  useEffect(() => {
    if (!manager) return;
    const controller = new AbortController();
    void getProviderConfigurationStatus(workspaceSlug, controller.signal).then(setProviderStatus).catch(() => setProviderStatus(null));
    return () => controller.abort();
  }, [workspaceSlug, manager]);

  useEffect(() => {
    try {
      const key = sessionStorageKey(workspaceSlug, assistant);
      if (sessionId) sessionStorage.setItem(key, sessionId);
      else sessionStorage.removeItem(key);
    } catch { /* Storage may be unavailable in a restricted browser context. */ }
  }, [workspaceSlug, assistant.id, sessionId]);

  useEffect(() => { const list = bottom.current?.parentElement; if (list) list.scrollTop = list.scrollHeight; }, [messages, sending]);
  useEffect(() => { const input = composer.current; if (!input) return; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 144)}px`; }, [text]);
  useEffect(() => () => { generation.current++; request.current?.abort(); copyToken.current++; copyRequest.current?.abort(); }, []);

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (!manager || savingProvider || sending) return;
    setSavingProvider(true); setSettingsError(''); setProviderSaved(false);
    try {
      const routesChanged = JSON.stringify(assistant.providerFallbacks || []) !== JSON.stringify(fallbacks);
      const changed = assistant.providerMode !== providerMode || routesChanged;
      const updated = await updateAssistant(workspaceSlug, assistant.id, { providerMode, providerFallbacks: fallbacks });
      onAssistantUpdated(updated);
      setProviderSaved(true);
      setSettingsOpen(false);
      if (changed) setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'notice', content: 'Routing settings saved. The server-managed provider and model remain unchanged.', createdAt: Date.now() }]);
    } catch (cause) { setSettingsError(messageFor(cause)); }
    finally { setSavingProvider(false); }
  }

  async function send(raw: string, retryMessageId?: string, retryTurnId?: string) {
    const message = raw.trim();
    if (!message || lock.current || !configured || sessionNeedsNewChat) return;
    const assistantAtStart = assistant.id;
    const generationAtStart = generation.current;
    const clientTurnId = retryTurnId || crypto.randomUUID();
    lock.current = true; setSending(true); setSettingsError('');
    if (!retryMessageId) setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: message, createdAt: Date.now() }]);
    else setMessages((current) => current.filter((item) => item.id !== retryMessageId));
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await sendPlaygroundMessage(workspaceSlug, assistantAtStart, message, sessionId ?? undefined, clientTurnId, controller.signal, undefined, manager && captureResponseDebug);
      if (generation.current !== generationAtStart || assistant.id !== assistantAtStart) return;
      setSessionId(result.sessionId);
      const respondedAt = Date.now();
      const responseId = result.messageId || crypto.randomUUID();
      setMessages((current) => [...current, { id: responseId, role: result.responseType === 'knowledge_setup' ? 'notice' : 'assistant', content: result.reply, sources: result.sources, provenance: result.provenance, providerUsed: result.providerUsed, modelUsed: result.modelUsed, diagnostics: result.diagnostics, createdAt: result.createdAt ? new Date(result.createdAt).getTime() : respondedAt }]);
      setSelectedTraceMessageId(responseId);
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== generationAtStart) return;
      if (sessionId && (isMissingSession(cause) || isExpiredSession(cause))) {
        clearStoredSessionId(workspaceSlug, assistant, sessionId);
        setSessionId(null);
        setSessionNeedsNewChat(true);
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'notice', content: 'This saved conversation is no longer available. Select New Chat to continue.', createdAt: Date.now() }]);
      } else {
        const errorId = crypto.randomUUID();
        const details = cause instanceof ApiError ? cause.details : undefined;
        const diagnostics = details && typeof details === 'object' && 'traceId' in details && typeof details.traceId === 'string' && 'events' in details && Array.isArray(details.events)
          ? details as PlaygroundChatReply['diagnostics'] : undefined;
        setMessages((current) => [...current, { id: errorId, role: 'error', content: messageFor(cause), diagnostics, retryText: message, retryTurnId: clientTurnId, createdAt: Date.now() }]);
        setSelectedTraceMessageId(errorId);
        if (manager && captureResponseDebug) { setInspectorOpen(true); setInspectorTab('diagnostics'); }
      }
    } finally {
      if (generation.current === generationAtStart) { lock.current = false; setSending(false); requestAnimationFrame(() => composer.current?.focus()); }
      if (request.current === controller) request.current = null;
    }
  }

  function startNewChat(notice?: string) {
    clearStoredSessionReferences(workspaceSlug, assistant);
    generation.current++; request.current?.abort(); request.current = null; lock.current = false;
    copyToken.current++; copyRequest.current?.abort(); copyRequest.current = null; copyLock.current = false;
    setSessionId(null);
    setCopyFeedback(''); setCopiedMessageId(null); copyLock.current = false;
    setSessionNeedsNewChat(false);
    setMessages([
      ...(assistant.greetingMessage ? [{ id: crypto.randomUUID(), role: 'assistant' as const, content: assistant.greetingMessage, provenance: 'SYSTEM_RESPONSE' as const, createdAt: Date.now() }] : []),
      ...(notice ? [{ id: crypto.randomUUID(), role: 'notice' as const, content: notice, createdAt: Date.now() }] : []),
    ]);
    setText(''); setSettingsError(''); setSending(false); requestAnimationFrame(() => composer.current?.focus());
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(formatPlaygroundMessage(message));
      setCopiedMessageId(message.id); setCopyFeedback('');
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1600);
    } catch {
      setCopyFeedback('Clipboard access failed. Allow clipboard access and try again.');
    }
  }

  async function copyHistory(withDiagnostics = false) {
    if (copyLock.current || sending || (withDiagnostics && (!manager || !messages.some((message) => message.diagnostics)))) return;
    copyLock.current = true;
    const copyTokenAtStart = ++copyToken.current;
    const generationAtStart = generation.current;
    const assistantAtStart = assistant.id;
    const sessionAtStart = sessionId;
    const controller = new AbortController();
    copyRequest.current = controller;
    setCopyFeedback('');
    try {
      let exportMessages: Message[] = sessionAtStart ? [] : [...messages];
      let incomplete = false;
      if (sessionAtStart) {
        const result = await loadCompletePlaygroundHistory({ workspaceSlug, assistantId: assistantAtStart, conversationId: sessionAtStart, signal: controller.signal, localMessages: messages });
        if (generation.current !== generationAtStart || assistant.id !== assistantAtStart || sessionId !== sessionAtStart) return;
        exportMessages = result.messages as Message[];
        incomplete = result.incomplete;
      }
      const cappedMessages = exportMessages.slice(0, PLAYGROUND_EXPORT_MAX_MESSAGES);
      let output = formatPlaygroundHistory({ assistantName: assistant.name, conversationId: sessionAtStart, messages: cappedMessages, incomplete, maxBytes: withDiagnostics ? PLAYGROUND_EXPORT_MAX_BYTES / 2 : PLAYGROUND_EXPORT_MAX_BYTES });
      if (withDiagnostics) {
        const diagnostics = formatPlaygroundDiagnostics(exportMessages, PLAYGROUND_EXPORT_MAX_BYTES / 2 - 1024);
        if (diagnostics) output += `\n\nCARTEIO AI — PLAYGROUND DIAGNOSTICS\n\n${diagnostics}`;
      }
      if (generation.current !== generationAtStart || assistant.id !== assistantAtStart || sessionId !== sessionAtStart) return;
      await navigator.clipboard.writeText(output);
      setCopyFeedback(output.includes('INCOMPLETE:') ? 'Copied · export incomplete at the safe limit.' : 'Copied');
    } catch {
      if (generation.current === generationAtStart) setCopyFeedback('Could not copy conversation. Check history access and clipboard permissions, then retry.');
    } finally {
      if (copyToken.current === copyTokenAtStart) {
        copyLock.current = false;
        if (copyRequest.current === controller) copyRequest.current = null;
      }
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); const value = text; if (value.trim() && !sending) { setText(''); void send(value); } }
  }

  const providerName = (value: string) => value === 'gemini' ? 'Google Gemini' : value === 'groq' ? 'Groq' : value === 'openrouter' ? 'OpenRouter' : 'OpenAI';
  const effective = providerStatus?.effective || assistant.effectiveProviderConfiguration;
  const providerLabel = effective?.provider && effective.model ? `${providerName(effective.provider)} · ${effective.model}` : `Provider unavailable · ${effective?.status || 'configuration unavailable'}`;
  const supportedGeminiModels = providerStatus?.gemini.supportedModels ?? [...GEMINI_MODEL_OPTIONS_FALLBACK];
  const selectedTraceMessage = messages.find((item) => item.id === selectedTraceMessageId);
  const selectedTrace = selectedTraceMessage?.diagnostics;
  return <section className="playground-panel" aria-label="AI Playground">
    {manager && <label><input type="checkbox" checked={captureResponseDebug} onChange={(event) => setCaptureResponseDebug(event.target.checked)}/> Capture Response Debugger for subsequent turns (requires server development opt-in; expires after five minutes)</label>}
    <header className="playground-header"><div className="playground-avatar" aria-hidden="true"><Bot size={18}/></div><div className="playground-title"><h2 id="playground-dialog-title">{assistant.name}</h2><span><i/> Testing</span></div><span className="playground-provider-label" title={providerLabel}>{providerLabel}</span><button type="button" className="playground-icon-button" onClick={() => void copyHistory()} aria-label="Copy entire conversation" title="Copy entire conversation" disabled={!manager || sending || !messages.length}><Copy size={17}/></button><button type="button" className="playground-icon-button" onClick={() => startNewChat()} aria-label="Start a new chat" title="New chat"><Plus size={18}/></button>{manager && <button type="button" className="playground-icon-button" aria-label="Provider settings" aria-expanded={settingsOpen} aria-controls="playground-settings-panel" title="Settings" onClick={() => { setSettingsError(''); setSettingsOpen((open) => !open); }}><Settings2 size={17}/></button>}{manager && <button type="button" className={`playground-icon-button ${inspectorOpen ? 'is-active' : ''}`} aria-label={inspectorOpen ? 'Close Developer Inspector' : 'Open Developer Inspector'} aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)} title="Developer Inspector"><Activity size={17}/></button>}<button type="button" className="playground-icon-button playground-close" onClick={onClose} aria-label="Close Playground" title="Close"><X size={18}/></button></header>
    <div className={`playground-workspace ${inspectorOpen ? 'has-inspector' : ''}`}>
    <div className="playground-chat-column">
    {manager && settingsOpen && <form id="playground-settings-panel" className="playground-provider" onSubmit={(event) => void saveProvider(event)}><div className="playground-settings-heading"><div><strong>Provider routing</strong><small>Credentials are configured on the backend and never sent to the browser.</small></div><button type="button" className="playground-icon-button" aria-label="Close provider settings" onClick={() => setSettingsOpen(false)}><X size={16}/></button></div><div className="playground-settings-fields"><div className="workspace-field"><strong>Provider and model</strong><span>{providerLabel}</span><small>Provider and model are managed by the server configuration.</small></div><div className="workspace-field"><strong>Credential readiness</strong><span>{effective?.ready ? "Backend key configured · connectivity not verified" : effective?.status || "Status unavailable"}</span></div></div><label className="workspace-field playground-mode-field">Selection mode<select value={providerMode} disabled={savingProvider || sending} onChange={(event) => setProviderMode(event.target.value as 'MANUAL' | 'AUTO_FALLBACK')}><option value="MANUAL">Manual · configured provider only</option><option value="AUTO_FALLBACK">Automatic fallback · transient failures only</option></select></label>{providerMode === 'AUTO_FALLBACK' && <div className="playground-fallback-fields"><p>Fallback sends authorized chat content to the approved providers below if the primary has a transient outage.</p>{[0, 1].map((index) => <div className="playground-fallback-route" key={index}><label className="workspace-field">Backup {index + 1}<select value={fallbacks[index]?.provider || ''} disabled={savingProvider || sending} onChange={(event) => { const next = [...fallbacks]; const choice = event.target.value as AssistantProvider | ''; if (!choice) next.splice(index, 1); else next[index] = { provider: choice, model: choice === 'gemini' ? supportedGeminiModels[0] || '' : '' }; setFallbacks(next.filter((route) => route.provider)); }}><option value="">No backup</option><option value="groq">Groq</option><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></label><label className="workspace-field">Backup model{fallbacks[index]?.provider === 'gemini' ? <select value={fallbacks[index]?.model || ''} disabled={savingProvider || sending} onChange={(event) => setFallbacks((current) => current.map((route, position) => position === index ? { ...route, model: event.target.value } : route))}><option value="">Select model</option>{supportedGeminiModels.map((item) => <option key={item} value={item}>{geminiModelOptionLabel(item)}</option>)}</select> : <input value={fallbacks[index]?.model || ''} disabled={!fallbacks[index]?.provider || savingProvider || sending} onChange={(event) => setFallbacks((current) => current.map((route, position) => position === index ? { ...route, model: event.target.value } : route))} placeholder="Model identifier"/>}</label></div>)}<small>Only OWNER/ADMIN settings can enable this. Credentials for each backup must be configured on the backend.</small></div>}<button type="submit" className="button button-primary" disabled={savingProvider || sending}>{savingProvider ? "Saving…" : "Save routing settings"}</button>{settingsError && <p className="playground-settings-error" role="alert">{settingsError}</p>}{providerSaved && <p className="playground-provider-saved" role="status">Routing settings saved.</p>}</form>}
    {assistant.status !== 'active' && <p className="playground-disclaimer" role="status">Activate this assistant before running a customer conversation test.</p>}
    <div className="playground-copy-toolbar"><button type="button" className="playground-copy-history" onClick={() => void copyHistory()} disabled={!manager || sending || !messages.length}><Copy size={13}/> Copy History</button>{manager && messages.some((message) => message.diagnostics) && <button type="button" className="playground-copy-history" onClick={() => void copyHistory(true)} disabled={sending}><Activity size={13}/> Copy Chat + Diagnostics</button>}{copyFeedback && <span role={/^(?:Could not|Clipboard access failed)/.test(copyFeedback) ? 'alert' : 'status'}>{copyFeedback}</span>}</div>
    <div className="playground-messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text">
      {!messages.length && <div className="playground-empty"><span className="playground-avatar" aria-hidden="true"><Bot size={20}/></span><p>{assistant.greetingMessage || `Send a test message to ${assistant.name}.`}</p>{!configured && manager && <small>Check the server-managed provider and model configuration.</small>}</div>}
      {messages.map((message) => <article className={`playground-message playground-message-${message.role}`} key={message.id}><span className="playground-message-avatar" aria-hidden="true">{message.role === 'user' ? <UserRound size={15}/> : message.role === 'notice' ? <CircleAlert size={15}/> : <Bot size={15}/>}</span><div className="playground-message-body"><div className="playground-bubble" dir="auto">{message.content}</div>{(message.role === 'assistant' || message.role === 'notice') && <span className="playground-provenance" title={message.provenance === 'KNOWLEDGE_GROUNDED' ? 'Validated citation metadata is shown; this does not guarantee every claim is correct.' : undefined}>{sourceLabel(message)}</span>}{message.role === 'assistant' && message.providerUsed && message.modelUsed && !isCredentialLike(message.modelUsed) && <span className="playground-provider-used">Generated by {providerName(message.providerUsed)} · {message.modelUsed}</span>}{message.sources?.length ? <details className="playground-citations"><summary>Sources <span>{message.sources.length}</span><ChevronDown size={14}/></summary><ul>{message.sources.map((source) => <li key={`${source.reference}:${source.title}`}><strong>[{source.reference}] {source.title}</strong><small>{source.type}{source.locator ? ` · ${source.locator}` : ''}</small></li>)}</ul></details> : null}{(message.role === 'user' || message.role === 'assistant') && <button type="button" className="playground-message-copy" aria-label="Copy message" title="Copy message" onClick={() => void copyMessage(message)}><Copy size={12}/>{copiedMessageId === message.id ? 'Copied' : ''}</button>}{manager && (message.role === 'assistant' || message.role === 'error') && <button type="button" className="playground-inspect-message" onClick={() => { setSelectedTraceMessageId(message.id); setInspectorOpen(true); setInspectorTab('trace'); }}>Inspect trace</button>}{message.role === 'error' && message.retryText && !sessionNeedsNewChat && <button type="button" className="playground-retry" disabled={sending || !configured} onClick={() => void send(message.retryText!, message.id, message.retryTurnId)}>Retry message</button>}<time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div></article>)}
      {sending && <div className="playground-message playground-message-assistant"><span className="playground-message-avatar" aria-hidden="true"><Bot size={15}/></span><div className="playground-bubble playground-typing" role="status"><LoaderCircle size={15}/> Working on your response…</div></div>}
      <div ref={bottom}/>
    </div>
    <form className="playground-composer" onSubmit={(event) => { event.preventDefault(); const value = text; if (value.trim() && !sending) { setText(''); void send(value); } }}><label className="sr-only" htmlFor="playground-message-input">Message your assistant</label><textarea id="playground-message-input" ref={composer} dir="auto" rows={1} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onInputKeyDown} placeholder={sessionNeedsNewChat ? 'Start a new chat to continue…' : configured ? 'Type a customer message…' : 'Provider configuration is unavailable…'} disabled={!manager || assistant.status !== 'active' || sending || !configured || sessionNeedsNewChat} aria-describedby="playground-composer-help"/><span id="playground-composer-help" className="sr-only">Press Enter to send. Press Shift and Enter for a new line.</span><button type="submit" aria-label="Send message" className="button button-primary" disabled={!manager || assistant.status !== 'active' || sending || !text.trim() || !configured || sessionNeedsNewChat}><Send size={17}/></button></form>
    <p className="playground-composer-hint">Enter to send <span>·</span> Shift+Enter for a new line</p>
    </div>
    {inspectorOpen && manager && <aside className="playground-inspector" aria-label="Developer Inspector"><div className="playground-inspector-heading"><div><strong>Developer Inspector</strong><small>{selectedTrace ? `Trace ${selectedTrace.traceId.slice(0, 8)} · ${selectedTrace.totalLatencyMs} ms` : 'Select a response to inspect its execution'}</small></div><button type="button" className="playground-icon-button" aria-label="Close Developer Inspector" onClick={() => setInspectorOpen(false)}><X size={16}/></button></div><nav className="playground-inspector-tabs" aria-label="Inspector tabs">{([['trace', 'Execution Trace'], ['sources', 'Sources'], ['diagnostics', 'Diagnostics']] as const).map(([key, label]) => <button key={key} type="button" className={inspectorTab === key ? 'active' : ''} onClick={() => setInspectorTab(key)}>{label}</button>)}</nav><div className="playground-inspector-content" key={`${inspectorTab}:${selectedTraceMessageId || 'none'}`}>
      {inspectorTab === 'trace' && <TraceInspector trace={selectedTrace} message={selectedTraceMessage} sending={sending} onCopy={() => selectedTrace && void navigator.clipboard?.writeText(selectedTrace.traceId)}/>}
      {inspectorTab === 'sources' && <SourcesInspector workspaceSlug={workspaceSlug} assistantId={assistant.id} trace={selectedTrace} message={selectedTraceMessage}/>}
      {inspectorTab === 'diagnostics' && <DiagnosticsInspector trace={selectedTrace} message={selectedTraceMessage}/>}
    </div></aside>}
    </div>
  </section>;
}

function messageFor(error: unknown) {
  if (!(error instanceof ApiError)) return 'The assistant could not reply. Check your connection and try again.';
  if (error.status === 401 || error.code === 'UNAUTHORIZED') return 'Your sign-in has expired. Sign in again, then reopen Playground.';
  const known: Record<string, string> = {
    PLAYGROUND_PROVIDER_KEY_MISSING: 'The selected provider key is missing from the backend environment. Add it there and restart the backend.',
    PLAYGROUND_PROVIDER_SETUP_REQUIRED: 'The server provider routing settings are incomplete. Ask an administrator to review them.',
    PLAYGROUND_PROVIDER_CONFIGURATION_INVALID: 'The server AI provider or model configuration is invalid. Ask an administrator to review it.',
    PLAYGROUND_PROVIDER_SAFETY_BLOCKED: 'The selected provider blocked this response under its safety policy. Review the request and try again.',
    PLAYGROUND_PROVIDER_AUTH_REJECTED: 'The provider rejected the configured credential or access permissions. Check the backend key and project access.',
    PLAYGROUND_PROVIDER_MODEL_UNAVAILABLE: 'The provider returned HTTP 404. Check the provider endpoint, model availability, and project access.',
    PLAYGROUND_PROVIDER_REQUEST_INVALID: 'The provider rejected this request. Check the model and its supported settings.',
    PLAYGROUND_PROVIDER_RATE_LIMITED: 'The provider is rate limiting requests. Wait briefly, then retry.',
    PLAYGROUND_PROVIDER_TIMEOUT: 'The provider took too long to respond. Retry the message.',
    PLAYGROUND_CONVERSATION_DEADLINE_EXCEEDED: 'This conversation took too long to complete. Retry the message.',
    PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE: 'The provider is temporarily unavailable. Retry the message shortly.',
    PLAYGROUND_PROVIDER_UNAVAILABLE: 'The backend could not reach the provider. Check the backend network connection.',
    PLAYGROUND_PROVIDER_INVALID_RESPONSE: 'The provider returned an unexpected response. Retry the message.',
    PLAYGROUND_PROVIDER_EMPTY_RESPONSE: 'The provider returned no usable content. The original message was retained for recovery.',
    PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED: 'The provider response was cut off before completion. Retry the message.',
    PLAYGROUND_EMPTY_PROVIDER_REPLY: 'The provider returned an empty answer. Retry the message.',
    PLAYGROUND_RETRIEVAL_UNAVAILABLE: 'Knowledge search is unavailable right now. Retry the message.',
    PLAYGROUND_SESSION_BUSY: 'Another message is still being processed in this chat. Wait a moment, then retry.',
    PLAYGROUND_SESSION_EXPIRED: 'This chat session expired. Start a new chat and send your message again.',
    PLAYGROUND_EVIDENCE_UNAVAILABLE: 'The answer could not be verified against current public information. Retry the message.',
    PLAYGROUND_EVIDENCE_INVALIDATED: 'The answer could not be verified against current public information. Retry the message.',
    PLAYGROUND_RATE_LIMITED: 'Too many test messages were sent recently. Wait a minute, then retry.',
    PLAYGROUND_TURN_ID_REUSED: 'This retry could not be matched safely. Start a new chat and send the message again.',
  };
  return error.code ? known[error.code] || 'We could not complete that request. Please try again.' : 'We could not complete that request. Please try again.';
}

function sourceLabel(message: Message) {
  if (message.provenance === 'SYSTEM_RESPONSE') return 'System response';
  if (message.sources?.length) {
    const knowledge = message.sources.some((source) => source.type !== 'COMMERCE_PRODUCT');
    const shopify = message.sources.some((source) => source.type === 'COMMERCE_PRODUCT');
    if (knowledge && shopify) return 'AI generated · Knowledge Base + Shopify data';
    if (knowledge) return 'AI generated · Knowledge Base';
    if (shopify) return 'AI generated · Shopify data';
  }
  if (message.provenance === 'AI_GENERATED') return 'AI generated';
  return 'Source unavailable';
}

function TraceInspector({ trace, message, sending, onCopy }: { trace?: PlaygroundChatReply['diagnostics']; message?: Message; sending: boolean; onCopy: () => void }) {
  if (!message) return <div className="playground-inspector-empty"><Activity size={20}/><strong>Select an AI response</strong><span>Each message keeps its own trace metadata. Older messages may not have instrumentation.</span></div>;
  if (!trace) return <div className="playground-inspector-empty"><Activity size={20}/><strong>Trace unavailable</strong><span>{sending ? 'This request uses a single response contract; confirmed server stages will appear after the response.' : 'This historical response has no trace payload, or diagnostics are disabled on the server.'}</span></div>;
  return <div className="playground-trace-view"><div className="playground-trace-id"><span>Trace ID</span><code>{trace.traceId}</code><button type="button" aria-label="Copy trace ID" onClick={onCopy}><Copy size={13}/></button></div><div className="playground-trace-summary"><span>Total latency <strong>{trace.totalLatencyMs} ms</strong></span><span>Final source <strong>{trace.finalSource.replaceAll('_', ' ')}</strong></span></div><ol>{trace.events.map((event, index) => <li key={`${event.operation}:${event.at}:${index}`}><i className={`trace-status trace-${event.status}`}/><div><strong>{event.operation.replaceAll('_', ' ')}</strong><small>{event.status}{event.durationMs ? ` · ${event.durationMs} ms` : ''}{event.reason ? ` · ${event.reason}` : ''}{event.errorCategory ? ` · ${event.errorCategory}` : ''}</small></div></li>)}</ol>{trace.events.some((event) => event.provider) && <p>Provider/model shown only for stages where the backend recorded an invocation.</p>}</div>;
}

export function pdfPageFromLocator(locator: unknown): number | null {
  if (typeof locator !== 'string') return null;
  // pdfChunks emits this structured delimiter around the page token.
  const match = locator.match(/(?:^|\s·\s)page\s+(\d+)(?=\s·\s|$)/i);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

function SourcesInspector({ workspaceSlug, assistantId, trace, message }: { workspaceSlug: string; assistantId: string; trace?: PlaygroundChatReply['diagnostics']; message?: Message }) {
  const [metadata, setMetadata] = useState<Map<string, KnowledgeEvidenceMetadataItem>>(new Map());
  const [metadataLoading, setMetadataLoading] = useState(false);
  useEffect(() => {
    const evidence = trace?.evidence ?? [];
    const items = evidence.filter((item) => Number.isSafeInteger(item.sourceVersion) && Number.isSafeInteger(item.indexGeneration))
      .map((item) => ({ sourceId: item.sourceId, chunkId: item.chunkId, pageId: item.pageId, sourceVersion: item.sourceVersion!, generation: item.indexGeneration! }));
    if (!message || !trace || !items.length) { setMetadata(new Map()); setMetadataLoading(false); return; }
    const controller = new AbortController();
    setMetadata(new Map()); setMetadataLoading(true);
    void resolveKnowledgeEvidenceMetadata(workspaceSlug, { assistantId, items }, controller.signal)
      .then((result) => setMetadata(new Map(result.items.map((item) => [`${item.sourceId}:${item.chunkId}`, item] as const))))
      .catch(() => { if (!controller.signal.aborted) setMetadata(new Map()); })
      .finally(() => { if (!controller.signal.aborted) setMetadataLoading(false); });
    return () => controller.abort();
  }, [workspaceSlug, assistantId, trace?.traceId, message?.id]);
  if (!message) return <div className="playground-inspector-empty"><BookOpen size={20}/><strong>Select a response</strong><span>Validated citations and retrieved evidence are shown per message.</span></div>;
  if (!trace) return <div className="playground-inspector-empty"><BookOpen size={20}/><strong>Trace unavailable</strong><span>Historical or uninstrumented messages cannot be classified beyond saved citation metadata.</span></div>;
  const pdfEvidence = trace.evidence.map((item) => ({ item, resolved: metadata.get(`${item.sourceId}:${item.chunkId}`) }))
    .filter(({ resolved }) => resolved?.status === 'CURRENT_VERIFIED_PDF');
  const staticEvidencePresent = trace.evidence.some((item) => item.sourceType !== 'COMMERCE_PRODUCT');
  return <div className="playground-source-inspector"><p>Retrieval {trace.retrieval.attempted ? 'attempted' : 'not attempted'} · audience {trace.retrieval.audience ?? 'not evaluated'} · {trace.retrieval.mode} · {trace.retrieval.resultCount} result(s), {trace.retrieval.eligibleSourceCount} eligible source(s) · {trace.retrieval.eligibilityStatus}</p>{trace.retrieval.queryHash && <small>Query fingerprint: {trace.retrieval.queryHash}</small>}{trace.retrieval.attempted && <p>Search method: Not recorded per evidence item.</p>}{!pdfEvidence.length && <p>{staticEvidencePresent ? 'No verified PDF Knowledge metadata was available for this message.' : 'No PDF Knowledge retrieved for this message.'}</p>}{trace.evidence.map((item) => { const resolved = metadata.get(`${item.sourceId}:${item.chunkId}`); const currentPdf = resolved?.status === 'CURRENT_VERIFIED_PDF'; const historical = resolved?.status === 'HISTORICAL_SOURCE_NO_LONGER_ELIGIBLE'; const commerce = item.sourceType === 'COMMERCE_PRODUCT'; const page = currentPdf ? pdfPageFromLocator(resolved.locator) : null; return <details key={item.reference}><summary><strong>[{item.reference}] {currentPdf ? resolved.title : commerce ? item.title : 'Knowledge evidence'}</strong><span>{item.cited ? 'Cited' : item.suppliedToProvider ? 'Supplied to LLM' : item.selectedForContext ? 'Selected' : item.retrieved ? 'Retrieved' : 'Not recorded'}</span></summary>{currentPdf ? <><strong>PDF SOURCE</strong><small>Origin: Uploaded PDF · Verified source · {resolved.filename ?? 'Filename unavailable'}{page ? ` — Page ${page}` : ''}</small><small>Section: {resolved.section?.replaceAll('_', ' ') ?? 'Not recorded'} · Knowledge Base: {resolved.knowledgeBaseName ?? 'Not recorded'} · Customer-visible: {resolved.customerVisible ? 'Yes' : 'No'}</small><small>Source {shortId(item.sourceId)} · version {resolved.sourceVersion} (current) · generation {resolved.generation}{page ? ` · page ${page}` : ''} · chunk {shortId(item.chunkId)}{resolved.chunkSequence !== undefined ? ` · order ${resolved.chunkSequence + 1}` : ''}</small><small>Retrieved {item.retrieved ? 'Yes' : 'No'} · selected {item.selectedForContext ? 'Yes' : 'No'} · revalidated {item.revalidated ? 'Yes' : 'No'} · supplied to LLM {item.suppliedToProvider ? 'Yes' : 'No'} · cited {item.cited ? 'Yes' : 'No'}</small><p>{item.excerpt || 'No excerpt returned.'}</p></> : historical ? <p>Historical source — no longer eligible. Current authorization does not validate this older generation.</p> : commerce ? <><small>Commerce source · source {shortId(item.sourceId)} · retrieved {item.retrieved ? 'Yes' : 'No'} · selected {item.selectedForContext ? 'Yes' : 'No'} · revalidated {item.revalidated ? 'Yes' : 'No'} · supplied {item.suppliedToProvider ? 'Yes' : 'No'} · cited {item.cited ? 'Yes' : 'No'}</small><p>{item.excerpt || 'No excerpt returned.'}</p></> : <p>{metadataLoading ? 'Resolving authorized PDF metadata…' : 'Metadata unavailable; source content is hidden because current PDF authorization could not be established.'}</p>}</details>; })}</div>;
}


function DiagnosticsInspector({ trace, message }: { trace?: PlaygroundChatReply['diagnostics']; message?: Message }) {
  // Capture status is separate from sanitized stage diagnostics.
  if (trace && message && !trace.protectedResponseDebug && trace.protectedCaptureStatus) return <><p role="status">Response capture: {trace.protectedCaptureStatus}. Protected records are returned with the turn response; they are not saved in conversation history.</p><DiagnosticsInspector trace={{ ...trace, protectedCaptureStatus: undefined }} message={message}/></>;
  if (!message) return <div className="playground-inspector-empty"><CircleAlert size={20}/><strong>No message selected</strong><span>Select a response or failed turn to inspect recorded diagnostics.</span></div>;
  if (!trace) return <div className="playground-inspector-empty"><CircleAlert size={20}/><strong>Record unavailable</strong><span>The server did not return a trace for this message. Historical messages do not retain protected captures; a network timeout may also prevent delivery.</span></div>;
  if (trace.protectedResponseDebug && Date.parse(trace.protectedResponseDebug.expiresAt) > Date.now()) return <div className="playground-diagnostics-inspector"><details open><summary>Response Debugger — protected development capture</summary><p>Trace {trace.traceId} · message {message.id}. Provider content is the adapter-returned text; the raw provider HTTP body is not captured. Comparison values not recorded by the validator remain not established.</p>{trace.protectedResponseDebug.records.map((record, index) => <details key={`${record.attemptId}:${record.stage}:${index}`}><summary>{record.attemptId} · {record.stage} · {record.at}{record.truncated ? ' · truncated' : ''}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.text}</pre></details>)}<p>Protected drafts are excluded from the sanitized diagnostics export. Use Execution Trace and Sources for stage outcomes and evidence authorization.</p></details></div>;
  const notes = [!trace.retrieval.attempted ? 'Knowledge retrieval was not attempted in this turn.' : null, trace.retrieval.attempted && trace.retrieval.eligibleSourceCount === 0 ? 'No eligible public Knowledge sources were reported by retrieval.' : null, trace.retrieval.attempted && trace.retrieval.resultCount === 0 && trace.retrieval.eligibleSourceCount > 0 ? 'Eligible sources existed, but retrieval returned no chunks.' : null, trace.retrieval.semanticUnavailableCode ? `Semantic retrieval status: ${trace.retrieval.semanticUnavailableCode}.` : null, ...trace.events.filter((event) => event.errorCategory).map((event) => `${event.operation}: ${event.errorCategory}`), ...trace.tools.filter((tool) => tool.outcome !== 'completed' && tool.outcome !== 'requested').map((tool) => `${tool.tool}: ${tool.reason || tool.outcome}`) ].filter(Boolean);
  return <div className="playground-diagnostics-inspector">{trace.assistantConfiguration && <p>Assistant {trace.assistantConfiguration.id} · configuration {trace.assistantConfiguration.version ?? 'version unavailable'} · loaded {String(trace.assistantConfiguration.loaded)} · sections {Object.entries(trace.assistantConfiguration.sectionLengths).filter(([, length]) => length > 0).map(([name]) => name).join(', ') || 'none'}</p>}{trace.memory && <p>Memory: {trace.memory.includedMessageCount}/{trace.memory.loadedMessageCount} loaded turns · {trace.memory.order} · {trace.memory.contextBytes} bytes · dropped {trace.memory.droppedMessageCount} · truncation {trace.memory.truncationReasons.join(', ') || 'none'}{trace.memory.windowAtCapacity ? ' · database history window at capacity' : ''}</p>}{trace.promptAssembly && <p>Prompt assembled: {String(trace.promptAssembly.completed)} · platform {String(trace.promptAssembly.platformInstructionsIncluded)} · Bot Behavior {String(trace.promptAssembly.assistantBehaviorIncluded)} · Agent Builder node {String(trace.promptAssembly.agentBuilderNodeInstructionsIncluded)} · behavior dispatched {String(trace.promptAssembly.assistantBehaviorSentToProvider)} · history dispatched {String(trace.promptAssembly.historySentToProvider ?? false)} · last payload history {trace.promptAssembly.historyMessageCount ?? 0} turns ({trace.promptAssembly.historyRoles?.join(' → ') || 'none'})</p>}{trace.configuredFacts && <p>Validated support contacts: configured {String(trace.configuredFacts.configured)} · selected {String(trace.configuredFacts.selected)} · revalidated {String(trace.configuredFacts.revalidated)} · dispatched {String(trace.configuredFacts.supplied)}{trace.configuredFacts.excludedReason ? ` · ${trace.configuredFacts.excludedReason}` : ''}</p>}{notes.length ? notes.map((note, index) => <p key={index}><CircleAlert size={14}/>{note}</p>) : <p>No failed or missing-knowledge condition was recorded in this response trace.</p>}{trace.commerceReadiness && <p>Shopify: {trace.commerceReadiness.connectionStatus} · scope snapshot {trace.commerceReadiness.scopeSnapshotStatus} · catalog {trace.commerceReadiness.eligible ? 'eligible' : trace.commerceReadiness.reason ?? 'unavailable'} · {trace.commerceReadiness.recordCount} product(s) · scopes {trace.commerceReadiness.relevantGrantedScopes.join(', ') || 'none'} · assistant operations {trace.commerceReadiness.assistantEnabledOperations.join(', ') || 'none'} · {trace.commerceReadiness.dataSource}</p>}{trace.tools.map((tool, index) => <p key={`${tool.tool}:${index}`}>Tool {tool.tool}: {tool.outcome}{tool.resultCount !== undefined ? ` · ${tool.resultCount} result(s)` : ''}{tool.reason ? ` · ${tool.reason}` : ''}{tool.durationMs !== undefined ? ` · ${tool.durationMs}ms` : ''}{tool.dataSource ? ` · ${tool.dataSource}` : ''}{tool.input ? ` · input (redacted): ${tool.input}` : ''}</p>)}</div>;
}

function shortId(value: string) { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }

function isCredentialLike(value: string) {
  return /(?:gsk_|sk-|sk_|AIza|sess-|Bearer\s)/i.test(value);
}

function isMissingSession(error: unknown) { return error instanceof ApiError && error.code === 'PLAYGROUND_SESSION_NOT_FOUND'; }
function isExpiredSession(error: unknown) { return error instanceof ApiError && error.code === 'PLAYGROUND_SESSION_EXPIRED'; }
function isServerSessionId(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function sessionStorageKey(workspaceSlug: string, assistant: Assistant) { return `carteio-playground-session:${workspaceSlug}:${assistant.id}`; }
function storedSessionId(workspaceSlug: string, assistant: Assistant) {
  try {
    const key = sessionStorageKey(workspaceSlug, assistant);
    const existing = sessionStorage.getItem(key);
    if (existing && isServerSessionId(existing)) return existing;
    if (existing) sessionStorage.removeItem(key);
    const legacyPrefix = `${key}:`;
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const legacyKey = sessionStorage.key(index);
      if (!legacyKey?.startsWith(legacyPrefix)) continue;
      const legacyId = sessionStorage.getItem(legacyKey);
      if (legacyId && isServerSessionId(legacyId)) { sessionStorage.setItem(key, legacyId); sessionStorage.removeItem(legacyKey); return legacyId; }
      sessionStorage.removeItem(legacyKey); index -= 1;
    }
  } catch { /* Storage may be unavailable in a restricted browser context. */ }
  return null;
}
function clearStoredSessionId(workspaceSlug: string, assistant: Assistant, expectedSessionId: string) {
  try {
    const key = sessionStorageKey(workspaceSlug, assistant);
    if (sessionStorage.getItem(key) === expectedSessionId) sessionStorage.removeItem(key);
    const legacyPrefix = `${key}:`;
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) { const legacyKey = sessionStorage.key(index); if (legacyKey?.startsWith(legacyPrefix) && sessionStorage.getItem(legacyKey) === expectedSessionId) sessionStorage.removeItem(legacyKey); }
  } catch { /* Storage may be unavailable in a restricted browser context. */ }
}
function clearStoredSessionReferences(workspaceSlug: string, assistant: Assistant) {
  try {
    const key = sessionStorageKey(workspaceSlug, assistant);
    sessionStorage.removeItem(key);
    const legacyPrefix = `${key}:`;
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) { const legacyKey = sessionStorage.key(index); if (legacyKey?.startsWith(legacyPrefix)) sessionStorage.removeItem(legacyKey); }
  } catch { /* Storage may be unavailable in a restricted browser context. */ }
}
