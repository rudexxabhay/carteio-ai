import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export type FlowGraph = {
  version: 1;
  nodes: Array<{ id: string; kind: 'start' | 'transform' | 'assistant' | 'condition' | 'knowledge' | 'response'; title: string; detail: string; x: number; y: number; promptTemplate?: string; assistantId?: string; conditionOperator?: 'contains' | 'equals' | 'starts_with'; conditionValue?: string; knowledgeLimit?: number }>;
  edges: Array<[string, string]>;
  /** Optional for legacy graphs; identifies the persisted output/input handles for each tuple. */
  edgeMetadata?: Array<{ id: string; sourceHandle: string; targetHandle: string }>;
};
export interface FlowDefinition {
  id: string;
  organizationId: string;
  assistantId: string;
  name: string;
  version: number;
  graph: FlowGraph;
  createdAt: string;
  updatedAt: string;
}
export interface FlowExecutionFailureDiagnostics {
  traceId: string;
  runId: string;
  flowVersion: number;
  completedSteps: Array<{ index: number; nodeId: string; kind: string; status: 'SUCCEEDED'; durationMs: number }>;
  failedStep: { index: number; nodeId: string; kind: string; status: 'FAILED'; durationMs: number; reasonCode: string; retrievalStage?: 'KNOWLEDGE_RETRIEVAL'; lexicalStatus?: 'NOT_REPORTED'; semanticStatus?: 'NOT_REPORTED' };
  traversedEdges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; sourceHandle: string; targetHandle: string }>;
  relatedConversationTraceId?: string;
}
export interface FlowRunReply {
  runId: string;
  flowId: string;
  flowVersion: number;
  assistantId: string;
  sessionId: string;
  messageId?: string;
  reply: string;
  assistantReply?: string;
  knowledgeRuns?: Array<{ nodeId: string; query: string; mode: string; eligibleSourceCount: number; retrieval: { stage: 'KNOWLEDGE_RETRIEVAL'; lexicalStatus: 'COMPLETED' | 'SKIPPED'; semanticStatus: 'COMPLETED' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'SKIPPED'; reasonCode?: string; semanticUnavailableCode?: string }; results: Array<{ content: string; sourceTitle: string; pageUrl: string | null; locator: string | null; score: number }> }> ;
  assistantRuns?: Array<{ nodeId: string; assistantId: string; reply: string; sessionId: string; messageId?: string; providerUsed?: string; modelUsed?: string; usedConversationContext?: boolean; evidenceRetrievalRequired?: boolean }>;
  sources: Array<{ reference: string; title: string; type: string; locator: string | null }>;
  providerUsed?: string;
  modelUsed?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  responseNodeId?: string;
  skippedNodeIds?: string[];
  trace?: { requestId: string; traceId?: string; runId: string; flowVersion: number; inputChars: number; outputs: Array<Record<string, unknown>>; traversedEdges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; sourceHandle: string; targetHandle: string }> };
  steps: Array<{ nodeId: string; kind: string; status: 'SUCCEEDED'; durationMs: number; branch?: 'true' | 'false' }>;
}

const base = (slug: string) => `/workspaces/${encodeURIComponent(slug)}/flows`;
export function listFlows(slug: string, assistantId: string, signal?: AbortSignal) {
  return apiGet<FlowDefinition[]>(`${base(slug)}?assistantId=${encodeURIComponent(assistantId)}`, signal);
}
export function createFlow(slug: string, input: Pick<FlowDefinition, 'assistantId' | 'name' | 'graph'>, signal?: AbortSignal) {
  return apiPost<FlowDefinition>(base(slug), input, signal);
}
export function updateFlow(slug: string, id: string, input: Pick<FlowDefinition, 'version'> & Partial<Pick<FlowDefinition, 'name' | 'graph'>>, signal?: AbortSignal) {
  const { version, ...changes } = input;
  return apiPatch<FlowDefinition>(`${base(slug)}/${encodeURIComponent(id)}`, { ...changes, expectedVersion: version }, signal);
}
export function deleteFlow(slug: string, id: string, signal?: AbortSignal) {
  return apiDelete<{ deleted: true; id: string }>(`${base(slug)}/${encodeURIComponent(id)}`, signal);
}
export function runFlow(slug: string, id: string, message: string, clientTurnId: string, signal?: AbortSignal) {
  return apiPost<FlowRunReply>(`${base(slug)}/${encodeURIComponent(id)}/run`, { message, clientTurnId }, signal, { timeoutMs: 55_000 });
}
