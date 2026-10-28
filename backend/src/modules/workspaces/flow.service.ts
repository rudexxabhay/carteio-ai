import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AssistantService } from './assistant.service';
import { WorkspaceService } from './workspace.service';
import { KnowledgeProcessingService } from './knowledge-processing.service';
import { PLAYGROUND_MESSAGE_MAX_BYTES, PLAYGROUND_MESSAGE_MAX_CHARS } from './playground.dto';
import type { CreateFlowDto, UpdateFlowDto } from './flow.dto';

const managers = ['OWNER', 'ADMIN'] as const;
const nodeKinds = new Set(['start', 'transform', 'assistant', 'condition', 'knowledge', 'response']);
const conditionOperators = new Set(['contains', 'equals', 'starts_with']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isUniqueConflict = (error: unknown) => typeof error === 'object' && error !== null && ('code' in error && error.code === 'P2002' || 'meta' in error && isRecord(error.meta) && error.meta.code === '23505');

type FlowNode = { id: string; kind: string; title: string; detail: string; x: number; y: number; promptTemplate?: string; assistantId?: string; conditionOperator?: string; conditionValue?: string; knowledgeLimit?: number };
type FlowGraph = { version: 1; nodes: FlowNode[]; edges: Array<[string, string]>; edgeMetadata: Array<{ id: string; sourceHandle: string; targetHandle: string }> };
type AssistantPlaygroundResult = Awaited<ReturnType<AssistantService['playgroundChat']>>;
type FlowSource = AssistantPlaygroundResult['sources'][number];
type FlowRunValue =
  | { type: 'text'; text: string }
  | { type: 'knowledge'; query: string; resultCount: number }
  | { type: 'branch'; matched: boolean; branch: 'true' | 'false' }
  | { type: 'response'; text: string };
type FlowRunContext = {
  input: string;
  current: FlowRunValue;
  outputs: Map<string, FlowRunValue>;
};
type FlowTraceStep = {
  index: number;
  nodeId: string;
  kind: string;
  status: 'SUCCEEDED';
  durationMs: number;
  inputType: FlowRunValue['type'];
  inputChars?: number;
  inputItems?: number;
  outputType: FlowRunValue['type'];
  outputChars?: number;
  outputItems?: number;
  branch?: 'true' | 'false';
};
type FlowExecutionFailureDiagnostic = Readonly<{
  traceId: string;
  runId: string;
  flowVersion: number;
  completedSteps: readonly Readonly<{ index: number; nodeId: string; kind: string; status: 'SUCCEEDED'; durationMs: number }>[];
  failedStep: Readonly<{ index: number; nodeId: string; kind: string; status: 'FAILED'; durationMs: number; reasonCode: string; retrievalStage?: 'KNOWLEDGE_RETRIEVAL'; lexicalStatus?: 'NOT_REPORTED'; semanticStatus?: 'NOT_REPORTED' }>;
  traversedEdges: readonly FlowTraceEdge[];
  relatedConversationTraceId?: string;
}>;
type FlowTraceEdge = Readonly<{ id: string; sourceNodeId: string; targetNodeId: string; sourceHandle: string; targetHandle: string }>;

export function flowValueCharCount(value: FlowRunValue): number | undefined {
  if ('text' in value) return value.text.length;
  return undefined;
}

export function flowValueItemCount(value: FlowRunValue): number | undefined {
  return value.type === 'knowledge' ? value.resultCount : undefined;
}

function stableNodeTurnId(runTurnId: string, nodeId: string) {
  const bytes = createHash('sha256').update(`${runTurnId}:${nodeId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function flowFailureDetails(error: unknown, knowledgeStage = false) {
  if (!(error instanceof HttpException)) {
    const record = isRecord(error) ? error : null;
    const prismaCode = typeof record?.code === 'string' ? record.code : undefined;
    const reasonCode = knowledgeStage && prismaCode === 'P2022' ? 'KNOWLEDGE_DATABASE_MISSING_COLUMN'
      : knowledgeStage && prismaCode === 'P2021' ? 'KNOWLEDGE_DATABASE_MISSING_TABLE' : 'FLOW_NODE_EXECUTION_FAILED';
    return { status: 500, reasonCode, relatedConversationTraceId: undefined as string | undefined, retryAfterSeconds: undefined as number | undefined };
  }
  const response = error.getResponse();
  const code = isRecord(response) && typeof response.code === 'string' && /^(?:FLOW|PLAYGROUND|KNOWLEDGE|SEMANTIC|EMBEDDING)_[A-Z0-9_]{1,72}$/u.test(response.code)
    ? response.code
    : 'FLOW_NODE_EXECUTION_FAILED';
  const diagnostics = isRecord(response) && isRecord(response.diagnostics) ? response.diagnostics : null;
  const relatedConversationTraceId = typeof diagnostics?.traceId === 'string' && /^[0-9a-f-]{36}$/iu.test(diagnostics.traceId) ? diagnostics.traceId : undefined;
  const retryAfterSeconds = isRecord(response) && typeof response.retryAfterSeconds === 'number' && Number.isInteger(response.retryAfterSeconds) ? Math.max(1, Math.min(3600, response.retryAfterSeconds)) : undefined;
  return { status: error.getStatus(), reasonCode: code, relatedConversationTraceId, retryAfterSeconds };
}

export function renderFlowTemplate(template: string, input: string): string {
  const token = '{{input}}';
  const occurrences = template.split(token).length - 1;
  const outputLength = template.length - occurrences * token.length + occurrences * input.length;
  const outputBytes = Buffer.byteLength(template, 'utf8') - occurrences * Buffer.byteLength(token, 'utf8') + occurrences * Buffer.byteLength(input, 'utf8');
  if (outputLength > PLAYGROUND_MESSAGE_MAX_CHARS || outputBytes > PLAYGROUND_MESSAGE_MAX_BYTES) {
    throw new BadRequestException({ code: 'FLOW_MESSAGE_LIMIT', message: 'Message templates cannot expand the input beyond the assistant message limits.' });
  }
  return template.split(token).join(input);
}

export function evaluateFlowCondition(operator: string, expected: string, actual: string): boolean {
  const left = actual.normalize('NFKC').trim().toLowerCase();
  const right = expected.normalize('NFKC').trim().toLowerCase();
  if (operator === 'equals') return left === right;
  if (operator === 'starts_with') return left.startsWith(right);
  if (operator === 'contains') return left.includes(right);
  throw new BadRequestException({ code: 'INVALID_FLOW_CONDITION', message: 'This flow condition operator is not supported.' });
}

export function validateGraph(value: unknown): FlowGraph {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new BadRequestException({ code: 'INVALID_FLOW_GRAPH', message: 'Flow graph must contain version 1, nodes, and edges.' });
  }
  if (value.nodes.length < 1 || value.nodes.length > 100 || value.edges.length > 250) {
    throw new BadRequestException({ code: 'FLOW_GRAPH_LIMIT', message: 'A flow must contain 1–100 nodes and no more than 250 connections.' });
  }
  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  for (const candidate of value.nodes) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(candidate.id) || ids.has(candidate.id) || typeof candidate.kind !== 'string' || !nodeKinds.has(candidate.kind) || typeof candidate.title !== 'string' || candidate.title.length < 1 || candidate.title.length > 120 || typeof candidate.detail !== 'string' || candidate.detail.length > 500 || typeof candidate.x !== 'number' || typeof candidate.y !== 'number' || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || candidate.x < 0 || candidate.y < 0 || candidate.x > 20000 || candidate.y > 20000 || candidate.kind === 'transform' && (typeof candidate.promptTemplate !== 'string' || candidate.promptTemplate.length < 1 || candidate.promptTemplate.length > 2000) || candidate.kind !== 'transform' && candidate.promptTemplate !== undefined || ['assistant', 'knowledge'].includes(candidate.kind) && candidate.assistantId !== undefined && (typeof candidate.assistantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.assistantId)) || !['assistant', 'knowledge'].includes(candidate.kind) && candidate.assistantId !== undefined || candidate.kind === 'condition' && (typeof candidate.conditionOperator !== 'string' || !conditionOperators.has(candidate.conditionOperator) || typeof candidate.conditionValue !== 'string' || !candidate.conditionValue.trim() || candidate.conditionValue.length > 2000) || candidate.kind !== 'condition' && (candidate.conditionOperator !== undefined || candidate.conditionValue !== undefined) || candidate.kind === 'knowledge' && candidate.knowledgeLimit !== undefined && (!Number.isInteger(candidate.knowledgeLimit) || (candidate.knowledgeLimit as number) < 1 || (candidate.knowledgeLimit as number) > 10) || candidate.kind !== 'knowledge' && candidate.knowledgeLimit !== undefined) {
      throw new BadRequestException({ code: 'INVALID_FLOW_NODE', message: 'Each flow node must have a unique id, supported type, bounded labels, and finite canvas coordinates.' });
    }
    ids.add(candidate.id);
    nodes.push({ id: candidate.id, kind: candidate.kind, title: candidate.title, detail: candidate.detail, x: candidate.x as number, y: candidate.y as number, ...(candidate.kind === 'transform' ? { promptTemplate: candidate.promptTemplate as string } : {}), ...(['assistant', 'knowledge'].includes(candidate.kind) && typeof candidate.assistantId === 'string' ? { assistantId: candidate.assistantId } : {}), ...(candidate.kind === 'condition' ? { conditionOperator: candidate.conditionOperator as string, conditionValue: candidate.conditionValue as string } : {}), ...(candidate.kind === 'knowledge' && candidate.knowledgeLimit !== undefined ? { knowledgeLimit: candidate.knowledgeLimit as number } : {}) });
  }
  if (nodes.filter((node) => node.kind === 'start').length !== 1) {
    throw new BadRequestException({ code: 'FLOW_START_NODE_COUNT', message: 'A flow must have exactly one Chat Input node.' });
  }
  const edges: Array<[string, string]> = [];
  const edgeMetadata: FlowGraph['edgeMetadata'] = [];
  const suppliedEdgeMetadata = value.edgeMetadata;
  if (suppliedEdgeMetadata !== undefined && (!Array.isArray(suppliedEdgeMetadata) || suppliedEdgeMetadata.length !== value.edges.length)) {
    throw new BadRequestException({ code: 'INVALID_FLOW_EDGE_METADATA', message: 'Connection handle metadata must match the connection list.' });
  }
  const providedMetadata = Array.isArray(suppliedEdgeMetadata) ? suppliedEdgeMetadata as unknown[] : undefined;
  const edgeKeys = new Set<string>();
  const metadataIds = new Set<string>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const outgoingCount = new Map<string, number>();
  for (const node of nodes) indegree.set(node.id, 0);
  for (const [edgeIndex, edge] of value.edges.entries()) {
    if (!Array.isArray(edge) || edge.length !== 2 || typeof edge[0] !== 'string' || typeof edge[1] !== 'string' || edge[0] === edge[1] || !ids.has(edge[0]) || !ids.has(edge[1])) {
      throw new BadRequestException({ code: 'INVALID_FLOW_EDGE', message: 'Each connection must link two different nodes in this flow.' });
    }
    const key = `${edge[0]}\u0000${edge[1]}`;
    if (edgeKeys.has(key)) throw new BadRequestException({ code: 'DUPLICATE_FLOW_EDGE', message: 'A node connection can only appear once.' });
    edgeKeys.add(key); edges.push([edge[0], edge[1]]);
    const sourceNode = nodes.find((node) => node.id === edge[0])!;
    const targetNode = nodes.find((node) => node.id === edge[1])!;
    const sourceOrdinal = outgoingCount.get(edge[0]) ?? 0;
    const defaultSourceHandle = sourceNode.kind === 'condition' ? (sourceOrdinal === 0 ? 'true' : 'false') : 'output';
    const candidate = providedMetadata?.[edgeIndex];
    const metadata = candidate === undefined
      ? { id: `edge-${createHash('sha256').update(`${edge[0]}\u0000${edge[1]}`).digest('hex').slice(0, 32)}`, sourceHandle: defaultSourceHandle, targetHandle: 'input' }
      : candidate;
    if (!isRecord(metadata) || typeof metadata.id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(metadata.id) || metadataIds.has(metadata.id)
      || metadata.sourceHandle !== defaultSourceHandle || metadata.targetHandle !== 'input'
      || sourceNode.kind === 'response' || targetNode.kind === 'start'
      || sourceNode.kind !== 'condition' && sourceOrdinal > 0 || sourceNode.kind === 'condition' && sourceOrdinal > 1
      || (indegree.get(edge[1]) ?? 0) > 0) {
      throw new BadRequestException({ code: 'INVALID_FLOW_HANDLE_CONNECTION', message: 'This node handle connection is unsupported or conflicts with another connection.' });
    }
    metadataIds.add(metadata.id);
    edgeMetadata.push({ id: metadata.id, sourceHandle: metadata.sourceHandle as string, targetHandle: metadata.targetHandle as string });
    outgoingCount.set(edge[0], sourceOrdinal + 1);
    outgoing.set(edge[0], [...(outgoing.get(edge[0]) || []), edge[1]]);
    indegree.set(edge[1], (indegree.get(edge[1]) || 0) + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!; visited += 1;
    for (const next of outgoing.get(id) || []) {
      const degree = (indegree.get(next) || 0) - 1; indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (visited !== nodes.length) throw new BadRequestException({ code: 'FLOW_CYCLE_UNSUPPORTED', message: 'Cycles are not supported in this flow version.' });
  const graph = { version: 1 as const, nodes, edges, edgeMetadata };
  if (JSON.stringify(graph).length > 200_000) throw new BadRequestException({ code: 'FLOW_GRAPH_TOO_LARGE', message: 'Flow graph must be smaller than 200 KB.' });
  return graph;
}

export function validateRunnableGraph(value: unknown) {
  const graph = validateGraph(value);
  const startNodes = graph.nodes.filter((node) => node.kind === 'start');
  const assistantNodes = graph.nodes.filter((node) => node.kind === 'assistant');
  const responseNodes = graph.nodes.filter((node) => node.kind === 'response');
  if (startNodes.length !== 1 || assistantNodes.length < 1 || responseNodes.length < 1 || graph.nodes.some((node) => !['start', 'transform', 'assistant', 'condition', 'knowledge', 'response'].includes(node.kind))) {
    throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'A runnable flow needs one Chat Input, at least one Carteio Assistant, and at least one AI Response.' });
  }
  const start = graph.nodes.find((node) => node.kind === 'start')!;
  const assistant = graph.nodes.find((node) => node.kind === 'assistant')!;
  const response = graph.nodes.find((node) => node.kind === 'response')!;
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of graph.nodes) incoming.set(node.id, 0);
  for (const [source, target] of graph.edges) {
    outgoing.set(source, [...(outgoing.get(source) || []), target]);
    incoming.set(target, (incoming.get(target) || 0) + 1);
  }
  if ((incoming.get(start.id) || 0) !== 0 || [...incoming.values()].some((count) => count > 1)) throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'Flows must start at Chat Input and may not merge separate branches.' });
  const visited = new Set<string>();
  const visit = (node: FlowNode, hasAssistant: boolean) => {
    if (visited.has(node.id)) throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'Each branch must use its own nodes and may not loop or merge.' });
    visited.add(node.id);
    const didRunAssistant = hasAssistant || node.kind === 'assistant';
    const next = outgoing.get(node.id) || [];
    if (node.kind === 'response') {
      if (next.length || !didRunAssistant) throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'Every branch must finish at a response node after running an assistant.' });
      return;
    }
    if (node.kind === 'condition' ? next.length !== 2 : next.length !== 1) throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: node.kind === 'condition' ? 'Connect the True and False outputs of every If / Else node.' : 'Every non-condition step needs exactly one outgoing connection.' });
    for (const target of next) {
      const child = graph.nodes.find((candidate) => candidate.id === target);
      if (!child || child.kind === 'start') throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'Only Chat Input can start the flow.' });
      visit(child, didRunAssistant);
    }
  };
  visit(start, false);
  if (visited.size !== graph.nodes.length) throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'Connect every node to a reachable Chat Input path.' });
  const path: FlowNode[] = [start];
  let current = start;
  while (current.kind !== 'response' && (outgoing.get(current.id) || []).length === 1) {
    current = graph.nodes.find((node) => node.id === outgoing.get(current.id)![0])!;
    path.push(current);
  }
  return { graph, start, assistant, response, responses: responseNodes, outgoing, path };
}

@Injectable()
export class FlowService {
  private readonly db: any;

  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService, private readonly assistants: AssistantService, private readonly knowledge: KnowledgeProcessingService) { this.db = prisma as any; }

  private async validateAssistantAssignments(organizationId: string, graph: FlowGraph) {
    const assistantIds = [...new Set(graph.nodes.flatMap((node) => ['assistant', 'knowledge'].includes(node.kind) && node.assistantId ? [node.assistantId] : []))];
    if (!assistantIds.length) return;
    const rows = await this.db.$queryRaw`SELECT "id" FROM "Chatbot" WHERE "organizationId" = ${organizationId}::uuid AND "id" = ANY(${assistantIds}::uuid[]) AND "archivedAt" IS NULL`;
    const available = new Set(rows.map((row: { id: string }) => row.id));
    if (assistantIds.some((id) => !available.has(id))) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Every Carteio Assistant node must reference a non-archived assistant in this workspace.' });
  }

  async list(userId: string, slug: string, assistantId?: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    if (assistantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assistantId)) throw new BadRequestException({ code: 'INVALID_ASSISTANT_ID', message: 'Assistant id is invalid.' });
    if (assistantId) return this.db.$queryRaw`SELECT "id", "organizationId", "assistantId", "name", "version", "graph", "createdAt", "updatedAt" FROM "FlowDefinition" WHERE "organizationId" = ${membership.organizationId}::uuid AND "assistantId" = ${assistantId}::uuid ORDER BY "updatedAt" DESC, "id" ASC`;
    return this.db.$queryRaw`SELECT "id", "organizationId", "assistantId", "name", "version", "graph", "createdAt", "updatedAt" FROM "FlowDefinition" WHERE "organizationId" = ${membership.organizationId}::uuid ORDER BY "updatedAt" DESC, "id" ASC`;
  }

  async get(userId: string, slug: string, flowId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const rows = await this.db.$queryRaw`SELECT "id", "organizationId", "assistantId", "name", "version", "graph", "createdAt", "updatedAt" FROM "FlowDefinition" WHERE "id" = ${flowId}::uuid AND "organizationId" = ${membership.organizationId}::uuid LIMIT 1`;
    const flow = rows[0];
    if (!flow) throw new NotFoundException({ code: 'FLOW_NOT_FOUND', message: 'Flow not found.' });
    return flow;
  }

  async create(userId: string, slug: string, input: CreateFlowDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const name = input.name.trim().replace(/\s+/g, ' ');
    const graph = validateGraph(input.graph);
    await this.validateAssistantAssignments(membership.organizationId, graph);
    const assistants = await this.db.$queryRaw`SELECT "id" FROM "Chatbot" WHERE "id" = ${input.assistantId}::uuid AND "organizationId" = ${membership.organizationId}::uuid AND "archivedAt" IS NULL LIMIT 1`;
    const assistant = assistants[0];
    if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Assistant not found in this workspace.' });
    try {
      const id = randomUUID();
      const rows = await this.db.$queryRaw`INSERT INTO "FlowDefinition" ("id", "organizationId", "assistantId", "name", "graph") VALUES (${id}::uuid, ${membership.organizationId}::uuid, ${assistant.id}::uuid, ${name}, ${JSON.stringify(graph)}::jsonb) RETURNING "id", "organizationId", "assistantId", "name", "version", "graph", "createdAt", "updatedAt"`;
      return rows[0];
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException({ code: 'FLOW_NAME_UNAVAILABLE', message: 'A flow with that name already exists for this assistant.' });
      throw error;
    }
  }

  async update(userId: string, slug: string, flowId: string, input: UpdateFlowDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const name = input.name === undefined ? null : input.name.trim().replace(/\s+/g, ' ');
    const validatedGraph = input.graph === undefined ? null : validateGraph(input.graph);
    if (validatedGraph) await this.validateAssistantAssignments(membership.organizationId, validatedGraph);
    const graph = validatedGraph === null ? null : JSON.stringify(validatedGraph);
    try {
      const rows = await this.db.$queryRaw`UPDATE "FlowDefinition" SET "name" = COALESCE(${name}, "name"), "graph" = COALESCE(${graph}::jsonb, "graph"), "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${flowId}::uuid AND "organizationId" = ${membership.organizationId}::uuid AND "version" = ${input.expectedVersion} RETURNING "id", "organizationId", "assistantId", "name", "version", "graph", "createdAt", "updatedAt"`;
      if (!rows[0]) {
        const existing = await this.db.$queryRaw`SELECT "id" FROM "FlowDefinition" WHERE "id" = ${flowId}::uuid AND "organizationId" = ${membership.organizationId}::uuid LIMIT 1`;
        if (!existing[0]) throw new NotFoundException({ code: 'FLOW_NOT_FOUND', message: 'Flow not found.' });
        throw new ConflictException({ code: 'FLOW_VERSION_CONFLICT', message: 'This flow changed in another session. Reload it before saving your edits.' });
      }
      return rows[0];
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException({ code: 'FLOW_NAME_UNAVAILABLE', message: 'A flow with that name already exists for this assistant.' });
      throw error;
    }
  }

  async delete(userId: string, slug: string, flowId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    await this.db.$transaction(async (tx: any) => {
      const deleted = await tx.$executeRaw`DELETE FROM "FlowDefinition" WHERE "id" = ${flowId}::uuid AND "organizationId" = ${membership.organizationId}::uuid`;
      if (deleted !== 1) throw new NotFoundException({ code: 'FLOW_NOT_FOUND', message: 'Flow not found.' });
      await tx.auditEvent.create({ data: { organizationId: membership.organizationId, actorUserId: userId, action: 'flow.deleted', entityType: 'flow_definition', entityId: flowId, metadata: null } });
    });
    return { deleted: true, id: flowId };
  }

  async run(userId: string, slug: string, flowId: string, input: { message: string; clientTurnId?: string }, requestId: string, signal?: AbortSignal) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const rows = await this.db.$queryRaw`SELECT "id", "assistantId", "version", "graph" FROM "FlowDefinition" WHERE "id" = ${flowId}::uuid AND "organizationId" = ${membership.organizationId}::uuid LIMIT 1`;
    const flow = rows[0];
    if (!flow) throw new NotFoundException({ code: 'FLOW_NOT_FOUND', message: 'Flow not found.' });
    const { graph, start, outgoing } = validateRunnableGraph(flow.graph);
    const turnId = input.clientTurnId || randomUUID();
    const runId = randomUUID();
    const context: FlowRunContext = { input: input.message, current: { type: 'text', text: input.message }, outputs: new Map() };
    const steps: FlowTraceStep[] = [];
    const traversedEdges: FlowTraceEdge[] = [];
    let assistantResult: AssistantPlaygroundResult | null = null;
    const assistantRuns: Array<{ nodeId: string; assistantId: string; reply: string; sessionId: string; messageId?: string; providerUsed?: string; modelUsed?: string; usedConversationContext?: boolean; evidenceRetrievalRequired?: boolean }> = [];
    const sources: FlowSource[] = [];
    const knowledgeRuns: Array<{ nodeId: string; query: string; mode: string; eligibleSourceCount: number; retrieval: { stage: 'KNOWLEDGE_RETRIEVAL'; lexicalStatus: 'COMPLETED' | 'SKIPPED'; semanticStatus: 'COMPLETED' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'SKIPPED'; reasonCode?: string; semanticUnavailableCode?: string }; results: Array<{ content: string; sourceTitle: string; pageUrl: string | null; locator: string | null; score: number }> }> = [];
    let current = start;
    const recordStep = (node: FlowNode, startedAt: number, before: FlowRunValue, after: FlowRunValue, branch?: 'true' | 'false') => {
      context.outputs.set(node.id, after);
      context.current = after;
      const inputChars = flowValueCharCount(before);
      const inputItems = flowValueItemCount(before);
      const outputChars = flowValueCharCount(after);
      const outputItems = flowValueItemCount(after);
      steps.push({ index: steps.length, nodeId: node.id, kind: node.kind, status: 'SUCCEEDED', durationMs: Math.max(0, Date.now() - startedAt), inputType: before.type, ...(inputChars !== undefined ? { inputChars } : {}), ...(inputItems !== undefined ? { inputItems } : {}), outputType: after.type, ...(outputChars !== undefined ? { outputChars } : {}), ...(outputItems !== undefined ? { outputItems } : {}), ...(branch ? { branch } : {}) });
    };
    let activeStep: { node: FlowNode; startedAt: number } | null = null;
    try {
    context.outputs.set(start.id, context.current);
    recordStep(start, Date.now(), context.current, context.current);
    while (current.kind !== 'response') {
      const nextIds = outgoing.get(current.id) || [];
      let branch: 'true' | 'false' | undefined;
      let targetId = nextIds[0];
      if (current.kind === 'condition') {
        const decisionStartedAt = Date.now();
        activeStep = { node: current, startedAt: decisionStartedAt };
        const before = context.current;
        const currentText = 'text' in before ? before.text : '';
        const matched = evaluateFlowCondition(current.conditionOperator!, current.conditionValue!, currentText);
        branch = matched ? 'true' : 'false';
        targetId = nextIds[matched ? 0 : 1];
        recordStep(current, decisionStartedAt, before, { type: 'branch', matched, branch }, branch);
        activeStep = null;
        // A condition records its routing decision but passes the tested value to the selected branch.
        context.current = before;
      }
      const node = graph.nodes.find((candidate) => candidate.id === targetId);
      if (!node) throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'The selected flow branch has no next node.' });
      const sourceNodeId = current.id;
      const edgeIndex = graph.edges.findIndex(([source, target]) => source === sourceNodeId && target === node.id);
      const edgeMetadata = edgeIndex >= 0 ? graph.edgeMetadata[edgeIndex] : undefined;
      if (!edgeMetadata) throw new BadRequestException({ code: 'FLOW_EDGE_METADATA_UNAVAILABLE', message: 'The selected flow connection is unavailable.' });
      traversedEdges.push({ id: edgeMetadata.id, sourceNodeId, targetNodeId: node.id, sourceHandle: edgeMetadata.sourceHandle, targetHandle: edgeMetadata.targetHandle });
      current = node;
      const stepStartedAt = Date.now();
      activeStep = { node, startedAt: stepStartedAt };
      const before = context.current;
      const message = 'text' in before ? before.text : context.input;
      let after: FlowRunValue = before;
      if (node.kind === 'transform') after = { type: 'text', text: renderFlowTemplate(node.promptTemplate!, message) };
      else if (node.kind === 'assistant') {
        const assistantId = node.assistantId || flow.assistantId;
        const nodeTurnId = assistantRuns.length === 0 ? turnId : stableNodeTurnId(turnId, node.id);
        assistantResult = await this.assistants.playgroundChat(userId, slug, assistantId, { message, clientTurnId: nodeTurnId }, requestId, signal);
        after = { type: 'text', text: assistantResult.reply };
        const providerUsed = 'providerUsed' in assistantResult ? assistantResult.providerUsed : undefined;
        const modelUsed = 'modelUsed' in assistantResult ? assistantResult.modelUsed : undefined;
        const diagnostics = 'diagnostics' in assistantResult && isRecord(assistantResult.diagnostics) ? assistantResult.diagnostics : null;
        const memory = diagnostics && isRecord(diagnostics.memory) ? diagnostics.memory : null;
        const promptAssembly = diagnostics && isRecord(diagnostics.promptAssembly) ? diagnostics.promptAssembly : null;
        const retrieval = diagnostics && isRecord(diagnostics.retrieval) ? diagnostics.retrieval : null;
        const usedConversationContext = typeof promptAssembly?.historySentToProvider === 'boolean'
          ? promptAssembly.historySentToProvider
          : typeof memory?.includedMessageCount === 'number' && memory.includedMessageCount > 0;
        const evidenceRetrievalRequired = typeof retrieval?.attempted === 'boolean' ? retrieval.attempted : undefined;
        assistantRuns.push({ nodeId: node.id, assistantId, reply: assistantResult.reply, sessionId: assistantResult.sessionId, ...(assistantResult.messageId ? { messageId: assistantResult.messageId } : {}), ...(providerUsed ? { providerUsed } : {}), ...(modelUsed ? { modelUsed } : {}), ...(typeof usedConversationContext === 'boolean' ? { usedConversationContext } : {}), ...(evidenceRetrievalRequired !== undefined ? { evidenceRetrievalRequired } : {}) });
        for (const source of assistantResult.sources) if (!sources.some((item) => item.reference === source.reference)) sources.push(source);
      } else if (node.kind === 'knowledge') {
        const assistantId = node.assistantId || flow.assistantId;
        const result = await this.knowledge.searchPreview(userId, slug, assistantId, message, node.knowledgeLimit || 5, 'INTERNAL_MANAGER_PREVIEW');
        const methods = result.diagnostics.methodsAttempted;
        const semanticStatus = result.semanticUnavailableCode === 'SEMANTIC_NOT_CONFIGURED' ? 'NOT_CONFIGURED'
          : result.semanticUnavailableCode ? 'UNAVAILABLE' : methods.includes('semantic') ? 'COMPLETED' : 'SKIPPED';
        knowledgeRuns.push({ nodeId: node.id, query: message, mode: result.mode, eligibleSourceCount: result.eligibleSourceCount, retrieval: { stage: 'KNOWLEDGE_RETRIEVAL', lexicalStatus: methods.includes('lexical') ? 'COMPLETED' : 'SKIPPED', semanticStatus, ...(result.diagnostics.retrievalReason || result.semanticUnavailableCode ? { reasonCode: result.diagnostics.retrievalReason ?? result.semanticUnavailableCode } : {}), ...(result.semanticUnavailableCode ? { semanticUnavailableCode: result.semanticUnavailableCode } : {}) }, results: result.results.map((item) => ({ content: item.content, sourceTitle: item.sourceTitle, pageUrl: item.pageUrl, locator: item.locator, score: item.score })) });
        after = { type: 'knowledge', query: message, resultCount: result.results.length };
      }
      // Conditions are traced when they route below; responses are traced once after traversal.
      if (node.kind !== 'condition' && node.kind !== 'response') recordStep(node, stepStartedAt, before, after);
      activeStep = null;
      // Retrieval is observable in run output and trace, while the v1 graph continues its input text.
      if (node.kind === 'knowledge') context.current = before;
    }
    if (!assistantResult) throw new BadRequestException({ code: 'FLOW_TOPOLOGY_UNSUPPORTED', message: 'The flow path does not contain a Carteio Assistant.' });
    const providerUsed = 'providerUsed' in assistantResult ? assistantResult.providerUsed : undefined;
    const modelUsed = 'modelUsed' in assistantResult ? assistantResult.modelUsed : undefined;
    const responseInput = context.current;
    const responseText = 'text' in responseInput ? responseInput.text : assistantResult.reply;
    recordStep(current, Date.now(), responseInput, { type: 'response', text: responseText });
    const executedNodeIds = new Set(steps.map((step) => step.nodeId));
    const skippedNodeIds = graph.nodes.filter((node) => !executedNodeIds.has(node.id)).map((node) => node.id);
    return {
      runId, flowId, flowVersion: flow.version, assistantId: flow.assistantId, responseNodeId: current.id,
      sessionId: assistantResult.sessionId, messageId: assistantResult.messageId, reply: responseText, assistantReply: assistantResult.reply, sources,
      ...(providerUsed ? { providerUsed } : {}), ...(modelUsed ? { modelUsed } : {}), usage: 'usage' in assistantResult ? assistantResult.usage : undefined, assistantRuns, knowledgeRuns,
      steps, skippedNodeIds,
      trace: { requestId, traceId: requestId, runId, flowVersion: flow.version, inputChars: context.input.length, outputs: steps.map(({ index, nodeId, kind, status, durationMs, inputType, inputChars, inputItems, outputType, outputChars, outputItems, branch }) => ({ index, nodeId, kind, status, durationMs, inputType, ...(inputChars !== undefined ? { inputChars } : {}), ...(inputItems !== undefined ? { inputItems } : {}), outputType, ...(outputChars !== undefined ? { outputChars } : {}), ...(outputItems !== undefined ? { outputItems } : {}), ...(branch ? { branch } : {}) })), traversedEdges: traversedEdges.slice(0, 100) },
    };
    } catch (error) {
      const failedNode = activeStep?.node ?? current;
      const failure = flowFailureDetails(error, failedNode.kind === 'knowledge');
      const flowDiagnostics: FlowExecutionFailureDiagnostic = {
        traceId: requestId,
        runId,
        flowVersion: flow.version,
        completedSteps: steps.map(({ index, nodeId, kind, status, durationMs }) => ({ index, nodeId, kind, status, durationMs })),
        failedStep: { index: steps.length, nodeId: failedNode.id, kind: failedNode.kind, status: 'FAILED', durationMs: Math.max(0, Date.now() - (activeStep?.startedAt ?? Date.now())), reasonCode: failure.reasonCode, ...(failedNode.kind === 'knowledge' ? { retrievalStage: 'KNOWLEDGE_RETRIEVAL' as const, lexicalStatus: 'NOT_REPORTED' as const, semanticStatus: 'NOT_REPORTED' as const } : {}) },
        traversedEdges: traversedEdges.slice(0, 100),
        ...(failure.relatedConversationTraceId ? { relatedConversationTraceId: failure.relatedConversationTraceId } : {}),
      };
      throw new HttpException({ code: failure.reasonCode, message: 'Flow execution failed.', ...(failure.retryAfterSeconds !== undefined ? { retryAfterSeconds: failure.retryAfterSeconds } : {}), flowDiagnostics }, failure.status);
    }
  }

}
