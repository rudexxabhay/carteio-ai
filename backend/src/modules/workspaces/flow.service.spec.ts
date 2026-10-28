import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { evaluateFlowCondition, flowValueCharCount, flowValueItemCount, FlowService, renderFlowTemplate, validateGraph, validateRunnableGraph } from './flow.service';

const validGraph = (): { version: number; nodes: Array<{ id: string; kind: string; title: string; detail: string; x: number; y: number; promptTemplate?: string; conditionOperator?: string; conditionValue?: string }>; edges: Array<[string, string]> } => ({
  version: 1,
  nodes: [
    { id: 'start', kind: 'start', title: 'Chat Input', detail: 'Input', x: 0, y: 0 },
    { id: 'assistant', kind: 'assistant', title: 'Carteio Assistant', detail: 'Provider and retrieval', x: 300, y: 0 },
    { id: 'response', kind: 'response', title: 'AI Response', detail: 'Output', x: 600, y: 0 },
  ],
  edges: [['start', 'assistant'], ['assistant', 'response']],
});

describe('validateGraph', () => {
  it('accepts a bounded graph with valid references and acyclic connections', () => {
    expect(validateGraph(validGraph())).toMatchObject({ version: 1, nodes: [{ id: 'start' }, { id: 'assistant' }, { id: 'response' }], edges: [['start', 'assistant'], ['assistant', 'response']] });
    expect(validateGraph(validGraph()).edgeMetadata).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^edge-/), sourceHandle: 'output', targetHandle: 'input' }),
      expect.objectContaining({ id: expect.stringMatching(/^edge-/), sourceHandle: 'output', targetHandle: 'input' }),
    ]);
  });

  it('preserves supported handles and rejects conflicting or invalid handle metadata', () => {
    const graph = validGraph();
    graph.nodes.splice(1, 0, { id: 'condition', kind: 'condition', title: 'Condition', detail: 'Branch', x: 100, y: 0, conditionOperator: 'contains', conditionValue: 'yes' });
    graph.edges = [['start', 'condition'], ['condition', 'assistant'], ['condition', 'response']];
    (graph as any).edgeMetadata = [
      { id: 'start-condition', sourceHandle: 'output', targetHandle: 'input' },
      { id: 'condition-true', sourceHandle: 'true', targetHandle: 'input' },
      { id: 'condition-false', sourceHandle: 'false', targetHandle: 'input' },
    ];
    expect(validateGraph(graph).edgeMetadata).toEqual((graph as any).edgeMetadata);
    (graph as any).edgeMetadata[1].sourceHandle = 'false';
    expect(() => validateGraph(graph)).toThrow(BadRequestException);
  });

  it('rejects nodes outside the supported catalog and duplicate node ids', () => {
    const unsupported = validGraph();
    unsupported.nodes[1]!.kind = 'arbitrary-code';
    expect(() => validateGraph(unsupported)).toThrow(BadRequestException);

    const duplicate = validGraph();
    duplicate.nodes[1]!.id = 'start';
    expect(() => validateGraph(duplicate)).toThrow(BadRequestException);
  });

  it('rejects dangling references, duplicate edges, and cycles', () => {
    const dangling = validGraph();
    dangling.edges[0] = ['start', 'missing'];
    expect(() => validateGraph(dangling)).toThrow(BadRequestException);

    const duplicate = validGraph();
    duplicate.edges.push(['start', 'assistant']);
    expect(() => validateGraph(duplicate)).toThrow(BadRequestException);

    const cycle = validGraph();
    cycle.edges.push(['response', 'start']);
    expect(() => validateGraph(cycle)).toThrow(BadRequestException);
  });

  it('requires exactly one input node and enforces node and edge limits', () => {
    const missingStart = validGraph();
    missingStart.nodes[0]!.kind = 'assistant';
    expect(() => validateGraph(missingStart)).toThrow(BadRequestException);

    const tooMany = validGraph();
    tooMany.nodes = Array.from({ length: 101 }, (_, index) => ({ id: `n${index}`, kind: index === 0 ? 'start' : 'response', title: 'node', detail: '', x: 0, y: 0 }));
    expect(() => validateGraph(tooMany)).toThrow(BadRequestException);
  });

  it('allows the executable input-to-assistant-to-response path and rejects a disconnected topology', () => {
    expect(validateRunnableGraph(validGraph()).assistant.id).toBe('assistant');
    const disconnected = validGraph();
    disconnected.edges = [['start', 'response'], ['response', 'assistant']];
    expect(() => validateRunnableGraph(disconnected)).toThrow(BadRequestException);
  });

  it('executes optional message templates on either side of the assistant and validates their configuration', () => {
    const withTemplate = validGraph();
    withTemplate.nodes.splice(1, 0, { id: 'format', kind: 'transform', title: 'Format message', detail: 'Add context', x: 180, y: 0, promptTemplate: 'Customer says: {{input}}' });
    withTemplate.edges = [['start', 'format'], ['format', 'assistant'], ['assistant', 'response']];
    expect(validateRunnableGraph(withTemplate).path.map((node) => node.kind)).toEqual(['start', 'transform', 'assistant', 'response']);

    const outputTemplate = validGraph();
    outputTemplate.nodes.splice(2, 0, { id: 'format-output', kind: 'transform', title: 'Format response', detail: 'Wrap response', x: 480, y: 0, promptTemplate: 'Answer: {{input}}' });
    outputTemplate.edges = [['start', 'assistant'], ['assistant', 'format-output'], ['format-output', 'response']];
    expect(validateRunnableGraph(outputTemplate).path.map((node) => node.kind)).toEqual(['start', 'assistant', 'transform', 'response']);

    outputTemplate.nodes[2]!.promptTemplate = '';
    expect(() => validateGraph(outputTemplate)).toThrow(BadRequestException);
  });

  it('accepts ordered True and False paths when every branch reaches its own assistant and response', () => {
    const branching = validGraph();
    branching.nodes = [
      { id: 'start', kind: 'start', title: 'Chat Input', detail: 'Input', x: 0, y: 0 },
      { id: 'check', kind: 'condition', title: 'If / Else', detail: 'Route on match', x: 280, y: 0, conditionOperator: 'contains', conditionValue: 'refund' },
      { id: 'billing-agent', kind: 'assistant', title: 'Billing Assistant', detail: 'Billing support', x: 560, y: 0 },
      { id: 'general-agent', kind: 'assistant', title: 'General Assistant', detail: 'General support', x: 560, y: 280 },
      { id: 'billing-response', kind: 'response', title: 'Billing Response', detail: 'Output', x: 840, y: 0 },
      { id: 'general-response', kind: 'response', title: 'General Response', detail: 'Output', x: 840, y: 280 },
    ];
    branching.edges = [['start', 'check'], ['check', 'billing-agent'], ['check', 'general-agent'], ['billing-agent', 'billing-response'], ['general-agent', 'general-response']];

    const result = validateRunnableGraph(branching);
    expect(result.outgoing.get('check')).toEqual(['billing-agent', 'general-agent']);

    branching.edges.splice(2, 1);
    expect(() => validateRunnableGraph(branching)).toThrow(BadRequestException);
  });
});

describe('evaluateFlowCondition', () => {
  it('matches normalized text with a bounded, explicit operator set', () => {
    expect(evaluateFlowCondition('contains', 'refund', '  I need a REFUND please  ')).toBe(true);
    expect(evaluateFlowCondition('equals', 'Café', 'Cafe\u0301')).toBe(true);
    expect(evaluateFlowCondition('starts_with', 'Order:', 'order: 481')).toBe(true);
    expect(() => evaluateFlowCondition('matches', '.*', 'anything')).toThrow(BadRequestException);
  });
});

describe('renderFlowTemplate', () => {
  it('substitutes every current-message token', () => {
    expect(renderFlowTemplate('Before {{input}} after {{input}}', 'question')).toBe('Before question after question');
  });

  it('rejects expansions that exceed the assistant message bounds before rendering', () => {
    expect(() => renderFlowTemplate('{{input}}'.repeat(2), 'x'.repeat(1_001))).toThrow(BadRequestException);
    expect(renderFlowTemplate('Question: {{input}}', 'Where?')).toBe('Question: Where?');
  });
});

describe('flowValueCharCount', () => {
  it('returns safe size metadata for run trace values without exposing their content', () => {
    expect(flowValueCharCount({ type: 'text', text: 'private customer message' })).toBe(24);
    expect(flowValueCharCount({ type: 'knowledge', query: 'private query', resultCount: 3 })).toBeUndefined();
    expect(flowValueCharCount({ type: 'branch', matched: true, branch: 'true' })).toBeUndefined();
    expect(flowValueCharCount({ type: 'response', text: 'answer' })).toBe(6);
  });

  it('counts retrieved results as items rather than characters', () => {
    expect(flowValueItemCount({ type: 'knowledge', query: 'private query', resultCount: 3 })).toBe(3);
    expect(flowValueItemCount({ type: 'text', text: 'answer' })).toBeUndefined();
  });
});

describe('FlowService.run', () => {
  it('exposes a safe retrieval stage and schema failure reason for a failed Knowledge node', async () => {
    const assistantId = '11111111-1111-4111-8111-111111111111';
    const graph = validGraph();
    graph.nodes.splice(1, 0, { id: 'knowledge', kind: 'knowledge', title: 'Knowledge Search', detail: 'Search assigned knowledge', x: 150, y: 0 });
    graph.edges = [['start', 'knowledge'], ['knowledge', 'assistant'], ['assistant', 'response']];
    const workspace = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org' }) };
    const assistants = { playgroundChat: jest.fn() };
    const knowledge = { searchPreview: jest.fn().mockRejectedValue(Object.assign(new Error('private database detail'), { code: 'P2022' })) };
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'flow', assistantId, version: 4, graph }]) };
    const service = new FlowService(prisma as any, workspace as any, assistants as any, knowledge as any);
    let failure: any;
    try { await service.run('user', 'workspace', 'flow', { message: 'private customer question' }, 'trace-knowledge-failure'); }
    catch (error) { failure = error; }

    expect(failure.getStatus()).toBe(500);
    const response = failure.getResponse() as Record<string, any>;
    expect(response).toMatchObject({ code: 'KNOWLEDGE_DATABASE_MISSING_COLUMN', flowDiagnostics: { traceId: 'trace-knowledge-failure', failedStep: {
      nodeId: 'knowledge', kind: 'knowledge', status: 'FAILED', reasonCode: 'KNOWLEDGE_DATABASE_MISSING_COLUMN', retrievalStage: 'KNOWLEDGE_RETRIEVAL', lexicalStatus: 'NOT_REPORTED', semanticStatus: 'NOT_REPORTED',
    } } });
    expect(JSON.stringify(response.flowDiagnostics)).not.toContain('private');
    expect(assistants.playgroundChat).not.toHaveBeenCalled();
  });

  it('returns the actual zero-match reason from a successful Builder Knowledge search', async () => {
    const assistantId = '11111111-1111-4111-8111-111111111111';
    const graph = validGraph();
    graph.nodes.splice(1, 0, { id: 'knowledge', kind: 'knowledge', title: 'Knowledge Search', detail: 'Search assigned knowledge', x: 150, y: 0 });
    graph.edges = [['start', 'knowledge'], ['knowledge', 'assistant'], ['assistant', 'response']];
    const workspace = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org' }) };
    const assistants = { playgroundChat: jest.fn().mockResolvedValue({ reply: 'I could not confirm that from available information.', sessionId: 'session', messageId: 'message', sources: [] }) };
    const knowledge = { searchPreview: jest.fn().mockResolvedValue({ mode: 'lexical_only', eligibleSourceCount: 1, results: [], semanticUnavailableCode: 'SEMANTIC_NOT_CONFIGURED', diagnostics: { methodsAttempted: ['lexical'], retrievalReason: 'NO_LEXICAL_MATCH' } }) };
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'flow', assistantId, version: 5, graph }]) };
    const service = new FlowService(prisma as any, workspace as any, assistants as any, knowledge as any);

    const result = await service.run('user', 'workspace', 'flow', { message: 'Customer question' }, 'trace-knowledge-no-match');

    expect(result.knowledgeRuns[0]).toMatchObject({ eligibleSourceCount: 1, results: [], retrieval: { stage: 'KNOWLEDGE_RETRIEVAL', lexicalStatus: 'COMPLETED', semanticStatus: 'NOT_CONFIGURED', reasonCode: 'NO_LEXICAL_MATCH', semanticUnavailableCode: 'SEMANTIC_NOT_CONFIGURED' } });
  });

  it('returns a bounded trace id and failed node reason when an assistant stage throws', async () => {
    const assistantId = '11111111-1111-4111-8111-111111111111';
    const workspace = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org' }) };
    const assistants = { playgroundChat: jest.fn().mockRejectedValue(new BadGatewayException({ code: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE', message: 'Unavailable', diagnostics: { traceId: '12345678-1234-4234-8234-123456789abc' } })) };
    const knowledge = { searchPreview: jest.fn() };
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'flow', assistantId, version: 3, graph: validGraph() }]) };
    const service = new FlowService(prisma as any, workspace as any, assistants as any, knowledge as any);
    let failure: any;
    try { await service.run('user', 'workspace', 'flow', { message: 'private customer question' }, 'trace-flow-failure'); }
    catch (error) { failure = error; }

    expect(failure.getStatus()).toBe(502);
    const response = failure.getResponse() as Record<string, any>;
    expect(response).toMatchObject({ code: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE', flowDiagnostics: {
      traceId: 'trace-flow-failure', flowVersion: 3,
      completedSteps: [{ index: 0, nodeId: 'start', kind: 'start', status: 'SUCCEEDED' }],
      failedStep: { index: 1, nodeId: 'assistant', kind: 'assistant', status: 'FAILED', reasonCode: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE' },
      relatedConversationTraceId: '12345678-1234-4234-8234-123456789abc',
    } });
    expect(JSON.stringify(response.flowDiagnostics)).not.toContain('private customer question');
  });

  it('preserves provider and model metadata when the assistant response supplies them', async () => {
    const assistantId = '11111111-1111-4111-8111-111111111111';
    const graph = validGraph();
    const workspace = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org' }) };
    const assistants = { playgroundChat: jest.fn().mockResolvedValue({ reply: 'Grounded answer', sessionId: 'session', messageId: 'message', sources: [], usage: null, providerUsed: 'groq', modelUsed: 'llama-3.3-70b', diagnostics: { memory: { includedMessageCount: 2 }, promptAssembly: { historySentToProvider: true }, retrieval: { attempted: false } } }) };
    const knowledge = { searchPreview: jest.fn() };
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'flow', assistantId, version: 3, graph }]) };
    const service = new FlowService(prisma as any, workspace as any, assistants as any, knowledge as any);

    const result = await service.run('user', 'workspace', 'flow', { message: 'Question' }, 'request-2');

    expect(result.providerUsed).toBe('groq');
    expect(result.modelUsed).toBe('llama-3.3-70b');
    expect(result.assistantRuns[0]).toMatchObject({ providerUsed: 'groq', modelUsed: 'llama-3.3-70b', usedConversationContext: true, evidenceRetrievalRequired: false });
  });

  it('executes only the selected branch and reports an ordered content-safe trace', async () => {
    const assistantId = '11111111-1111-4111-8111-111111111111';
    const graph = {
      version: 1,
      nodes: [
        { id: 'start', kind: 'start', title: 'Chat Input', detail: '', x: 0, y: 0 },
        { id: 'check', kind: 'condition', title: 'If / Else', detail: '', x: 1, y: 0, conditionOperator: 'contains', conditionValue: 'refund' },
        { id: 'yes', kind: 'assistant', title: 'Billing', detail: '', x: 2, y: 0, assistantId },
        { id: 'no', kind: 'assistant', title: 'General', detail: '', x: 2, y: 1, assistantId: '22222222-2222-4222-8222-222222222222' },
        { id: 'yes-response', kind: 'response', title: 'Billing output', detail: '', x: 3, y: 0 },
        { id: 'no-response', kind: 'response', title: 'General output', detail: '', x: 3, y: 1 },
      ],
      edges: [['start', 'check'], ['check', 'yes'], ['check', 'no'], ['yes', 'yes-response'], ['no', 'no-response']],
    };
    const workspace = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org' }) };
    const assistants = { playgroundChat: jest.fn().mockResolvedValue({ reply: 'Billing answer', sessionId: 'session', messageId: 'message', sources: [], usage: null }) };
    const knowledge = { searchPreview: jest.fn() };
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'flow', assistantId, version: 7, graph }]) };
    const service = new FlowService(prisma as any, workspace as any, assistants as any, knowledge as any);

    const result = await service.run('user', 'workspace', 'flow', { message: 'I need a refund' }, 'request-1');

    expect(workspace.requireAccess).toHaveBeenCalledWith('user', 'workspace', ['OWNER', 'ADMIN']);
    expect(assistants.playgroundChat).toHaveBeenCalledTimes(1);
    expect(assistants.playgroundChat).toHaveBeenCalledWith('user', 'workspace', assistantId, expect.objectContaining({ message: 'I need a refund' }), 'request-1', undefined);
    expect(result.reply).toBe('Billing answer');
    expect(result.providerUsed).toBeUndefined();
    expect(result.modelUsed).toBeUndefined();
    expect(result.skippedNodeIds).toEqual(['no', 'no-response']);
    expect(result.trace).toMatchObject({ requestId: 'request-1', flowVersion: 7, outputs: [
      { index: 0, nodeId: 'start', outputType: 'text' },
      { index: 1, nodeId: 'check', outputType: 'branch', branch: 'true' },
      { index: 2, nodeId: 'yes', inputType: 'text', inputChars: 15, outputType: 'text' },
      { index: 3, nodeId: 'yes-response', outputType: 'response', outputChars: 14 },
    ], traversedEdges: [
      { sourceNodeId: 'start', targetNodeId: 'check', sourceHandle: 'output', targetHandle: 'input' },
      { sourceNodeId: 'check', targetNodeId: 'yes', sourceHandle: 'true', targetHandle: 'input' },
      { sourceNodeId: 'yes', targetNodeId: 'yes-response', sourceHandle: 'output', targetHandle: 'input' },
    ] });
    expect(result.trace.traversedEdges).toHaveLength(3);
    expect(result.trace.traversedEdges.every((edge: any) => /^edge-/.test(edge.id))).toBe(true);
    expect(JSON.stringify(result.trace)).not.toContain('I need a refund');
  });
});
