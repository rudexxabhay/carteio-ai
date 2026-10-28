import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, Bot, Braces, Check, ChevronDown, CirclePlay, Download, GitBranch, MessageSquare, Minus, Plus, RefreshCw, Save, Search, Settings2, Trash2, Upload, Workflow, X } from 'lucide-react';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { listAssistants, type Assistant } from '../../services/api/assistants';
import { createFlow, deleteFlow, listFlows, runFlow, updateFlow, type FlowDefinition, type FlowExecutionFailureDiagnostics, type FlowRunReply } from '../../services/api/flows';
import { ApiError } from '../../services/api/client';
import './flow-builder.css';

type NodeKind = 'start' | 'transform' | 'assistant' | 'condition' | 'knowledge' | 'response';
type FlowNode = { id: string; kind: NodeKind; title: string; detail: string; x: number; y: number; promptTemplate?: string; assistantId?: string; conditionOperator?: 'contains' | 'equals' | 'starts_with'; conditionValue?: string; knowledgeLimit?: number };
type FlowDraft = { name: string; nodes: FlowNode[]; edges: Array<[string, string]> };
const titles: Record<NodeKind, string> = { start: 'Chat Input', transform: 'Message Template', assistant: 'Carteio Assistant', condition: 'If / Else', knowledge: 'Knowledge Search', response: 'AI Response' };
const icons = { start: MessageSquare, transform: Braces, assistant: Bot, condition: GitBranch, knowledge: Search, response: Check };
const initial: FlowDraft = { name: 'New assistant flow', nodes: [
  { id: 'start', kind: 'start', title: 'Chat Input', detail: 'Receive a customer message', x: 100, y: 110 },
  { id: 'assistant', kind: 'assistant', title: 'Carteio Assistant', detail: 'Run configured provider, retrieval, and response safety', x: 500, y: 110 },
  { id: 'response', kind: 'response', title: 'AI Response', detail: 'Return the assistant response', x: 840, y: 110 },
], edges: [['start', 'assistant'], ['assistant', 'response']] };
const storageKey = (slug: string, assistant: string) => `carteio.flow-draft.v1:${slug}:${assistant}`;
const preferredSelection = (nodes: FlowNode[]) => nodes.find((node) => node.kind === 'assistant')?.id || nodes[0]?.id || '';
function isFlowExecutionFailureDiagnostics(value: unknown): value is FlowExecutionFailureDiagnostics {
  if (typeof value !== 'object' || value === null) return false;
  const trace = value as Partial<FlowExecutionFailureDiagnostics>;
  return typeof trace.traceId === 'string' && typeof trace.runId === 'string'
    && typeof trace.flowVersion === 'number' && Array.isArray(trace.completedSteps)
    && Array.isArray(trace.traversedEdges) && typeof trace.failedStep === 'object' && trace.failedStep !== null
    && typeof trace.failedStep.nodeId === 'string' && typeof trace.failedStep.kind === 'string'
    && trace.failedStep.status === 'FAILED' && typeof trace.failedStep.reasonCode === 'string'
    && (trace.failedStep.retrievalStage === undefined || trace.failedStep.retrievalStage === 'KNOWLEDGE_RETRIEVAL')
    && (trace.failedStep.lexicalStatus === undefined || trace.failedStep.lexicalStatus === 'NOT_REPORTED')
    && (trace.failedStep.semanticStatus === undefined || trace.failedStep.semanticStatus === 'NOT_REPORTED');
}
function runnableIssue(draft: FlowDraft): string | null {
  const count = (kind: NodeKind) => draft.nodes.filter((node) => node.kind === kind).length;
  if (count('start') !== 1) return 'Add exactly one Chat Input node.';
  if (count('assistant') < 1) return 'Add at least one Carteio Assistant node.';
  if (count('response') < 1) return 'Add at least one AI Response node.';
  if (draft.nodes.some((node) => node.kind === 'transform' && (!node.promptTemplate || node.promptTemplate.length > 2000))) return 'Each Message Template needs a template of 1–2000 characters.';
  if (draft.nodes.some((node) => node.kind === 'condition' && (!node.conditionOperator || !node.conditionValue?.trim() || node.conditionValue.length > 2000))) return 'Each If / Else node needs a comparison and a value.';
  const ids = new Set(draft.nodes.map((node) => node.id));
  if (ids.size !== draft.nodes.length) return 'Node identifiers must be unique. Remove and re-add the duplicate node.';
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  draft.nodes.forEach((node) => incoming.set(node.id, 0));
  const edgeKeys = new Set<string>();
  for (const [from, to] of draft.edges) {
    const key = `${from}\u0000${to}`;
    if (!ids.has(from) || !ids.has(to) || from === to || edgeKeys.has(key)) return 'Remove duplicate or invalid connections.';
    edgeKeys.add(key); outgoing.set(from, [...(outgoing.get(from) || []), to]); incoming.set(to, (incoming.get(to) || 0) + 1);
  }
  const start = draft.nodes.find((node) => node.kind === 'start')!;
  if ((incoming.get(start.id) || 0) !== 0 || [...incoming.values()].some((value) => value > 1)) return 'Start at Chat Input. Branch paths need separate nodes and cannot merge yet.';
  const visited = new Set<string>();
  const visit = (node: FlowNode, hasAssistant: boolean): string | null => {
    if (visited.has(node.id)) return 'Connect each branch through its own nodes; cycles and merged branches are not supported.';
    visited.add(node.id);
    const assistantOnPath = hasAssistant || node.kind === 'assistant';
    const nextIds = outgoing.get(node.id) || [];
    if (node.kind === 'response') return nextIds.length || !assistantOnPath ? 'Every branch must end at AI Response after an assistant.' : null;
    if (node.kind === 'condition' ? nextIds.length !== 2 : nextIds.length !== 1) return node.kind === 'condition' ? 'Connect both True and False outputs of each If / Else node.' : 'Connect every step to one next node.';
    for (const nextId of nextIds) {
      const next = draft.nodes.find((candidate) => candidate.id === nextId);
      if (!next || next.kind === 'start') return 'Only Chat Input can start a flow.';
      const issue = visit(next, assistantOnPath);
      if (issue) return issue;
    }
    return null;
  };
  const issue = visit(start, false);
  if (issue) return issue;
  if (visited.size !== draft.nodes.length) return 'Connect every node to a reachable Chat Input path.';
  return null;
}
const edgePath = (from: FlowNode, to: FlowNode, branchIndex = 0) => {
  const x1 = from.x + 218, y1 = from.y + 61 + (from.kind === 'condition' ? branchIndex === 0 ? -18 : 18 : 0), x2 = to.x, y2 = to.y + 61;
  const curve = Math.max(40, Math.abs(x2 - x1) * .45);
  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
};
function readDraft(key: string): FlowDraft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    if (value && typeof value === 'object' && Array.isArray((value as FlowDraft).nodes) && Array.isArray((value as FlowDraft).edges)) {
      const local = value as { name?: unknown; nodes: Array<Record<string, unknown>>; edges: unknown[] };
      const nodes: FlowNode[] = local.nodes.map((raw) => {
        const kind = raw.kind === 'model' ? 'assistant' : raw.kind;
        if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.id) || !['start', 'transform', 'assistant', 'condition', 'knowledge', 'response'].includes(String(kind)) || typeof raw.title !== 'string' || raw.title.length < 1 || raw.title.length > 120 || typeof raw.detail !== 'string' || raw.detail.length > 500 || typeof raw.x !== 'number' || !Number.isFinite(raw.x) || typeof raw.y !== 'number' || !Number.isFinite(raw.y)) throw new Error('Invalid local draft node');
        if (kind === 'transform' && (typeof raw.promptTemplate !== 'string' || raw.promptTemplate.length < 1 || raw.promptTemplate.length > 2000)) throw new Error('Invalid local template');
        if (['assistant', 'knowledge'].includes(String(kind)) && raw.assistantId !== undefined && (typeof raw.assistantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.assistantId))) throw new Error('Invalid local assistant');
        if (kind === 'knowledge' && raw.knowledgeLimit !== undefined && (!Number.isInteger(raw.knowledgeLimit) || Number(raw.knowledgeLimit) < 1 || Number(raw.knowledgeLimit) > 10)) throw new Error('Invalid local knowledge result limit');
        if (kind === 'condition' && (typeof raw.conditionOperator !== 'string' || !['contains', 'equals', 'starts_with'].includes(raw.conditionOperator) || typeof raw.conditionValue !== 'string' || raw.conditionValue.length > 2000)) throw new Error('Invalid local condition');
        return { id: raw.id as string, kind: kind as NodeKind, title: raw.title as string, detail: raw.detail as string, x: raw.x as number, y: raw.y as number, ...(kind === 'transform' ? { promptTemplate: raw.promptTemplate as string } : {}), ...(['assistant', 'knowledge'].includes(String(kind)) && typeof raw.assistantId === 'string' ? { assistantId: raw.assistantId } : {}), ...(kind === 'condition' ? { conditionOperator: raw.conditionOperator as FlowNode['conditionOperator'], conditionValue: raw.conditionValue as string } : {}), ...(kind === 'knowledge' ? { knowledgeLimit: raw.knowledgeLimit as number | undefined } : {}) };
      });
      const ids = new Set(nodes.map((node) => node.id));
      const edges = local.edges.map((edge) => {
        if (!Array.isArray(edge) || edge.length !== 2 || typeof edge[0] !== 'string' || typeof edge[1] !== 'string' || !ids.has(edge[0]) || !ids.has(edge[1]) || edge[0] === edge[1]) throw new Error('Invalid local draft edge');
        return [edge[0], edge[1]] as [string, string];
      });
      if (ids.size !== nodes.length || edges.length > 250 || nodes.length > 100) throw new Error('Invalid local draft size');
      return { name: typeof local.name === 'string' ? local.name.slice(0, 200) : initial.name, nodes, edges };
    }
  } catch { /* use the starter draft */ }
  return structuredClone(initial);
}
function hasLocalDraft(key: string) { try { return localStorage.getItem(key) !== null; } catch { return false; } }
function newId() { return `node-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`; }
function newUuid() { return globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => { const value = Math.random() * 16 | 0; return (char === 'x' ? value : (value & 0x3 | 0x8)).toString(16); }); }

export function FlowBuilderPage() {
  const { workspace } = useWorkspaceRoute();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [savedFlows, setSavedFlows] = useState<FlowDefinition[]>([]);
  const [assistantId, setAssistantId] = useState('');
  const [draft, setDraft] = useState<FlowDraft>(() => structuredClone(initial));
  const [flowId, setFlowId] = useState('');
  const [selectedId, setSelectedId] = useState('assistant');
  const [connectFrom, setConnectFrom] = useState('');
  const [connectBranch, setConnectBranch] = useState<'true' | 'false' | null>(null);
  const [zoom, setZoom] = useState(1);
  const [input, setInput] = useState('Where can I find information about your business?');
  const [reply, setReply] = useState<FlowRunReply | null>(null);
  const [runError, setRunError] = useState('');
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<'loading' | 'ready' | 'offline' | 'conflict'>('loading');
  const [refreshingFlow, setRefreshingFlow] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const runAbort = useRef<AbortController | null>(null);
  const selected = draft.nodes.find((node) => node.id === selectedId) || null;
  const runIssue = runnableIssue(draft);
  const assistant = assistants.find((item) => item.id === assistantId);
  const flowMatchesAssistant = !flowId || savedFlows.some((flow) => flow.id === flowId && flow.assistantId === assistantId);
  const canManageFlows = workspace.role === 'owner' || workspace.role === 'admin';
  const key = useMemo(() => storageKey(workspace.slug, assistantId || 'unassigned'), [workspace.slug, assistantId]);

  useEffect(() => () => { runAbort.current?.abort(new DOMException('Builder closed', 'AbortError')); }, []);

  useEffect(() => {
    const controller = new AbortController();
    listAssistants(workspace.slug, 1, controller.signal).then((result) => {
      setAssistants(result.assistants);
      const firstAssistant = result.assistants[0];
      if (firstAssistant) setAssistantId((current) => current || firstAssistant.id);
    }).catch(() => setAssistants([]));
    return () => controller.abort();
  }, [workspace.slug]);
  useEffect(() => {
    if (!assistantId) { const localDraft = readDraft(key); setDraft(localDraft); setSelectedId(preferredSelection(localDraft.nodes)); setFlowId(''); setPersistenceStatus('ready'); return; }
    const controller = new AbortController();
    setPersistenceStatus('loading'); setSaved(false); setFlowId(''); setSavedFlows([]); setReply(null); setRunError(''); setConnectFrom(''); setConnectBranch(null);
    listFlows(workspace.slug, assistantId, controller.signal).then((flows) => {
      if (controller.signal.aborted) return;
      setSavedFlows(flows);
      const flow = flows[0];
      if (flow) { setFlowId(flow.id); setDraft({ name: flow.name, nodes: flow.graph.nodes, edges: flow.graph.edges }); setSelectedId(preferredSelection(flow.graph.nodes)); setSaved(true); }
      else { const localDraft = readDraft(key); setDraft(localDraft); setSelectedId(preferredSelection(localDraft.nodes)); setSaved(hasLocalDraft(key)); setPersistenceStatus(hasLocalDraft(key) ? 'offline' : 'ready'); }
    }).catch(() => {
      if (!controller.signal.aborted) { const localDraft = readDraft(key); setDraft(localDraft); setSelectedId(preferredSelection(localDraft.nodes)); setSaved(hasLocalDraft(key)); setPersistenceStatus('offline'); }
    });
    return () => controller.abort();
  }, [key, workspace.slug, assistantId]);

  function patchNode(id: string, update: Partial<FlowNode>) {
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...update } : node) })); setSaved(false); setRunError('');
  }
  function addNode(kind: NodeKind) {
    const node: FlowNode = { id: newId(), kind, title: titles[kind], detail: kind === 'assistant' ? 'Run a selected assistant with its own provider and knowledge configuration' : kind === 'transform' ? 'Format input or assistant output' : kind === 'condition' ? 'Route the current message on a text match' : kind === 'knowledge' ? 'Search authorized assistant knowledge' : titles[kind], x: 120 + (draft.nodes.length % 4) * 270, y: 330 + Math.floor(draft.nodes.length / 4) * 190, ...(['assistant', 'knowledge'].includes(kind) && assistantId ? { assistantId } : {}), ...(kind === 'transform' ? { promptTemplate: '{{input}}' } : {}), ...(kind === 'condition' ? { conditionOperator: 'contains' as const, conditionValue: '' } : {}), ...(kind === 'knowledge' ? { knowledgeLimit: 5 } : {}) };
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] })); setSelectedId(node.id); setSaved(false); setRunError('');
  }
  function connect(id: string, branch: 'true' | 'false' | null = null) {
    if (connectFrom === id && connectBranch === branch) {
      setConnectFrom(''); setConnectBranch(null); setRunError(''); return;
    }
    const source = draft.nodes.find((node) => node.id === id);
    if (!source) { setRunError('That node is no longer on the canvas.'); return; }
    if (source.kind === 'response') { setRunError('AI Response is an end node and cannot start a connection.'); return; }
    const outgoing = draft.edges.filter(([from]) => from === id);
    if (source.kind === 'condition') {
      if (branch === null) { setRunError('Choose a True or False output for this condition.'); return; }
      const branchIndex = branch === 'true' ? 0 : 1;
      if (outgoing[branchIndex]) { setRunError(`The ${branch} output is already connected. Remove its connection before choosing another target.`); return; }
      if (branch === 'false' && !outgoing[0]) { setRunError('Connect the True branch before the False branch.'); return; }
    } else if (outgoing.length > 0) {
      setRunError('This node already has an outgoing connection. Remove it before choosing another target.'); return;
    }
    setConnectFrom((current) => current === id && connectBranch === branch ? '' : id); setConnectBranch((current) => connectFrom === id && current === branch ? null : branch); setRunError('');
  }
  function connectTarget(id: string) {
    if (!connectFrom || connectFrom === id) { setRunError(connectFrom ? 'Choose a different node for the connection target.' : 'Choose a node output first.'); return; }
    const sourceNode = draft.nodes.find((node) => node.id === connectFrom);
    const targetNode = draft.nodes.find((node) => node.id === id);
    if (!sourceNode || !targetNode) { setRunError('A connection node is no longer on the canvas.'); return; }
    if (targetNode.kind === 'start') { setRunError('Chat Input is the flow entry point and cannot receive a connection.'); return; }
    if (draft.edges.some(([, target]) => target === id)) { setRunError(`${targetNode.title} already has an incoming connection. Branches cannot merge yet.`); return; }
    if (sourceNode?.kind === 'condition' && connectBranch === 'false' && !draft.edges.some(([from]) => from === connectFrom)) { setRunError('Connect the True branch before the False branch so the saved edge order stays clear.'); return; }
    if (draft.edges.some(([from, to]) => from === connectFrom && to === id)) { setRunError('These nodes are already connected. Remove the existing edge before choosing another target.'); return; }
    setDraft((current) => {
      const source = current.nodes.find((node) => node.id === connectFrom);
      if (source?.kind !== 'condition') return { ...current, edges: [...current.edges, [connectFrom, id]] };
      const outgoingEdges = current.edges.filter(([from]) => from === connectFrom);
      const otherEdges = current.edges.filter(([from]) => from !== connectFrom);
      const branches = connectBranch === 'true' ? [[connectFrom, id] as [string, string], ...(outgoingEdges[1] ? [outgoingEdges[1]] : [])] : [outgoingEdges[0], [connectFrom, id] as [string, string]].filter((edge): edge is [string, string] => Boolean(edge));
      return { ...current, edges: [...otherEdges, ...branches] };
    });
    setConnectFrom(''); setConnectBranch(null); setSaved(false); setRunError('');
  }
  function removeEdge(from: string, to: string) {
    setDraft((current) => {
      const sourceNode = current.nodes.find((node) => node.id === from);
      const sourceEdges = current.edges.filter(([source]) => source === from);
      const branchIndex = sourceEdges.findIndex(([, target]) => target === to);
      const resetBothBranches = sourceNode?.kind === 'condition' && branchIndex === 0 && sourceEdges.length === 2;
      return { ...current, edges: current.edges.filter(([source, target]) => source !== from || (!resetBothBranches && target !== to)) };
    });
    setSaved(false); setRunError('');
  }
  function removeNode(id: string) {
    setDraft((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== id), edges: current.edges.filter(([a, b]) => a !== id && b !== id) }));
    if (selectedId === id) setSelectedId(''); if (connectFrom === id) { setConnectFrom(''); setConnectBranch(null); } setSaved(false); setRunError('');
  }
  async function saveDraft() {
    if (!assistant || !canManageFlows || saving || persistenceStatus === 'loading') return;
    setSaving(true); setRunError('');
    const graph = { version: 1 as const, nodes: draft.nodes.map((node) => node.kind === 'assistant' ? { ...node, assistantId: node.assistantId || assistant.id } : node), edges: draft.edges };
    try {
      const currentFlow = flowId ? savedFlows.find((flow) => flow.id === flowId) : undefined;
      if (flowId && !currentFlow) throw new Error('The saved flow version is unavailable. Reload the flow list before saving.');
      const savedFlow = flowId
        ? await updateFlow(workspace.slug, flowId, { version: currentFlow!.version, name: draft.name, graph })
        : await createFlow(workspace.slug, { assistantId: assistant.id, name: draft.name, graph });
      setSavedFlows((current) => current.some((flow) => flow.id === savedFlow.id) ? current.map((flow) => flow.id === savedFlow.id ? savedFlow : flow) : [savedFlow, ...current]);
      setFlowId(savedFlow.id); setDraft({ name: savedFlow.name, nodes: savedFlow.graph.nodes, edges: savedFlow.graph.edges });
      setSelectedId(preferredSelection(savedFlow.graph.nodes));
      setSaved(true); setPersistenceStatus('ready');
      try { localStorage.setItem(key, JSON.stringify({ name: savedFlow.name, nodes: savedFlow.graph.nodes, edges: savedFlow.graph.edges })); } catch { /* server copy is authoritative */ }
    } catch (error) {
      const isVersionConflict = error instanceof ApiError && error.code === 'FLOW_VERSION_CONFLICT';
      setPersistenceStatus(isVersionConflict ? 'conflict' : 'offline'); setSaved(false);
      try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* show the remote error below */ }
      setRunError(isVersionConflict
        ? 'This flow changed in another session. Your draft is saved in this browser; load the latest workspace version to continue.'
        : error instanceof Error ? `${error.message} A browser-local recovery copy was attempted.` : 'Flow could not be saved to this workspace.');
    } finally { setSaving(false); }
  }
  async function loadLatestFlow() {
    if (!flowId || !assistantId || refreshingFlow) return;
    setRefreshingFlow(true);
    try {
      const flows = await listFlows(workspace.slug, assistantId);
      const latest = flows.find((flow) => flow.id === flowId);
      if (!latest) throw new Error('This flow is no longer available in the workspace. Your browser recovery copy is preserved.');
      try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* in-memory draft remains available until leaving the page */ }
      setSavedFlows(flows); setDraft({ name: latest.name, nodes: latest.graph.nodes, edges: latest.graph.edges });
      setSelectedId(preferredSelection(latest.graph.nodes)); setSaved(true); setPersistenceStatus('ready');
      setRunError('Loaded the latest workspace version. The previous draft remains in browser recovery storage.');
    } catch (error) {
      setRunError(error instanceof Error ? `Could not load the latest flow: ${error.message}` : 'Could not load the latest flow.');
    } finally { setRefreshingFlow(false); }
  }
  async function deleteCurrentFlow() {
    const current = savedFlows.find((flow) => flow.id === flowId);
    if (!current || !canManageFlows || deleting || !window.confirm(`Delete “${current.name}” from this workspace?${saved ? '' : ' Unsaved edits to the current flow will also be discarded.'} This cannot be undone.`)) return;
    setDeleting(true); setRunError('');
    try {
      await deleteFlow(workspace.slug, current.id);
      const remaining = savedFlows.filter((flow) => flow.id !== current.id);
      setSavedFlows(remaining);
      try { localStorage.removeItem(key); } catch { /* deleted server flow stays authoritative */ }
      const next = remaining[0];
      setFlowId(next?.id || '');
      setDraft(next ? { name: next.name, nodes: next.graph.nodes, edges: next.graph.edges } : { ...structuredClone(initial), name: 'New assistant flow' });
      setSelectedId(next ? preferredSelection(next.graph.nodes) : 'assistant');
      setSaved(Boolean(next)); setPersistenceStatus('ready'); setReply(null); setConnectFrom(''); setConnectBranch(null);
    } catch (error) {
      setRunError(error instanceof Error ? `Flow could not be deleted: ${error.message}` : 'Flow could not be deleted.');
    } finally { setDeleting(false); }
  }
  function selectFlow(id: string) {
    const flow = savedFlows.find((item) => item.id === id);
    if (!flow) return;
    setFlowId(flow.id); setDraft({ name: flow.name, nodes: flow.graph.nodes, edges: flow.graph.edges }); setSelectedId(preferredSelection(flow.graph.nodes)); setSaved(true); setRunError(''); setConnectFrom(''); setConnectBranch(null);
  }
  function startNewFlow() {
    const name = `New flow ${savedFlows.length + 1}`;
    setFlowId(''); setDraft({ ...structuredClone(initial), name }); setSelectedId('assistant'); setSaved(false); setRunError(''); setConnectFrom(''); setConnectBranch(null);
  }
  function exportDraft() {
    const content = JSON.stringify({ format: 'carteio-flow', version: 1, name: draft.name, graph: { version: 1, nodes: draft.nodes, edges: draft.edges } }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${draft.name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'carteio-flow'}.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importDraft(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 200_000) throw new Error('Flow files must be smaller than 200 KB.');
      const payload: unknown = JSON.parse(await file.text());
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('This file does not contain a Carteio flow.');
      const root = payload as Record<string, unknown>;
      const rawGraph = root.graph && typeof root.graph === 'object' && !Array.isArray(root.graph) ? root.graph as Record<string, unknown> : root;
      if (rawGraph.version !== 1 || !Array.isArray(rawGraph.nodes) || !Array.isArray(rawGraph.edges) || rawGraph.nodes.length > 100 || rawGraph.edges.length > 250) throw new Error('Flow file version or size is not supported.');
      const nodes = rawGraph.nodes.map((raw): FlowNode => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Flow file contains an invalid node.');
        const node = raw as Record<string, unknown>;
        const kind = typeof node.kind === 'string' ? node.kind : '';
        const hasAssistant = kind === 'assistant' || kind === 'knowledge';
        const validAssistantId = typeof node.assistantId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(node.assistantId);
        const validConditionOperator = typeof node.conditionOperator === 'string' && ['contains', 'equals', 'starts_with'].includes(node.conditionOperator);
        const validKnowledgeLimit = typeof node.knowledgeLimit === 'number' && Number.isInteger(node.knowledgeLimit) && node.knowledgeLimit >= 1 && node.knowledgeLimit <= 10;
        if (typeof node.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(node.id) || !['start', 'transform', 'assistant', 'condition', 'knowledge', 'response'].includes(kind) || typeof node.title !== 'string' || node.title.length < 1 || node.title.length > 120 || typeof node.detail !== 'string' || node.detail.length > 500 || typeof node.x !== 'number' || !Number.isFinite(node.x) || node.x < 0 || node.x > 20000 || typeof node.y !== 'number' || !Number.isFinite(node.y) || node.y < 0 || node.y > 20000 || kind === 'transform' && (typeof node.promptTemplate !== 'string' || node.promptTemplate.length < 1 || node.promptTemplate.length > 2000) || hasAssistant && node.assistantId !== undefined && !validAssistantId || !hasAssistant && node.assistantId !== undefined || kind === 'condition' && (!validConditionOperator || typeof node.conditionValue !== 'string' || !node.conditionValue.trim() || node.conditionValue.length > 2000) || kind !== 'condition' && (node.conditionOperator !== undefined || node.conditionValue !== undefined) || kind === 'knowledge' && node.knowledgeLimit !== undefined && !validKnowledgeLimit || kind !== 'knowledge' && node.knowledgeLimit !== undefined) throw new Error('Flow file contains an invalid node configuration.');
        return { id: node.id as string, kind: kind as NodeKind, title: node.title as string, detail: node.detail as string, x: node.x as number, y: node.y as number, ...(kind === 'transform' ? { promptTemplate: node.promptTemplate as string } : {}), ...(hasAssistant && validAssistantId ? { assistantId: node.assistantId as string } : {}), ...(kind === 'condition' ? { conditionOperator: node.conditionOperator as FlowNode['conditionOperator'], conditionValue: node.conditionValue as string } : {}), ...(kind === 'knowledge' && validKnowledgeLimit ? { knowledgeLimit: node.knowledgeLimit as number } : {}) };
      });
      const ids = new Set(nodes.map((node) => node.id));
      if (ids.size !== nodes.length || !rawGraph.edges.every((edge) => Array.isArray(edge) && edge.length === 2 && typeof edge[0] === 'string' && typeof edge[1] === 'string' && edge[0] !== edge[1] && ids.has(edge[0]) && ids.has(edge[1]))) throw new Error('Flow file contains duplicate nodes or invalid connections.');
      const edges = rawGraph.edges as Array<[string, string]>;
      if (new Set(edges.map(([from, to]) => `${from}\u0000${to}`)).size !== edges.length) throw new Error('Flow file contains duplicate connections.');
      const importedName = typeof root.name === 'string' ? root.name.trim().slice(0, 200) : '';
      const name = importedName || file.name.replace(/\.json$/i, '').slice(0, 200) || 'Imported flow';
      setDraft({ name, nodes, edges });
      setFlowId(''); setSelectedId(nodes.find((node) => node.kind === 'assistant')?.id || nodes[0]?.id || ''); setConnectFrom(''); setConnectBranch(null); setSaved(false); setReply(null); setRunError('');
      try { localStorage.setItem(key, JSON.stringify({ name, nodes, edges })); } catch { /* saving to the workspace remains available */ }
    } catch (error) { setRunError(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed. Check that the file is valid JSON.'); }
  }
  async function run(event: FormEvent) {
    event.preventDefault(); if (!assistant || !flowId || !flowMatchesAssistant || !saved || running || !input.trim() || runIssue) { if (runIssue) setRunError(runIssue); else if (!flowId || !saved) setRunError('Save this flow to the workspace before running it.'); return; }
    setRunning(true); setReply(null); setRunError('');
    const controller = new AbortController(); runAbort.current = controller;
    try { const result = await runFlow(workspace.slug, flowId, input.trim(), newUuid(), controller.signal); setReply(result); }
    catch (error) {
      const trace = error instanceof ApiError && isFlowExecutionFailureDiagnostics(error.details) ? error.details : null;
      const message = controller.signal.aborted ? 'Flow run cancelled.' : error instanceof Error ? error.message : 'The flow could not complete this run.';
      const retrievalStatus = trace?.failedStep.retrievalStage ? ` Retrieval stage: ${trace.failedStep.retrievalStage}; lexical: ${trace.failedStep.lexicalStatus}; semantic: ${trace.failedStep.semanticStatus}.` : '';
      setRunError(trace ? `${message} Failed at ${trace.failedStep.kind} node ${trace.failedStep.nodeId} (${trace.failedStep.reasonCode}).${retrievalStatus} Trace ID: ${trace.traceId}.` : message);
    }
    finally { if (runAbort.current === controller) runAbort.current = null; setRunning(false); }
  }
  function cancelRun() { runAbort.current?.abort(new DOMException('Flow run cancelled', 'AbortError')); }
  function fitCanvas() {
    const canvas = document.querySelector<HTMLElement>('.flow-canvas');
    if (!canvas) return;
    const width = Math.max(1420, ...draft.nodes.map((node) => node.x + 270));
    const height = Math.max(780, ...draft.nodes.map((node) => node.y + 170));
    const fit = Math.min((canvas.clientWidth - 40) / width, (canvas.clientHeight - 40) / height, 1);
    setZoom(Math.max(.2, Math.min(1.5, fit)));
  }
  function dragNode(event: ReactPointerEvent<HTMLElement>, node: FlowNode) {
    if ((event.target as HTMLElement).closest('button,textarea,input,select')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
    let finalX = node.x;
    let finalY = node.y;
    const connectedEdges = Array.from(element.closest('.flow-canvas-inner')?.querySelectorAll<SVGPathElement>('.flow-edge') || [])
      .map((path) => ({ path, dot: path.nextElementSibling as SVGCircleElement | null, source: path.dataset.sourceNode || '', target: path.dataset.targetNode || '', branchIndex: Number(path.dataset.branchIndex || 0) }))
      .filter((edge) => edge.source === node.id || edge.target === node.id);
    const move = (moveEvent: PointerEvent) => {
      finalX = Math.max(0, origin.nodeX + (moveEvent.clientX - origin.x) / zoom);
      finalY = Math.max(0, origin.nodeY + (moveEvent.clientY - origin.y) / zoom);
      element.style.left = `${finalX}px`;
      element.style.top = `${finalY}px`;
      for (const edge of connectedEdges) {
        const from = draft.nodes.find((item) => item.id === edge.source);
        const to = draft.nodes.find((item) => item.id === edge.target);
        if (!from || !to) continue;
        const movedFrom = edge.source === node.id ? { ...from, x: finalX, y: finalY } : from;
        const movedTo = edge.target === node.id ? { ...to, x: finalX, y: finalY } : to;
        edge.path.setAttribute('d', edgePath(movedFrom, movedTo, edge.branchIndex));
        if (edge.source === node.id) edge.dot?.setAttribute('cx', String(finalX + 218));
        if (edge.source === node.id) edge.dot?.setAttribute('cy', String(finalY + 61 + (node.kind === 'condition' ? edge.branchIndex === 0 ? -18 : 18 : 0)));
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (finalX !== node.x || finalY !== node.y) patchNode(node.id, { x: finalX, y: finalY });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  }

  return <div className={`flow-page${canManageFlows ? '' : ' flow-readonly'}`}>
    <header className="flow-topbar"><div className="flow-title"><span className="flow-mark"><Workflow size={18}/></span><div><span className="eyebrow">CARTEIO AI / BUILDER</span><h1>AI flow builder</h1></div></div><select className="flow-existing-select" aria-label="Saved flows" value={flowId} onChange={(event) => selectFlow(event.target.value)} disabled={persistenceStatus !== 'ready'}>{savedFlows.map((flow) => <option value={flow.id} key={flow.id}>{flow.name}</option>)}</select><button className="flow-new-button" aria-label="Create a new flow" title="Create a new flow" disabled={!canManageFlows || persistenceStatus === 'loading' || running} onClick={startNewFlow}><Plus size={15}/></button><input className="flow-name" aria-label="Flow name" readOnly={!canManageFlows} value={draft.name} onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); setSaved(false); }}/><label className="flow-assistant-select"><Bot size={16}/><select aria-label="Connected assistant" value={assistantId} disabled={running} onChange={(event) => setAssistantId(event.target.value)}><option value="">Choose an assistant</option>{assistants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={13}/></label><span className={`flow-save-state${saved ? '' : ' is-dirty'}`} role="status">{persistenceStatus === 'loading' ? 'Loading flow…' : persistenceStatus === 'conflict' ? 'Save conflict' : !canManageFlows ? 'View only' : saved ? <><Check size={14}/> {persistenceStatus === 'offline' ? 'Saved locally' : 'Saved to workspace'}</> : 'Unsaved draft'}</span>{persistenceStatus === 'conflict' && <button className="button button-secondary flow-save-button" disabled={refreshingFlow} onClick={() => void loadLatestFlow()}><RefreshCw size={14}/>{refreshingFlow ? 'Loading…' : 'Load latest'}</button>}<button className="flow-delete-button" aria-label="Delete saved flow" title="Delete saved flow" disabled={!flowId || !canManageFlows || deleting || saving || running} onClick={() => void deleteCurrentFlow()}><Trash2 size={15}/></button><button className="button button-secondary flow-save-button" disabled={!assistant || !canManageFlows || saving || deleting || running || persistenceStatus === 'loading' || persistenceStatus === 'conflict'} onClick={() => void saveDraft()}><Save size={15}/>{saving ? 'Saving…' : 'Save draft'}</button></header>
    <div className="flow-workspace"><aside className="flow-library"><div className="flow-panel-heading"><div><span className="eyebrow">COMPONENTS</span><h2>Node library</h2></div><Settings2 size={17}/></div><p className="flow-library-copy">Add a step to your canvas. Connect nodes to sketch the assistant path.</p><span className="flow-library-label">CHATFLOW</span>
      {(['start', 'transform', 'assistant', 'condition', 'knowledge', 'response'] as NodeKind[]).map((kind) => { const Icon = icons[kind]; const nodeExists = kind === 'start' ? draft.nodes.some((node) => node.kind === kind) : false; return <button className="flow-library-item" key={kind} disabled={nodeExists || !canManageFlows} title={!canManageFlows ? 'Workspace admins can edit shared flows' : nodeExists ? `A flow has one ${titles[kind]} node` : undefined} onClick={() => addNode(kind)}><span className={`flow-node-icon tone-${kind}`}><Icon size={16}/></span><span><strong>{titles[kind]}</strong><small>{kind === 'start' ? 'Input message' : kind === 'transform' ? 'Insert text around {{input}}' : kind === 'assistant' ? 'Run any configured workspace assistant' : kind === 'condition' ? 'Route using contains, equals, or starts with' : kind === 'knowledge' ? 'Search assigned, authorized knowledge' : 'Return the branch response'}</small></span><Plus size={15}/></button>; })}
      <div className="flow-library-note"><Activity size={16}/><span><strong>Carteio execution</strong><small>The assistant node calls the existing provider, retrieval, safety, and conversation pipeline.</small></span></div>
    </aside>
    <main className="flow-main"><div className="flow-canvas-toolbar"><div><span className="flow-live-dot"/> Canvas <span className="flow-node-count">{draft.nodes.length} nodes</span></div><div className="flow-canvas-actions"><input ref={importInput} className="flow-import-input" type="file" accept="application/json,.json" aria-label="Import a Carteio flow file" onChange={(event) => void importDraft(event)}/><button title="Import flow JSON" aria-label="Import flow JSON" disabled={!canManageFlows} onClick={() => importInput.current?.click()}><Upload size={14}/></button><button title="Export flow JSON" aria-label="Export flow JSON" onClick={exportDraft}><Download size={14}/></button><button title="Zoom out" aria-label="Zoom out" disabled={zoom <= .2} onClick={() => setZoom((current) => Math.max(.2, Math.round((current - .1) * 10) / 10))}><Minus size={15}/></button><span className="flow-zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</span><button title="Zoom in" aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => setZoom((current) => Math.min(1.5, Math.round((current + .1) * 10) / 10))}><Plus size={15}/></button><button title="Fit canvas" aria-label="Fit canvas" onClick={fitCanvas}>Fit</button><button title="Clear selection" aria-label="Clear selection" onClick={() => { setSelectedId(''); setConnectFrom(''); setConnectBranch(null); }}><X size={15}/></button></div></div>
      <section className="flow-canvas" aria-label="AI workflow canvas"><div className="flow-canvas-inner" style={{ '--flow-canvas-zoom': zoom } as CSSProperties}><svg className="flow-edges" role="group" aria-label="Node connections"><defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" className="flow-edge-arrow"/></marker></defs>{draft.edges.map(([a, b], index) => { const from = draft.nodes.find((node) => node.id === a); const to = draft.nodes.find((node) => node.id === b); if (!from || !to) return null; const branchIndex = (draft.edges.filter(([source]) => source === a).findIndex(([, target]) => target === b)); const y1 = from.y + 61 + (from.kind === 'condition' ? branchIndex === 0 ? -18 : 18 : 0); return <g key={`${a}-${b}-${index}`}><path d={edgePath(from, to, branchIndex)} data-source-node={a} data-target-node={b} data-branch-index={branchIndex} className="flow-edge" markerEnd="url(#flow-arrow)" role={canManageFlows ? 'button' : undefined} tabIndex={canManageFlows ? 0 : undefined} aria-label={`Connection from ${from.title}${from.kind === 'condition' ? `, ${branchIndex === 0 ? 'True' : 'False'} branch,` : ''} to ${to.title}. Press Delete to remove.`} onClick={() => canManageFlows && removeEdge(a, b)} onKeyDown={(event) => { if (canManageFlows && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); removeEdge(a, b); } }}/><circle cx={from.x + 218} cy={y1} r="3" className="flow-edge-dot"/></g>; })}</svg>
        {draft.nodes.map((node) => { const Icon = icons[node.kind]; return <article key={node.id} className={`flow-node${selectedId === node.id ? ' is-selected' : ''}${connectFrom === node.id ? ' is-connect-source' : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={(event) => dragNode(event, node)} onClick={() => setSelectedId(node.id)}><button className="flow-node-input-port" aria-label={`Connect to ${node.title}`} title="Incoming connection" disabled={!canManageFlows} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connectTarget(node.id); }}/><div className="flow-node-head"><span className={`flow-node-icon tone-${node.kind}`}><Icon size={16}/></span><span className="flow-node-type">{node.kind.toUpperCase()}</span><button aria-label={`Delete ${node.title}`} title="Delete node" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeNode(node.id); }}><Trash2 size={13}/></button></div><strong className="flow-node-title">{node.title}</strong><span className="flow-node-detail">{node.detail}</span><div className={`flow-node-ports${node.kind === 'condition' ? ' flow-condition-ports' : ''}`}>{node.kind === 'condition' ? <><button disabled={!canManageFlows} aria-label={`Connect True output from ${node.title}`} title="Connect True branch" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connect(node.id, 'true'); }}>T</button><button disabled={!canManageFlows} aria-label={`Connect False output from ${node.title}`} title="Connect False branch" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connect(node.id, 'false'); }}>F</button></> : <><span>out</span><button aria-label={connectFrom && connectFrom !== node.id ? `Set ${node.title} as connection source` : `Connect from ${node.title}`} title={connectFrom && connectFrom !== node.id ? 'Select as the source node' : 'Start a connection from this node'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connect(node.id); }}>{connectFrom === node.id ? <Check size={13}/> : <Plus size={13}/>}</button></>}</div></article>; })}</div>{draft.nodes.length === 0 && <div className="flow-canvas-empty"><Workflow size={22}/><strong>Your canvas is empty</strong><span>Add a component from the library to get started.</span></div>}</section>
      {connectFrom && <div className="flow-connect-hint" role="status">Choose an input port to connect from {draft.nodes.find((node) => node.id === connectFrom)?.title}{connectBranch ? ` (${connectBranch} branch)` : ''}. <button onClick={() => { setConnectFrom(''); setConnectBranch(null); }}>Cancel</button></div>}
      <section className="flow-run-panel"><div className="flow-run-heading"><div><span className="eyebrow">FLOW RUN</span><h2>Run this flow</h2></div><span className="flow-run-subtitle">Runs the saved nodes in order through Carteio assistants and templates.</span></div><form onSubmit={(event) => void run(event)}><input aria-label="Test message" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Send a message through this flow…"/>{running ? <button type="button" className="button flow-run-cancel" onClick={cancelRun}><X size={15}/> Cancel run</button> : <button className="button button-primary" disabled={!assistant || !flowId || !flowMatchesAssistant || !saved || !canManageFlows || !input.trim() || Boolean(runIssue)}><CirclePlay size={16}/> Run flow</button>}</form>{!assistant ? <p className="flow-test-note">Create or select an assistant before running a flow.</p> : !flowId || !saved ? <p className="flow-test-note">Save the flow to this workspace before running it.</p> : runIssue ? <p className="flow-test-note" role="status">Draft is not runnable yet: {runIssue}</p> : <p className="flow-test-note flow-ready-note" role="status">Graph is ready to run.</p>}{reply && <div className="flow-run-result"><span className="flow-result-label"><Check size={14}/> Run complete · {reply.providerUsed || 'configured provider'}{reply.modelUsed ? ` / ${reply.modelUsed}` : ''} · {reply.steps.length} steps</span><p>{reply.reply}</p>{reply.assistantRuns?.[0] && <small className="flow-assistant-diagnostics">Assistant node · Conversation context {reply.assistantRuns[0].usedConversationContext === undefined ? "not reported" : reply.assistantRuns[0].usedConversationContext ? "used" : "not used"} · Evidence retrieval {reply.assistantRuns[0].evidenceRetrievalRequired === undefined ? "not reported" : reply.assistantRuns[0].evidenceRetrievalRequired ? "required" : "not required"}</small>}{reply.assistantRuns && reply.assistantRuns.length > 1 && <details className="flow-assistant-runs"><summary>Assistant outputs ({reply.assistantRuns.length})</summary>{reply.assistantRuns.map((result) => <article key={result.nodeId}><strong>{draft.nodes.find((node) => node.id === result.nodeId)?.title || 'Carteio Assistant'} · {assistants.find((item) => item.id === result.assistantId)?.name || 'Assistant'}</strong><p>{result.reply}</p><small>{result.providerUsed || 'configured provider'}{result.modelUsed ? ` / ${result.modelUsed}` : ''}{result.usedConversationContext !== undefined ? ` · Conversation context ${result.usedConversationContext ? 'used' : 'not used'}` : ''}{result.evidenceRetrievalRequired !== undefined ? ` · Evidence retrieval ${result.evidenceRetrievalRequired ? 'required' : 'not required'}` : ''}</small></article>)}</details>}{reply.knowledgeRuns?.map((result) => <details className="flow-assistant-runs" key={result.nodeId}><summary>Knowledge results · {result.results.length} chunks · {result.mode}</summary><small>Retrieval: {result.retrieval.stage}; lexical {result.retrieval.lexicalStatus}; semantic {result.retrieval.semanticStatus}{result.retrieval.reasonCode ? ` · ${result.retrieval.reasonCode}` : ''}</small>{result.results.map((item, index) => <article key={`${item.sourceTitle}-${index}`}><strong>{item.sourceTitle} · {Math.round(item.score * 100) / 100}</strong><p>{item.content}</p>{item.pageUrl && <small>{item.pageUrl}</small>}</article>)}{!result.results.length && <p>No authorized matching chunks ({result.eligibleSourceCount} eligible sources).</p>}</details>)}{reply.sources.length > 0 && <small>Sources: {reply.sources.map((source) => source.title).join(', ')}</small>}<ol className="flow-run-steps">{reply.steps.map((step) => <li key={step.nodeId}><Check size={12}/><span>{titles[step.kind as NodeKind] || step.kind}</span><small>{step.branch ? `${step.branch} · ` : ''}{step.durationMs} ms</small></li>)}</ol>{reply.skippedNodeIds && reply.skippedNodeIds.length > 0 && <details className="flow-skipped-nodes"><summary>Skipped nodes ({reply.skippedNodeIds.length})</summary><ul>{reply.skippedNodeIds.map((nodeId) => <li key={nodeId}>{draft.nodes.find((node) => node.id === nodeId)?.title || nodeId}</li>)}</ul></details>}</div>}{runError && <p className="flow-run-error" role="alert">{runError}</p>}</section>
    </main>
    <aside className="flow-inspector"><div className="flow-panel-heading"><div><span className="eyebrow">CONFIGURATION</span><h2>{selected ? 'Node settings' : 'Flow details'}</h2></div><Settings2 size={17}/></div>{selected ? <><span className="flow-inspector-kind"><span className={`flow-node-icon tone-${selected.kind}`}>{(() => { const Icon = icons[selected.kind]; return <Icon size={16}/>; })()}</span>{titles[selected.kind]}</span><label className="flow-field">Node name<input readOnly={!canManageFlows} value={selected.title} onChange={(event) => patchNode(selected.id, { title: event.target.value })}/></label><label className="flow-field">Description<textarea readOnly={!canManageFlows} rows={3} value={selected.detail} onChange={(event) => patchNode(selected.id, { detail: event.target.value })}/></label>{['assistant', 'knowledge'].includes(selected.kind) && <label className="flow-field">Assistant<select disabled={!canManageFlows} value={selected.assistantId || assistantId} onChange={(event) => patchNode(selected.id, { assistantId: event.target.value || undefined })}><option value="">Use connected assistant</option>{assistants.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.status}</option>)}</select><small>{selected.kind === 'knowledge' ? 'Search this assistant’s authorized knowledge sources.' : 'Runs in sequence and passes its response to the next node.'}</small></label>}{selected.kind === 'knowledge' && <label className="flow-field">Result limit<input type="number" min={1} max={10} value={selected.knowledgeLimit || 5} disabled={!canManageFlows} onChange={(event) => patchNode(selected.id, { knowledgeLimit: Math.max(1, Math.min(10, Number(event.target.value) || 5)) })}/><small>Searches this assistant’s authorized knowledge and shows ranked source chunks in the run trace.</small></label>}{selected.kind === 'condition' && <><label className="flow-field">Match<select disabled={!canManageFlows} value={selected.conditionOperator || 'contains'} onChange={(event) => patchNode(selected.id, { conditionOperator: event.target.value as FlowNode['conditionOperator'] })}><option value="contains">Message contains</option><option value="equals">Message equals</option><option value="starts_with">Message starts with</option></select></label><label className="flow-field">Text to match<input readOnly={!canManageFlows} value={selected.conditionValue || ''} maxLength={2000} onChange={(event) => patchNode(selected.id, { conditionValue: event.target.value })}/><small>Checks the current input or the preceding assistant response, ignoring letter case.</small></label></>}{selected.kind === 'transform' && <label className="flow-field">Message template<textarea readOnly={!canManageFlows} rows={5} value={selected.promptTemplate || ''} onChange={(event) => patchNode(selected.id, { promptTemplate: event.target.value })}/><small>{'{{input}}'} inserts the current message.</small></label>}<div className="flow-inspector-divider"/><div className="flow-config-note"><Bot size={16}/><span><strong>{selected.kind === 'transform' ? 'Template execution' : selected.kind === 'assistant' ? 'Carteio AI pipeline' : selected.kind === 'condition' ? 'Branch execution' : selected.kind === 'knowledge' ? 'Authorized retrieval' : 'Flow execution'}</strong><small>{selected.kind === 'transform' ? 'Formats the current value, which may be the user input or the assistant response depending on its position in the flow.' : selected.kind === 'assistant' ? 'Runs this assistant’s provider, assigned knowledge retrieval, safety, and conversation pipeline.' : selected.kind === 'condition' ? 'True follows the first output connection. False follows the second. Connect True first.' : selected.kind === 'knowledge' ? 'Searches with the existing workspace and assistant permission filters. Results are trace output; the assistant retains its own retrieval and safety path.' : 'This control node is validated and executed by the saved flow runner.'}</small></span></div>{selected.kind !== 'condition' && <button className="flow-connect-button" disabled={!canManageFlows} onClick={() => connect(selected.id)}><Plus size={15}/> {connectFrom === selected.id ? 'Cancel source selection' : connectFrom ? 'Choose this as the source' : 'Choose this as the source'}</button>}</> : <div className="flow-inspector-empty"><Workflow size={20}/><p>Select a node to edit its settings.</p><small>Drag nodes to rearrange the canvas. Choose an output plus, then a destination input port.</small></div>}<div className="flow-inspector-footer"><span>WORKSPACE</span><strong>{workspace.name}</strong></div></aside></div>
  </div>;
}
