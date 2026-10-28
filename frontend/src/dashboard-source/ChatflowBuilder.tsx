import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, Bot, Check, ChevronDown, Clock3, GitBranch, GripVertical, MessageSquare, Minus, MousePointer2, Plus, RotateCcw, Save, Search, Send, Settings2, Sparkles, Workflow, X, Zap, ShoppingBag, Headset, Code2, CircleStop, Undo2, Redo2, PanelRightClose, CircleX } from 'lucide-react';
import { listAssistants, type Assistant } from '../services/api/assistants';
import { getEffectiveKnowledge, type EffectiveKnowledge } from '../services/api/knowledge-bases';
import { createFlow, listFlows, runFlow, updateFlow, type FlowDefinition, type FlowGraph, type FlowRunReply } from '../services/api/flows';
import { ApiError } from '../services/api/client';
import './chatflow-builder.css';

type Kind = FlowGraph['nodes'][number]['kind'];
type Node = FlowGraph['nodes'][number];
type Draft = { name: string; nodes: Node[]; edges: Array<[string, string]> };
type WireMode = 'create' | 'source' | 'target';
type WireDraft = { mode: WireMode; edge?: [string, string]; sourceId: string; targetId?: string; branchIndex: number | null };
type Props = { workspaceSlug: string; workspaceName: string; workspaceRole: string };
type ChatMessage = { id: string; role: 'visitor' | 'ai' | 'error'; text: string; time: string };
const palette: Array<{ key: string; title: string; detail: string; kind?: Kind; Icon: typeof Bot; tone: string; disabled?: boolean }> = [
  { key: 'start', title: 'Start', detail: 'Start a conversation flow', kind: 'start', Icon: Zap, tone: 'green' },
  { key: 'message', title: 'Message', detail: 'Format the current message', kind: 'transform', Icon: MessageSquare, tone: 'blue' },
  { key: 'assistant', title: 'AI Assistant', detail: 'Run a configured assistant', kind: 'assistant', Icon: Bot, tone: 'violet' },
  { key: 'knowledge', title: 'Knowledge Search', detail: 'Search authorized knowledge', kind: 'knowledge', Icon: Search, tone: 'orange' },
  { key: 'shopify', title: 'Shopify Product Search', detail: 'Preview only · not supported by current Flow API', Icon: ShoppingBag, tone: 'green', disabled: true },
  { key: 'condition', title: 'Condition', detail: 'Branch on text match', kind: 'condition', Icon: GitBranch, tone: 'pink' },
  { key: 'api', title: 'API', detail: 'Preview only · no safe API node contract', Icon: Code2, tone: 'purple', disabled: true },
  { key: 'handoff', title: 'Human Handoff', detail: 'Preview only · not supported by current Flow API', Icon: Headset, tone: 'blue', disabled: true },
  { key: 'end', title: 'End', detail: 'Return the assistant response', kind: 'response', Icon: CircleStop, tone: 'gray' },
];
const starter: Draft = { name: 'New chatflow', nodes: [
  { id: 'start', kind: 'start', title: 'Start', detail: 'Receive a customer message', x: 60, y: 250 },
  { id: 'message', kind: 'transform', title: 'Visitor message', detail: 'Keep the incoming message available to the flow', x: 340, y: 250, promptTemplate: '{{input}}' },
  { id: 'intent', kind: 'condition', title: 'Intent check', detail: 'Route product questions separately', x: 640, y: 250, conditionOperator: 'contains', conditionValue: 'product' },
  { id: 'product-assistant', kind: 'assistant', title: 'Product AI Assistant', detail: 'Use the selected assistant for a product question', x: 960, y: 110 },
  { id: 'product-end', kind: 'response', title: 'End', detail: 'Return the product response', x: 1270, y: 110 },
  { id: 'knowledge', kind: 'knowledge', title: 'Knowledge Search', detail: 'Search the selected assistant’s authorized sources', x: 960, y: 390, knowledgeLimit: 5 },
  { id: 'general-assistant', kind: 'assistant', title: 'General AI Assistant', detail: 'Answer using the selected assistant configuration', x: 1270, y: 390 },
  { id: 'general-end', kind: 'response', title: 'End', detail: 'Return the general response', x: 1580, y: 390 },
], edges: [['start', 'message'], ['message', 'intent'], ['intent', 'product-assistant'], ['intent', 'knowledge'], ['product-assistant', 'product-end'], ['knowledge', 'general-assistant'], ['general-assistant', 'general-end']] };
const titleFor: Record<Kind, string> = { start: 'Start', transform: 'Message', assistant: 'AI Assistant', knowledge: 'Knowledge Search', condition: 'Condition', response: 'End' };
const makeId = () => `node-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const messageId = () => crypto.randomUUID?.() || Math.random().toString(36).slice(2);
const handleY = (node: Node, branchIndex = 0) => node.y + 62 + (node.kind === 'condition' ? (branchIndex === 0 ? -22 : 22) : 0);
const edgeCurvePoints = (sx: number, sy: number, tx: number, ty: number) => { const bend = Math.max(48, Math.abs(tx - sx) * .45); return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`; };
const edgeCurve = (a: Node, b: Node, branchIndex = 0) => edgeCurvePoints(a.x + 230, handleY(a, branchIndex), b.x, handleY(b));
const edgeKey = ([from, to]: [string, string]) => `${from}→${to}`;
const persistedEdgeId = ([from, to]: [string, string]) => `e${from.length}_${from}${to.length}_${to}`;
function graphIntegrityIssue(nodes: Node[], edges: Array<[string, string]>) {
  if (nodes.length < 1 || nodes.length > 100 || edges.length > 250) return 'The Flow API allows 1–100 nodes and at most 250 connections.';
  if (nodes.filter((node) => node.kind === 'start').length !== 1) return 'The Flow API requires exactly one Start node.';
  if (JSON.stringify({ version: 1, nodes, edges }).length > 200_000) return 'The Flow API limits a saved graph to 200 KB.';
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length || nodes.some((node) => !/^[A-Za-z0-9_-]{1,80}$/.test(node.id) || !node.title.trim() || node.title.length > 120 || node.detail.length > 500 || !Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x < 0 || node.y < 0 || node.x > 20000 || node.y > 20000)) return 'Node IDs, labels or positions exceed the limits supported by the Flow API.';
  if (nodes.some((node) => node.kind === 'transform' && (typeof node.promptTemplate !== 'string' || !node.promptTemplate.trim() || node.promptTemplate.length > 2000) || node.kind === 'condition' && (!['contains', 'equals', 'starts_with'].includes(node.conditionOperator || '') || typeof node.conditionValue !== 'string' || !node.conditionValue.trim() || node.conditionValue.length > 2000) || node.kind === 'knowledge' && node.knowledgeLimit !== undefined && (!Number.isInteger(node.knowledgeLimit) || node.knowledgeLimit < 1 || node.knowledgeLimit > 10))) return 'Complete the required Message, Condition or Knowledge settings before saving.';
  const seen = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const key = edgeKey([from, to]);
    if (!ids.has(from) || !ids.has(to) || from === to) return 'Connections must join two different nodes in this flow.';
    if (seen.has(key)) return 'Duplicate connections are not allowed.';
    if (nodes.find((node) => node.id === to)?.kind === 'start') return 'The Start node cannot receive a connection.';
    seen.add(key); adjacency.set(from, [...(adjacency.get(from) || []), to]);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) || []) if (visit(next)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (nodes.some((node) => visit(node.id))) return 'Cycles are not supported by the current Flow API.';
  return '';
}
function runnableGraphIssue(draft: Draft) {
  const { nodes, edges } = draft;
  const starts = nodes.filter((node) => node.kind === 'start');
  if (starts.length !== 1) return 'A runnable flow needs exactly one Start node.';
  if (!nodes.some((node) => node.kind === 'assistant')) return 'Add at least one AI Assistant node before running this flow.';
  if (!nodes.some((node) => node.kind === 'response')) return 'Every runnable flow needs an End node after an AI Assistant.';
  const outgoing = new Map<string, string[]>(), incoming = new Map<string, number>();
  nodes.forEach((node) => incoming.set(node.id, 0));
  edges.forEach(([from, to]) => { outgoing.set(from, [...(outgoing.get(from) || []), to]); incoming.set(to, (incoming.get(to) || 0) + 1); });
  if ((incoming.get(starts[0]!.id) || 0) || [...incoming.values()].some((count) => count > 1)) return 'The current runner cannot execute merged paths or connections into Start.';
  const visited = new Set<string>();
  const walk = (node: Node, assistantSeen: boolean): string => {
    if (visited.has(node.id)) return 'The current runner needs separate, non-merging paths.';
    visited.add(node.id);
    const hasAssistant = assistantSeen || node.kind === 'assistant';
    const next = outgoing.get(node.id) || [];
    if (node.kind === 'response') return next.length ? 'End nodes cannot have outgoing connections.' : hasAssistant ? '' : 'Every path must run an AI Assistant before End.';
    if (node.kind === 'condition' ? next.length !== 2 : next.length !== 1) return node.kind === 'condition' ? 'Connect both True and False condition outputs.' : 'Every non-condition step needs exactly one outgoing connection.';
    for (const id of next) {
      const target = nodes.find((candidate) => candidate.id === id);
      if (!target) return 'A connection points to a missing node.';
      const issue = walk(target, hasAssistant); if (issue) return issue;
    }
    return '';
  };
  const issue = walk(starts[0]!, false);
  if (issue) return issue;
  return visited.size === nodes.length ? '' : 'Connect every node to a reachable Start path before running.';
}
function errorMessage(error: unknown) { return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The request failed. Please try again.'; }
function newNode(kind: Kind, index: number, assistantId: string): Node {
  const card = palette.find((item) => item.kind === kind)!;
  return { id: makeId(), kind, title: card.title, detail: card.detail, x: 90 + (index % 3) * 290, y: 90 + Math.floor(index / 3) * 190,
    ...(kind === 'transform' ? { promptTemplate: '{{input}}' } : {}),
    ...(['assistant', 'knowledge'].includes(kind) && assistantId ? { assistantId } : {}),
    ...(kind === 'condition' ? { conditionOperator: 'contains' as const, conditionValue: '' } : {}),
    ...(kind === 'knowledge' ? { knowledgeLimit: 5 } : {}),
  };
}
function cloneDraft(draft: Draft): Draft { return { name: draft.name, nodes: draft.nodes.map((node) => ({ ...node })), edges: draft.edges.map(([a, b]) => [a, b] as [string, string]) }; }

type ChatflowComposerProps = { busy: boolean; enabled: boolean; retryText: string; initialValue: string; onDraftChange: (value: string) => void; onRetryConsumed: () => void; onSend: (message: string) => Promise<void> };
const ChatflowComposer = memo(function ChatflowComposer({ busy, enabled, retryText, initialValue, onDraftChange, onRetryConsumed, onSend }: ChatflowComposerProps) {
  const [query, setQuery] = useState(initialValue);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!retryText) return;
    setQuery(retryText);
    onDraftChange(retryText);
    onRetryConsumed();
  }, [retryText, onDraftChange, onRetryConsumed]);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const maximum = 100;
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(maximum, Math.max(40, composer.scrollHeight))}px`;
    composer.style.overflowY = composer.scrollHeight > maximum ? 'auto' : 'hidden';
  }, [query]);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };
  return <form className="chatflow-composer" onSubmit={(event) => { event.preventDefault(); const message = query.trim(); if (!message || busy || !enabled) return; void onSend(message); setQuery(''); onDraftChange(''); }}>
    <textarea ref={composerRef} aria-label="Message the bot" value={query} onChange={(event) => { setQuery(event.target.value); onDraftChange(event.target.value); }} onKeyDown={handleKeyDown} placeholder="Type a message..." rows={1} disabled={busy || !enabled} aria-busy={busy}/>
    <button type="submit" disabled={busy || !enabled || !query.trim()} aria-label={busy ? 'Sending message' : 'Send message'} aria-busy={busy}><Send size={16}/></button>
  </form>;
});

export function ChatflowBuilder({ workspaceSlug, workspaceName, workspaceRole }: Props) {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [knowledgeAccess, setKnowledgeAccess] = useState<EffectiveKnowledge | null>(null);
  const [knowledgeAccessError, setKnowledgeAccessError] = useState('');
  const [flows, setFlows] = useState<FlowDefinition[]>([]);
  const [assistantId, setAssistantId] = useState('');
  const [flowId, setFlowId] = useState('');
  const [version, setVersion] = useState<number>();
  const [draft, setDraft] = useState<Draft>(() => cloneDraft(starter));
  const [selected, setSelected] = useState('assistant');
  const [status, setStatus] = useState<'loading' | 'clean' | 'dirty' | 'saving' | 'failed'>('loading');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [runError, setRunError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [retryText, setRetryText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [runReply, setRunReply] = useState<FlowRunReply | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [connectFrom, setConnectFrom] = useState('');
  const [connectBranch, setConnectBranch] = useState<'true' | 'false' | null>(null);
  const [selectedEdge, setSelectedEdge] = useState('');
  const [wireMode, setWireMode] = useState<WireMode | null>(null);
  const [wireDraft, setWireDraft] = useState<WireDraft | null>(null);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const chatDraftRef = useRef('');
  const updateChatDraft = useCallback((value: string) => { chatDraftRef.current = value; }, []);
  const wirePathRef = useRef<SVGPathElement>(null);
  const wireCleanupRef = useRef<(() => void) | null>(null);
  const ignoreHandleClickRef = useRef(false);
  const wirePointerRef = useRef({ x: 0, y: 0 });
  const dragCleanup = useRef<(() => void) | null>(null);
  const hydratedAssistant = useRef('');
  const canEdit = workspaceRole === 'owner' || workspaceRole === 'admin';
  const selectedNode = draft.nodes.find((node) => node.id === selected);
  const knowledgeAssistantId = selectedNode?.kind === 'knowledge' ? (selectedNode.assistantId || assistantId) : '';
  const assistant = assistants.find((item) => item.id === assistantId);
  const filteredPalette = palette.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(search.toLowerCase()));
  const flowName = draft.name.trim() || 'Untitled chatflow';
  const dirty = status === 'dirty' || status === 'failed';
  const graph = useMemo<FlowGraph>(() => ({ version: 1, nodes: draft.nodes.map((node) => ['assistant', 'knowledge'].includes(node.kind) ? { ...node, assistantId: node.assistantId || assistantId || undefined } : node), edges: draft.edges, edgeMetadata: draft.edges.map((edge) => ({ id: persistedEdgeId(edge), sourceHandle: draft.nodes.find((node) => node.id === edge[0])?.kind === 'condition' ? (draft.edges.filter(([source]) => source === edge[0]).findIndex(([ , target]) => target === edge[1]) === 0 ? 'true' : 'false') : 'output', targetHandle: 'input' })) }), [draft, assistantId]);
  const worldBounds = useMemo(() => ({
    width: Math.max(4000, ...draft.nodes.map((node) => node.x + 520)),
    height: Math.max(4000, ...draft.nodes.map((node) => node.y + 300)),
  }), [draft.nodes]);
  const integrityIssue = useMemo(() => graphIntegrityIssue(draft.nodes, draft.edges), [draft.nodes, draft.edges]);
  const executableIssue = useMemo(() => integrityIssue || runnableGraphIssue(draft), [draft, integrityIssue]);

  useEffect(() => {
    if (!workspaceSlug) return;
    const controller = new AbortController();
    listAssistants(workspaceSlug, 1, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setAssistants(result.assistants);
      setAssistantId((current) => current || result.assistants[0]?.id || '');
    }).catch((reason) => { if (!controller.signal.aborted) setLoadError(errorMessage(reason)); });
    return () => controller.abort();
  }, [workspaceSlug]);

  useEffect(() => {
    if (!knowledgeAssistantId) { setKnowledgeAccess(null); setKnowledgeAccessError(''); return; }
    const controller = new AbortController();
    setKnowledgeAccess(null); setKnowledgeAccessError('');
    getEffectiveKnowledge(workspaceSlug, knowledgeAssistantId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setKnowledgeAccess(value); })
      .catch((reason) => { if (!controller.signal.aborted) setKnowledgeAccessError(errorMessage(reason)); });
    return () => controller.abort();
  }, [workspaceSlug, knowledgeAssistantId]);

  useEffect(() => {
    if (!workspaceSlug || !assistantId) { if (!assistantId) setStatus('clean'); return; }
    hydratedAssistant.current = '';
    const controller = new AbortController();
    setStatus('loading'); setLoadError(''); setSaveError(''); setFlowId(''); setVersion(undefined);
    setHistory([]); setFuture([]);
    listFlows(workspaceSlug, assistantId, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      hydratedAssistant.current = assistantId;
      setFlows(items);
      const saved = items[0];
      if (saved) {
        setFlowId(saved.id); setVersion(saved.version);
        const savedDraft: Draft = { name: saved.name, nodes: saved.graph.nodes, edges: saved.graph.edges };
        let recovered: { flowId?: string; version?: number; draft?: Draft } | null = null;
        try { recovered = JSON.parse(localStorage.getItem(`carteio.chatflow.draft:${workspaceSlug}:${assistantId}`) || 'null'); } catch { recovered = null; }
        if (recovered?.flowId === saved.id && recovered.version === saved.version && recovered.draft) {
          setDraft(recovered.draft); setSelected(recovered.draft.nodes[0]?.id || ''); setStatus('dirty');
        } else {
          setDraft(savedDraft); setSelected(saved.graph.nodes[0]?.id || ''); setStatus('clean');
        }
      } else {
        const localKey = `carteio.chatflow.draft:${workspaceSlug}:${assistantId}`;
        try { const stored = JSON.parse(localStorage.getItem(localKey) || 'null') as { draft?: Draft } | Draft | null; setDraft(stored && 'draft' in stored && stored.draft ? stored.draft : stored && 'nodes' in stored ? stored : cloneDraft(starter)); }
        catch { setDraft(cloneDraft(starter)); }
        setFlowId(''); setSelected('assistant'); setStatus('dirty');
      }
    }).catch((reason) => { if (!controller.signal.aborted) { setLoadError(errorMessage(reason)); setStatus('failed'); } });
    return () => controller.abort();
  }, [workspaceSlug, assistantId]);
  useEffect(() => { setChat([]); setRunReply(null); setRunError(''); }, [assistantId]);
  useEffect(() => {
    if (!saveError) return;
    const timeout = window.setTimeout(() => setSaveError(''), 6500);
    return () => window.clearTimeout(timeout);
  }, [saveError]);

  useEffect(() => {
    if (!workspaceSlug || !assistantId || hydratedAssistant.current !== assistantId || status === 'loading') return;
    const key = `carteio.chatflow.draft:${workspaceSlug}:${assistantId}`;
    try {
      if (status === 'clean') localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ flowId, version, draft }));
    } catch { /* local recovery is best effort */ }
  }, [workspaceSlug, assistantId, draft, flowId, version, status]);
  useEffect(() => () => { dragCleanup.current?.(); wireCleanupRef.current?.(); }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const edit = useCallback((mutate: (current: Draft) => Draft) => {
    setHistory((old) => [...old.slice(-39), cloneDraft(draft)]); setFuture([]);
    setDraft((current) => mutate(current));
    setStatus('dirty'); setSaveError(''); setRunError(''); setRunReply(null);
  }, [draft]);
  const addNode = (kind: Kind, at?: { x: number; y: number }) => {
    const node = newNode(kind, draft.nodes.length, assistantId);
    if (at) { node.x = Math.max(0, at.x); node.y = Math.max(0, at.y); }
    else { node.x = Math.min(19000, (selectedNode?.x ?? Math.max(60, ...draft.nodes.map((item) => item.x))) + 300); node.y = selectedNode?.y ?? 250; }
    setSelected(node.id); edit((current) => ({ ...current, nodes: [...current.nodes, node] }));
  };
  const removeNode = (id: string) => edit((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== id), edges: current.edges.filter(([a, b]) => a !== id && b !== id) }));
  const duplicateNode = (id: string) => {
    const source = draft.nodes.find((node) => node.id === id); if (!source) return;
    const copy = { ...source, id: makeId(), title: `${source.title} copy`, x: Math.min(19770, source.x + 300), y: source.y };
    setSelected(copy.id); edit((current) => ({ ...current, nodes: [...current.nodes, copy] }));
  };
  const proposeEdge = (from: string, to: string, branchIndex: number | null, oldEdge?: [string, string], replacingTarget = false) => {
    const source = draft.nodes.find((node) => node.id === from), target = draft.nodes.find((node) => node.id === to);
    if (!source || !target) return { issue: 'The selected node no longer exists.', edges: draft.edges };
    if (source.id === target.id) return { issue: 'A node cannot connect to itself.', edges: draft.edges };
    if (source.kind === 'response') return { issue: 'End nodes cannot start another connection.', edges: draft.edges };
    if (target.kind === 'start') return { issue: 'The Start node cannot receive a connection.', edges: draft.edges };
    let edges = draft.edges.map((edge) => [...edge] as [string, string]);
    const oldIndex = oldEdge ? edges.findIndex(([a, b]) => a === oldEdge[0] && b === oldEdge[1]) : -1;
    if (oldEdge && oldIndex < 0) return { issue: 'That connection has changed. Select it again before rewiring.', edges: draft.edges };
    if (oldIndex >= 0 && replacingTarget) {
      edges[oldIndex] = [from, to];
    } else {
      if (oldIndex >= 0) edges.splice(oldIndex, 1);
      if (edges.some(([a, b]) => a === from && b === to)) return { issue: 'That connection already exists.', edges: draft.edges };
      const outgoing = edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge[0] === from);
      if (source.kind === 'condition') {
        if (branchIndex !== 0 && branchIndex !== 1) return { issue: 'Choose the True or False output on a Condition node.', edges: draft.edges };
        if (outgoing[branchIndex]) return { issue: `The ${branchIndex === 0 ? 'True' : 'False'} output is already connected.`, edges: draft.edges };
        if (branchIndex === 1 && outgoing.length === 0) return { issue: 'Connect the True output before the False output.', edges: draft.edges };
        if (outgoing.length >= 2) return { issue: 'Condition nodes support one connection on each output.', edges: draft.edges };
        const insertion = branchIndex === 0 ? (outgoing[0]?.index ?? edges.length) : (outgoing[0]?.index ?? edges.length) + 1;
        edges.splice(insertion, 0, [from, to]);
      } else edges.push([from, to]);
    }
    const issue = graphIntegrityIssue(draft.nodes, edges);
    return { issue, edges };
  };
  const applyConnection = (from: string, to: string, branchIndex: number | null = null, oldEdge?: [string, string], replacingTarget = false) => {
    const proposal = proposeEdge(from, to, branchIndex, oldEdge, replacingTarget);
    if (proposal.issue) { setRunError(proposal.issue); return false; }
    edit((current) => ({ ...current, edges: proposal.edges }));
    setSelectedEdge(edgeKey([from, to])); setRunError(''); return true;
  };
  const connect = (target: string, branch: 'true' | 'false' | null = null) => {
    if (!connectFrom) { setConnectFrom(target); setConnectBranch(branch); return; }
    const from = connectFrom, branchIndex = connectBranch === 'true' ? 0 : connectBranch === 'false' ? 1 : null;
    applyConnection(from, target, branchIndex);
    setConnectFrom(''); setConnectBranch(null);
  };
  const chooseOutput = (source: string, branch: 'true' | 'false' | null = null) => {
    if (connectFrom === source && connectBranch === branch) { setConnectFrom(''); setConnectBranch(null); return; }
    setConnectFrom(source); setConnectBranch(branch);
  };
  const finishWire = () => {
    wireCleanupRef.current?.(); wireCleanupRef.current = null;
    canvasRef.current?.querySelectorAll('.chatflow-handle.connection-compatible,.chatflow-handle.connection-hover').forEach((handle) => handle.classList.remove('connection-compatible', 'connection-hover'));
    setWireDraft(null); setWireMode(null);
  };
  const startWire = (event: ReactPointerEvent<HTMLButtonElement>, config: WireDraft) => {
    if (event.button !== 0 || !canEdit) return;
    event.preventDefault(); event.stopPropagation();
    wireCleanupRef.current?.(); setConnectFrom(''); setConnectBranch(null); if (config.mode === 'create') setSelectedEdge('');
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const worldPoint = (clientX: number, clientY: number) => ({ x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom });
    const from = draft.nodes.find((node) => node.id === config.sourceId);
    const to = config.targetId ? draft.nodes.find((node) => node.id === config.targetId) : undefined;
    if (!from || (config.mode !== 'create' && !to)) return;
    const branch = config.branchIndex ?? 0;
    const startPoint = config.mode === 'source' ? { x: from.x + 230, y: handleY(from, branch) } : { x: from.x + 230, y: handleY(from, branch) };
    wirePointerRef.current = worldPoint(event.clientX, event.clientY);
    setWireDraft(config); setWireMode(config.mode);
    const candidateSelector = config.mode === 'source' ? '[data-handle-kind="output"]' : '[data-handle-kind="input"]';
    canvasRef.current?.querySelectorAll<HTMLButtonElement>(candidateSelector).forEach((handle) => {
      const candidate = draft.nodes.find((node) => node.id === handle.dataset.nodeId);
      if (candidate && !(config.mode !== 'source' && candidate.kind === 'start') && !(config.mode === 'source' && candidate.kind === 'response')) handle.classList.add('connection-compatible');
    });
    const move = (pointer: PointerEvent) => {
      const p = worldPoint(pointer.clientX, pointer.clientY); wirePointerRef.current = p;
      const path = wirePathRef.current;
      if (path) path.setAttribute('d', config.mode === 'source' && to
        ? edgeCurvePoints(p.x, p.y, to.x, handleY(to))
        : edgeCurvePoints(startPoint.x, startPoint.y, p.x, p.y));
      const hit = document.elementFromPoint?.(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-handle-kind]');
      canvasRef.current?.querySelectorAll('.chatflow-handle.connection-hover').forEach((handle) => handle.classList.remove('connection-hover'));
      if (hit?.matches(candidateSelector)) hit.classList.add('connection-hover');
    };
    const finish = (pointer: PointerEvent) => {
      const hit = document.elementFromPoint?.(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-handle-kind]') || (pointer.target as HTMLElement | null)?.closest?.('[data-handle-kind]');
      if (hit?.matches(candidateSelector)) {
        const targetId = hit.dataset.nodeId || '';
        const index = hit.dataset.branchIndex === undefined ? null : Number(hit.dataset.branchIndex);
        if (config.mode === 'create') applyConnection(config.sourceId, targetId, config.branchIndex);
        else if (config.mode === 'target' && config.edge) applyConnection(config.sourceId, targetId, config.branchIndex, config.edge, true);
        else if (config.mode === 'source' && config.edge && config.targetId) applyConnection(targetId, config.targetId, index, config.edge);
      } else {
        const attempted = document.elementFromPoint?.(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-handle-kind]') || (pointer.target as HTMLElement | null)?.closest?.('[data-handle-kind]');
        if (attempted && !(config.mode === 'create' && attempted.dataset.nodeId === config.sourceId && attempted.dataset.handleKind === 'output')) setRunError('That handle is not a valid destination for this connection.');
      }
      ignoreHandleClickRef.current = true; window.setTimeout(() => { ignoreHandleClickRef.current = false; }, 0);
      finishWire();
    };
    const cancel = () => finishWire();
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); };
    wireCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true }); window.addEventListener('pointercancel', cancel, { once: true });
  };
  const removeEdge = (from: string, to: string) => {
    const source = draft.nodes.find((node) => node.id === from);
    const outgoing = draft.edges.filter(([edgeFrom]) => edgeFrom === from);
    const index = outgoing.findIndex(([, edgeTo]) => edgeTo === to);
    const removePair = source?.kind === 'condition' && index === 0 && outgoing.length === 2;
    edit((current) => ({ ...current, edges: current.edges.filter(([edgeFrom, edgeTo]) => removePair ? edgeFrom !== from : edgeFrom !== from || edgeTo !== to) }));
    setSelectedEdge('');
    if (removePair) setRunError('The Flow API stores Condition branches by edge order. Removing True also removes False; reconnect both branches to keep their labels accurate.');
  };
  const updateNode = (id: string, update: Partial<Node>) => edit((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...update } : node) }));
  const undo = () => { const previous = history[history.length - 1]; if (!previous) return; setFuture((items) => [...items, cloneDraft(draft)]); setDraft(previous); setHistory((items) => items.slice(0, -1)); setStatus('dirty'); setRunError(''); setSelectedEdge(''); };
  const redo = () => { const next = future[future.length - 1]; if (!next) return; setHistory((items) => [...items, cloneDraft(draft)]); setDraft(next); setFuture((items) => items.slice(0, -1)); setStatus('dirty'); setRunError(''); setSelectedEdge(''); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && canEdit && selectedEdge) { const edge = draft.edges.find((item) => edgeKey(item) === selectedEdge); if (edge) { event.preventDefault(); removeEdge(edge[0], edge[1]); return; } }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNode && canEdit) { event.preventDefault(); removeNode(selectedNode.id); }
      if (event.key === 'Escape') { finishWire(); setConnectFrom(''); setConnectBranch(null); setSelectedEdge(''); setSelected(''); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    if (!canEdit || !assistantId || status === 'saving' || status === 'loading') return;
    if (integrityIssue) { setRunError(integrityIssue); return; }
    setStatus('saving'); setSaveError('');
    try {
      const payload = { name: flowName, graph };
      const saved = flowId && version !== undefined
        ? await updateFlow(workspaceSlug, flowId, { version, ...payload })
        : await createFlow(workspaceSlug, { assistantId, ...payload });
      setFlowId(saved.id); setVersion(saved.version); setFlows((old) => [saved, ...old.filter((item) => item.id !== saved.id)]);
      setDraft({ name: saved.name, nodes: saved.graph.nodes, edges: saved.graph.edges }); setStatus('clean');
    } catch (reason) { setStatus('failed'); setSaveError(errorMessage(reason)); }
  };
  const testFlow = async (message: string) => {
    if (executableIssue) { setRunError(executableIssue); return; }
    if (!flowId || !message.trim() || chatBusy) return;
    const text = message.trim(); setChat((old) => [...old, { id: messageId(), role: 'visitor', text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]); setChatBusy(true); setRunError('');
    try {
      const result = await runFlow(workspaceSlug, flowId, text, messageId());
      setRunReply(result); setChat((old) => [...old, { id: messageId(), role: 'ai', text: result.reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    } catch (reason) { const error = errorMessage(reason); setRunError(error); setChat((old) => [...old, { id: messageId(), role: 'error', text: error, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]); }
    finally { setChatBusy(false); }
  };
  const retryLastChatMessage = () => {
    const previous = [...chat].reverse().find((message) => message.role === 'visitor');
    if (!previous || !flowId || chatBusy) return;
    setChat((old) => old.filter((message) => message.role !== 'error'));
    setRetryText(previous.text);
  };
  const beginNodeDrag = (event: ReactPointerEvent<HTMLElement>, node: Node) => {
    if (event.button !== 0 || !canEdit || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault(); setSelected(node.id); setSelectedEdge('');
    const element = event.currentTarget;
    setHistory((old) => [...old.slice(-39), cloneDraft(draft)]); setFuture([]);
    const sx = event.clientX, sy = event.clientY, ox = node.x, oy = node.y;
    let finalX = node.x, finalY = node.y;
    const nodesById = new Map(draft.nodes.map((item) => [item.id, item] as const));
    const paths = Array.from(canvasRef.current?.querySelectorAll<SVGPathElement>('.chatflow-edge,.chatflow-edge-hit') || [])
      .map((path) => ({ path, source: path.dataset.sourceNode || '', target: path.dataset.targetNode || '', branch: Number(path.dataset.branchIndex || 0) }))
      .filter((edge) => edge.source === node.id || edge.target === node.id);
    const move = (e: PointerEvent) => {
      finalX = Math.min(19770, Math.max(0, ox + (e.clientX - sx) / zoom));
      finalY = Math.min(19800, Math.max(0, oy + (e.clientY - sy) / zoom));
      element.style.left = `${finalX}px`; element.style.top = `${finalY}px`;
      for (const edge of paths) {
        const from = nodesById.get(edge.source), to = nodesById.get(edge.target);
        if (!from || !to) continue;
        edge.path.setAttribute('d', edgeCurve(edge.source === node.id ? { ...from, x: finalX, y: finalY } : from, edge.target === node.id ? { ...to, x: finalX, y: finalY } : to, edge.branch));
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); dragCleanup.current = null;
      if (finalX !== node.x || finalY !== node.y) setDraft((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? { ...item, x: finalX, y: finalY } : item) }));
      setStatus('dirty');
    };
    dragCleanup.current?.(); dragCleanup.current = stop;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); window.addEventListener('pointercancel', stop, { once: true });
  };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.chatflow-node,.chatflow-edge,.chatflow-control')) return;
    const sx = event.clientX, sy = event.clientY, ox = pan.x, oy = pan.y;
    let next = { x: ox, y: oy };
    const world = canvasRef.current?.querySelector<HTMLElement>('.chatflow-canvas-world');
    const move = (e: PointerEvent) => {
      next = { x: ox + e.clientX - sx, y: oy + e.clientY - sy };
      if (world) world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${zoom})`;
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); if (next.x !== ox || next.y !== oy) setPan(next); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };
  const fitCanvas = () => {
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect || draft.nodes.length === 0) return;
    const minX = Math.min(...draft.nodes.map((n) => n.x)), minY = Math.min(...draft.nodes.map((n) => n.y));
    const maxX = Math.max(...draft.nodes.map((n) => n.x + 240)), maxY = Math.max(...draft.nodes.map((n) => n.y + 140));
    const next = Math.min(1.2, Math.max(.12, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 80) / (maxY - minY))));
    setZoom(next); setPan({ x: 40 - minX * next, y: 40 - minY * next });
  };
  const dropPaletteNode = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); const kind = event.dataTransfer.getData('application/carteio-flow-node') as Kind;
    if (!kind || !palette.some((item) => item.kind === kind)) return;
    const rect = event.currentTarget.getBoundingClientRect(); addNode(kind, { x: Math.min(19770, Math.max(0, (event.clientX - rect.left - pan.x) / zoom)), y: Math.min(19800, Math.max(0, (event.clientY - rect.top - pan.y) / zoom)) });
  };
  const activeAssistantName = assistant?.name || 'Choose an assistant';
  const selectedEdgeTuple = draft.edges.find((edge) => edgeKey(edge) === selectedEdge);
  const selectedEdgeSource = selectedEdgeTuple && draft.nodes.find((node) => node.id === selectedEdgeTuple[0]);
  const selectedEdgeTarget = selectedEdgeTuple && draft.nodes.find((node) => node.id === selectedEdgeTuple[1]);
  const selectedEdgeBranch = selectedEdgeTuple ? draft.edges.filter(([from]) => from === selectedEdgeTuple[0]).findIndex(([, to]) => to === selectedEdgeTuple[1]) : -1;
  const selectedEdgeRemovesBothConditionBranches = selectedEdgeSource?.kind === 'condition' && selectedEdgeBranch === 0 && draft.edges.filter(([from]) => from === selectedEdgeSource.id).length === 2;
  const previewSource = wireDraft && draft.nodes.find((node) => node.id === wireDraft.sourceId);
  const previewTarget = wireDraft?.targetId && draft.nodes.find((node) => node.id === wireDraft.targetId);
  const initialPointer = wirePointerRef.current;
  const previewPath = wireDraft && previewSource
    ? wireDraft.mode === 'source' && previewTarget
      ? edgeCurvePoints(initialPointer.x, initialPointer.y, previewTarget.x, handleY(previewTarget))
      : edgeCurvePoints(previewSource.x + 230, handleY(previewSource, wireDraft.branchIndex ?? 0), initialPointer.x, initialPointer.y)
    : '';

  return <section className={`chatflow-builder${chatOpen ? ' chatflow-chat-open' : ''}${selectedNode ? ' has-selection' : ''}${wireMode ? ' chatflow-wiring' : ''}`} aria-label="Chatflow Builder">
    <header className="chatflow-toolbar">
      <div className="chatflow-brand"><span className="chatflow-brand-icon"><Workflow size={18}/></span><div><strong>Chatflow Builder</strong><small>{workspaceName || 'Workspace'}</small></div></div>
      <div className="chatflow-flow-name"><input aria-label="Flow name" value={draft.name} maxLength={200} readOnly={!canEdit} onChange={(event) => { const name = event.target.value; edit((current) => ({ ...current, name })); }}/><ChevronDown size={14}/><select aria-label="Select saved flow" value={flowId} onChange={(event) => { const requestedId = event.target.value; if (requestedId === flowId) return; if (dirty && !window.confirm('Discard unsaved chatflow changes?')) { event.currentTarget.value = flowId; return; } const flow = flows.find((item) => item.id === requestedId); setHistory([]); setFuture([]); setChat([]); if (!flow) { setFlowId(''); setVersion(undefined); setDraft(cloneDraft(starter)); setStatus('dirty'); setSelected(''); return; } setFlowId(flow.id); setVersion(flow.version); setDraft({ name: flow.name, nodes: flow.graph.nodes, edges: flow.graph.edges }); setStatus('clean'); setSelected(''); }}><option value="">New draft</option>{flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></div>
      <div className={`chatflow-save-state state-${status === 'failed' ? 'dirty' : status}`} role="status">{status === 'loading' ? <><Activity size={14}/> Loading</> : status === 'saving' ? <><Activity size={14}/> Saving…</> : dirty ? <><Clock3 size={14}/> Unsaved changes</> : <><Check size={14}/> Changes saved</>}</div>
      <div className="chatflow-toolbar-actions"><button className="chatflow-button primary" onClick={() => void save()} disabled={!canEdit || !assistantId || !dirty || Boolean(integrityIssue)}><Save size={15}/><span>Save</span></button></div>
    </header>
    <div className="chatflow-workspace">
      <aside className="chatflow-palette" aria-label="Node Palette"><div className="chatflow-panel-title"><div><span className="chatflow-eyebrow">BUILD</span><h2>Node Palette</h2></div><GripVertical size={17}/></div><p>Drag and drop nodes to build your chatflow.</p><div className="chatflow-search"><Search size={15} aria-hidden="true"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search nodes..." aria-label="Search nodes"/>{search && <button type="button" aria-label="Clear node search" onClick={() => setSearch('')}><X size={14}/></button>}</div><div className="chatflow-palette-list">{filteredPalette.length === 0 ? <div className="chatflow-no-results"><CircleX size={16}/><span>No matching nodes</span><button type="button" onClick={() => setSearch('')}>Clear search</button></div> : filteredPalette.map(({ key, title, detail, kind, Icon, tone, disabled }) => { const startExists = kind === 'start' && draft.nodes.some((node) => node.kind === 'start'); return <button key={key} className={`chatflow-palette-item tone-${tone}`} disabled={disabled || !canEdit || !kind || startExists} draggable={!disabled && canEdit && !startExists} title={disabled ? detail : startExists ? 'A flow has one Start node.' : undefined} onDragStart={(event) => { if (kind) event.dataTransfer.setData('application/carteio-flow-node', kind); }} onClick={() => kind && addNode(kind)}><span className="chatflow-node-symbol"><Icon size={17}/></span><span className="chatflow-palette-copy"><strong>{title}</strong><small>{detail}</small></span>{disabled ? <span className="chatflow-preview-label">Preview</span> : <Plus size={15}/>}</button>; })}</div><div className="chatflow-palette-foot"><Sparkles size={15}/><span>Powered by your existing Carteio assistant and knowledge configuration.</span></div></aside>
      <main className="chatflow-canvas-panel">
        <div className="chatflow-canvas-toolbar"><div><span className="chatflow-canvas-dot"/><strong>Flow canvas</strong><span>{draft.nodes.length} nodes · {draft.edges.length} connections</span>{integrityIssue && <span className="chatflow-graph-status invalid" role="status" title={integrityIssue}>Cannot save: {integrityIssue}</span>}{!integrityIssue && executableIssue && <span className="chatflow-graph-status warning" role="status" title={executableIssue}>Not executable yet</span>}</div><div className="chatflow-canvas-actions"><button className="chatflow-control" title="Undo" aria-label="Undo" disabled={!history.length} onClick={undo}><Undo2 size={15}/></button><button className="chatflow-control" title="Redo" aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={15}/></button>{selectedNode && <button className="chatflow-control" title="Duplicate selected node" aria-label="Duplicate selected node" disabled={!canEdit} onClick={() => duplicateNode(selectedNode.id)}><Plus size={15}/></button>}<button className="chatflow-control" title="Flow settings" aria-label="Flow settings" onClick={() => setSettingsOpen(true)}><Settings2 size={15}/></button><span className="chatflow-control-divider"/><button className="chatflow-control" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.3, Math.round((value - .1) * 10) / 10))}><Minus size={15}/></button><span className="chatflow-zoom-value">{Math.round(zoom * 100)}%</span><button className="chatflow-control" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.5, Math.round((value + .1) * 10) / 10))}><Plus size={15}/></button><button className="chatflow-control chatflow-fit" onClick={fitCanvas}><MousePointer2 size={14}/> Fit</button></div></div>
        {(integrityIssue || executableIssue) && <div className={`chatflow-graph-warning${integrityIssue ? ' invalid' : ''}`} role="status"><Activity size={14}/><span>{integrityIssue ? `Cannot save this graph: ${integrityIssue}` : `Graph is editable and can be saved, but cannot run yet: ${executableIssue}`}</span></div>}
        <div className="chatflow-canvas" ref={canvasRef} onPointerDown={beginPan} onDragOver={(event) => event.preventDefault()} onDrop={dropPaletteNode} aria-label="Interactive flow canvas"><div className="chatflow-canvas-world" style={{ width: worldBounds.width, height: worldBounds.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } as CSSProperties}>
          <svg className="chatflow-edges" width={worldBounds.width} height={worldBounds.height} aria-label="Flow connections"><defs><marker id="chatflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>{draft.edges.map(([from, to]) => { const a = draft.nodes.find((item) => item.id === from), b = draft.nodes.find((item) => item.id === to); const branchIndex = draft.edges.filter(([source]) => source === from).findIndex(([, target]) => target === to); const key = edgeKey([from, to]); const path = a && b ? edgeCurve(a, b, branchIndex) : ''; return a && b ? <g key={key}><path d={path} data-source-node={from} data-target-node={to} data-branch-index={branchIndex} className={`chatflow-edge-hit${selectedEdge === key ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Select connection from ${a.title} to ${b.title}`} onClick={(event) => { event.stopPropagation(); setSelectedEdge(key); setSelected(''); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEdge(key); setSelected(''); } if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); removeEdge(from, to); } }}/><path d={path} data-source-node={from} data-target-node={to} data-branch-index={branchIndex} className={`chatflow-edge${selectedEdge === key ? ' selected' : ''}`} markerEnd="url(#chatflow-arrow)"/>{a.kind === 'condition' && <text x={a.x + 248} y={a.y + 65 + (branchIndex === 0 ? -17 : 24)} className="chatflow-edge-label">{branchIndex === 0 ? 'True' : 'False'}</text>}</g>: null; })}{wireDraft && <path ref={wirePathRef} className="chatflow-edge-preview" d={previewPath} markerEnd="url(#chatflow-arrow)"/>}</svg>
          {selectedEdgeTuple && selectedEdgeSource && selectedEdgeTarget && <><button className="chatflow-edge-endpoint source" style={{ left: selectedEdgeSource.x + 221, top: handleY(selectedEdgeSource, Math.max(0, selectedEdgeBranch)) - 9 }} aria-label={`Reconnect source of ${selectedEdgeSource.title} to ${selectedEdgeTarget.title}`} title="Drag to another output" data-handle-kind="output" data-node-id={selectedEdgeSource.id} data-branch-index={selectedEdgeSource.kind === 'condition' ? selectedEdgeBranch : ''} onPointerDown={(event) => startWire(event, { mode: 'source', edge: selectedEdgeTuple, sourceId: selectedEdgeSource.id, targetId: selectedEdgeTarget.id, branchIndex: selectedEdgeSource.kind === 'condition' ? selectedEdgeBranch : null })}><span/></button><button className="chatflow-edge-endpoint target" style={{ left: selectedEdgeTarget.x - 9, top: handleY(selectedEdgeTarget) - 9 }} aria-label={`Reconnect target of ${selectedEdgeSource.title} to ${selectedEdgeTarget.title}`} title="Drag to another input" data-handle-kind="input" data-node-id={selectedEdgeTarget.id} onPointerDown={(event) => startWire(event, { mode: 'target', edge: selectedEdgeTuple, sourceId: selectedEdgeSource.id, targetId: selectedEdgeTarget.id, branchIndex: selectedEdgeBranch })}><span/></button><button className="chatflow-edge-action" style={{ left: (selectedEdgeSource.x + selectedEdgeTarget.x + 230) / 2 - 36, top: (handleY(selectedEdgeSource, Math.max(0, selectedEdgeBranch)) + handleY(selectedEdgeTarget)) / 2 - 13 }} aria-label={selectedEdgeRemovesBothConditionBranches ? `Remove both branches from ${selectedEdgeSource.title}` : `Remove connection from ${selectedEdgeSource.title} to ${selectedEdgeTarget.title}`} title={selectedEdgeRemovesBothConditionBranches ? 'Condition branch order is stored by the Flow API; both must be reconnected.' : 'Remove connection'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeEdge(selectedEdgeSource.id, selectedEdgeTarget.id); }}>{selectedEdgeRemovesBothConditionBranches ? 'Remove branches' : 'Remove'}</button></>}
          {draft.nodes.map((node) => { const item = palette.find((entry) => entry.kind === node.kind)!; const Icon = item.Icon; return <article key={node.id} className={`chatflow-node${selected === node.id ? ' selected' : ''}${connectFrom === node.id ? ' connect-source' : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => beginNodeDrag(event, node)} onClick={(event) => { event.stopPropagation(); setSelected(node.id); setSelectedEdge(''); }} role="group" tabIndex={0} aria-label={`${node.title} node`} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(node.id); }}><button className="chatflow-handle input" data-handle-kind="input" data-node-id={node.id} title={node.kind === 'start' ? 'Start cannot receive a connection' : `Input · ${node.title}`} aria-label={`Connect to ${node.title}`} disabled={node.kind === 'start'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (ignoreHandleClickRef.current) { ignoreHandleClickRef.current = false; return; } if (connectFrom && connectFrom !== node.id) connect(node.id); else setSelected(node.id); }}/><div className="chatflow-node-heading"><span className={`chatflow-node-symbol tone-${item.tone}`}><Icon size={16}/></span><span className="chatflow-node-kind">{node.kind}</span><button className="chatflow-node-more" aria-label={`Delete ${node.title}`} title="Delete node" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeNode(node.id); }}><X size={14}/></button></div><strong>{node.title}</strong><small>{node.detail}</small>{node.kind === 'condition' ? <><button className={`chatflow-handle output chatflow-branch true${connectFrom === node.id && connectBranch === 'true' ? ' active' : ''}`} data-handle-kind="output" data-node-id={node.id} data-branch-index="0" aria-label={`Connect True branch from ${node.title}`} title="True output · drag to an input" onPointerDown={(event) => startWire(event, { mode: 'create', sourceId: node.id, branchIndex: 0 })} onClick={(event) => { event.stopPropagation(); if (ignoreHandleClickRef.current) { ignoreHandleClickRef.current = false; return; } chooseOutput(node.id, 'true'); }}>T</button><button className={`chatflow-handle output chatflow-branch false${connectFrom === node.id && connectBranch === 'false' ? ' active' : ''}`} data-handle-kind="output" data-node-id={node.id} data-branch-index="1" aria-label={`Connect False branch from ${node.title}`} title="False output · drag to an input" onPointerDown={(event) => startWire(event, { mode: 'create', sourceId: node.id, branchIndex: 1 })} onClick={(event) => { event.stopPropagation(); if (ignoreHandleClickRef.current) { ignoreHandleClickRef.current = false; return; } chooseOutput(node.id, 'false'); }}>F</button></> : node.kind !== 'response' && <button className="chatflow-handle output" data-handle-kind="output" data-node-id={node.id} aria-label={connectFrom === node.id ? `Cancel connection from ${node.title}` : `Connect from ${node.title}`} title="Output · drag to an input" onPointerDown={(event) => startWire(event, { mode: 'create', sourceId: node.id, branchIndex: null })} onClick={(event) => { event.stopPropagation(); if (ignoreHandleClickRef.current) { ignoreHandleClickRef.current = false; return; } chooseOutput(node.id); }}>{connectFrom === node.id ? <X size={12}/> : <Plus size={12}/>}</button>}</article>; })}
        </div>{draft.nodes.length === 0 && <div className="chatflow-empty"><Workflow size={25}/><strong>Start building your chatflow</strong><span>Add a node from the palette or drag it onto the canvas.</span></div>}</div>
        {(connectFrom || runError || loadError) && <div className={`chatflow-notice${runError || loadError ? ' error' : ''}`} role={runError || loadError ? 'alert' : 'status'}>{loadError || runError || `Choose a destination node for ${draft.nodes.find((node) => node.id === connectFrom)?.title || 'the connection'}.`}<button onClick={() => { setConnectFrom(''); setRunError(''); setLoadError(''); }} aria-label="Dismiss message"><X size={14}/></button></div>}
        {runReply && <div className="chatflow-run-summary" role="status"><Check size={15}/><span>Flow executed · {runReply.steps.length} steps{runReply.sources.length ? ` · ${runReply.sources.length} sources` : ''}</span><button onClick={() => setRunReply(null)} aria-label="Dismiss run summary"><X size={14}/></button>{runReply.trace && <details className="chatflow-execution-trace"><summary>Backend trace · {runReply.trace.outputs.length} executed node(s) · {runReply.trace.traversedEdges.length} traversed edge(s)</summary><ol aria-label="Executed nodes">{runReply.trace.outputs.map((output, index) => <li key={`${String(output.nodeId)}:${index}`}><strong>{String(output.nodeId)}</strong><span>{String(output.status || 'unknown')} · {String(output.kind || 'node')}</span></li>)}</ol><ol aria-label="Traversed edges">{runReply.trace.traversedEdges.map((edge, index) => <li key={`${edge.id}:${index}`}><strong>{edge.id}</strong><span>{edge.sourceNodeId} ({edge.sourceHandle}) → {edge.targetNodeId} ({edge.targetHandle})</span></li>)}</ol>{runReply.skippedNodeIds?.length ? <p>Skipped nodes: {runReply.skippedNodeIds.join(', ')}</p> : null}</details>}</div>}
      </main>
      {selectedNode && <aside className="chatflow-inspector"><div className="chatflow-panel-title"><div><span className="chatflow-eyebrow">CONFIGURATION</span><h2>Node settings</h2></div><button className="chatflow-control" aria-label="Close node settings" onClick={() => setSelected('')}><X size={15}/></button></div><div className="chatflow-inspector-node"><span className={`chatflow-node-symbol tone-${selectedNode.kind}`}><Bot size={16}/></span><div><strong>{titleFor[selectedNode.kind]}</strong><small>{selectedNode.kind} node</small></div></div><label className="chatflow-field">Node name<input value={selectedNode.title} readOnly={!canEdit} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })}/></label><label className="chatflow-field">Description<textarea rows={3} value={selectedNode.detail} readOnly={!canEdit} onChange={(event) => updateNode(selectedNode.id, { detail: event.target.value })}/></label>{['assistant', 'knowledge'].includes(selectedNode.kind) && <label className="chatflow-field">Assistant<select disabled={!canEdit} value={selectedNode.assistantId || assistantId} onChange={(event) => updateNode(selectedNode.id, { assistantId: event.target.value || undefined })}>{assistants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>Uses the assistant's existing configuration and permissions.</small></label>}{selectedNode.kind === 'transform' && <label className="chatflow-field">Message content<textarea rows={5} value={selectedNode.promptTemplate || ''} readOnly={!canEdit} onChange={(event) => updateNode(selectedNode.id, { promptTemplate: event.target.value })}/><small>{'{{input}}'} inserts the current message.</small></label>}{selectedNode.kind === 'condition' && <><label className="chatflow-field">Match<select disabled={!canEdit} value={selectedNode.conditionOperator || 'contains'} onChange={(event) => updateNode(selectedNode.id, { conditionOperator: event.target.value as Node['conditionOperator'] })}><option value="contains">Contains</option><option value="equals">Equals</option><option value="starts_with">Starts with</option></select></label><label className="chatflow-field">Text to match<input disabled={!canEdit} value={selectedNode.conditionValue || ''} onChange={(event) => updateNode(selectedNode.id, { conditionValue: event.target.value })}/></label></>}{selectedNode.kind === 'knowledge' && <><label className="chatflow-field">Result limit<input disabled={!canEdit} type="number" min={1} max={10} value={selectedNode.knowledgeLimit || 5} onChange={(event) => updateNode(selectedNode.id, { knowledgeLimit: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })}/></label><div className="chatflow-inspector-help" aria-live="polite"><strong>Effective public Knowledge access</strong>{knowledgeAccessError ? <span role="alert">Could not check assistant access: {knowledgeAccessError}</span> : knowledgeAccess ? <span>{knowledgeAccess.searchableSourceCount ?? 0} source(s) with active indexed chunks across {knowledgeAccess.knowledgeBases.length} assigned Knowledge Base(s){knowledgeAccess.knowledgeBases.length ? ` · ${knowledgeAccess.knowledgeBases.map((base) => base.name).join(', ')}` : ''}. Restricted sources are excluded from customer retrieval.</span> : <span>Checking the selected assistant’s saved Knowledge Base assignments…</span>}</div></>}<div className="chatflow-inspector-help"><Bot size={15}/><span>Settings shown here are limited to fields supported by the existing Flow API.</span></div><button className="chatflow-delete-node" onClick={() => removeNode(selectedNode.id)} disabled={!canEdit}>Delete node</button></aside>}
      {chatOpen && <aside className="chatflow-chat-panel" aria-label="Live Bot Test"><header><span className="chatflow-chat-avatar"><Bot size={17}/></span><div><strong>Live Bot Test</strong><small>{activeAssistantName} · Flow test</small></div><button className="chatflow-control" aria-label="Clear conversation" title="Clear conversation" onClick={() => { setChat([]); setRunError(''); setRunReply(null); }}><RotateCcw size={14}/></button><button className="chatflow-control" aria-label="Close chat panel" onClick={() => setChatOpen(false)}><PanelRightClose size={16}/></button></header><div className="chatflow-chat-messages" aria-live="polite">{chat.length === 0 && <div className="chatflow-chat-empty"><span className="chatflow-chat-avatar"><Bot size={20}/></span><strong>Test your flow</strong><p>Send a message to run this saved chatflow using the current assistant pipeline.</p>{!flowId && <small>Save the flow before testing.</small>}</div>}{chat.map((message) => <article key={message.id} className={`chatflow-message ${message.role}`}><p>{message.text}</p><time>{message.time}</time>{message.role === 'error' && <button className="chatflow-retry" onClick={retryLastChatMessage}>Retry</button>}</article>)}{chatBusy && <div className="chatflow-typing" role="status"><span/><span/><span/> Running flow…</div>}</div><ChatflowComposer busy={chatBusy} enabled={Boolean(flowId) && !dirty && !executableIssue} retryText={retryText} initialValue={chatDraftRef.current} onDraftChange={updateChatDraft} onRetryConsumed={() => setRetryText("")} onSend={testFlow} /></aside>}
    </div>
    {saveError && <div className="chatflow-save-toast" role="alert"><CircleX size={17}/><span>Save failed. {saveError}</span><button className="chatflow-save-retry" onClick={() => void save()} disabled={status === 'saving'}>{status === 'saving' ? 'Retrying…' : 'Retry'}</button><button className="chatflow-toast-close" aria-label="Dismiss save error" onClick={() => setSaveError('')}><X size={15}/></button></div>}
    <button className="chatflow-chat-launcher" aria-label={chatOpen ? 'Close Live Bot Test' : 'Open Live Bot Test'} title="Live Bot Test" onClick={() => setChatOpen((open) => !open)}><MessageSquare size={21}/></button>
    {settingsOpen && <div className="chatflow-modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}><section className="chatflow-settings-modal" role="dialog" aria-modal="true" aria-labelledby="chatflow-settings-title" onClick={(event) => event.stopPropagation()}><header><div><span className="chatflow-eyebrow">FLOW SETTINGS</span><h2 id="chatflow-settings-title">Flow settings</h2></div><button className="chatflow-control" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={16}/></button></header><label className="chatflow-field">Flow name<input value={draft.name} readOnly={!canEdit} onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))}/></label><label className="chatflow-field">Selected assistant<select value={assistantId} disabled={!canEdit || Boolean(flowId)} onChange={(event) => setAssistantId(event.target.value)}>{assistants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{flowId ? 'Assistant assignment is fixed for a saved flow in the current API.' : 'The flow will be created for this assistant.'}</small></label><p className="chatflow-settings-note">Description and publish lifecycle are not supported by the current Flow API.</p><footer><button className="chatflow-button secondary" onClick={() => setSettingsOpen(false)}>Close</button><button className="chatflow-button primary" disabled={!dirty || !canEdit || Boolean(integrityIssue)} onClick={() => { setSettingsOpen(false); void save(); }}><Save size={14}/> Save flow</button></footer></section></div>}
  </section>;
}
