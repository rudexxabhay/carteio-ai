import { FlowService } from '../src/modules/workspaces/flow.service';

describe('Phase 00 saved graph round trip', () => {
  it('loads the same validated graph, node configuration and stable edge handles that were saved', async () => {
    const assistantId = '11111111-1111-4111-8111-111111111111';
    let saved: any;
    const db = { $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const statement = sql.join('?');
      if (statement.includes('FROM "Chatbot"')) return values.includes('org-a') && values.includes(assistantId) ? [{ id: assistantId }] : [];
      if (statement.includes('INSERT INTO "FlowDefinition"')) {
        const [id, organizationId, storedAssistantId, name, graph] = values;
        saved = { id, organizationId, assistantId: storedAssistantId, name, graph: JSON.parse(String(graph)), version: 1 };
        return [saved];
      }
      if (statement.includes('FROM "FlowDefinition"')) return saved && values.includes(saved.id) && values.includes(saved.organizationId) ? [saved] : [];
      throw new Error('Unexpected storage operation');
    }) };
    const access = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a' }) };
    const service = new FlowService(db as any, access as any, {} as any, {} as any);
    const graph = { version: 1, nodes: [
      { id: 'start', kind: 'start', title: 'Chat Input', detail: '', x: 0, y: 0 },
      { id: 'message', kind: 'transform', title: 'Message', detail: '', x: 100, y: 0, promptTemplate: 'Customer: {{input}}' },
      { id: 'assistant', kind: 'assistant', title: 'Assistant', detail: '', x: 200, y: 0 },
      { id: 'response', kind: 'response', title: 'Response', detail: '', x: 300, y: 0 },
    ], edges: [['start', 'message'], ['message', 'assistant'], ['assistant', 'response']] };
    const created = await service.create('owner-a', 'north', { assistantId, name: '  Saved flow  ', graph });
    const loaded = await service.get('owner-a', 'north', created.id);
    expect(loaded).toMatchObject({ organizationId: 'org-a', assistantId, name: 'Saved flow', version: 1 });
    expect(loaded.graph.nodes).toEqual(graph.nodes);
    expect(loaded.graph.edges).toEqual(graph.edges);
    expect(loaded.graph.edgeMetadata).toHaveLength(3);
    expect(new Set(loaded.graph.edgeMetadata.map((edge: any) => edge.id)).size).toBe(3);
    expect(loaded.graph.edgeMetadata.every((edge: any) => edge.sourceHandle === 'output' && edge.targetHandle === 'input')).toBe(true);
    access.requireAccess.mockResolvedValueOnce({ organizationId: 'org-b' });
    await expect(service.get('owner-b', 'south', created.id)).rejects.toThrow('Flow not found');
  });

  it('executes saved transform and knowledge settings before the assigned assistant and preserves the response and edge trace', async () => {
    const assistantId = '11111111-1111-4111-8111-111111111111';
    const knowledgeAssistantId = '22222222-2222-4222-8222-222222222222';
    const graph = { version: 1, nodes: [
      { id: 'start', kind: 'start', title: 'Input', detail: '', x: 0, y: 0 },
      { id: 'format', kind: 'transform', title: 'Format', detail: '', x: 100, y: 0, promptTemplate: 'Customer: {{input}}' },
      { id: 'knowledge', kind: 'knowledge', title: 'Knowledge', detail: '', x: 200, y: 0, assistantId: knowledgeAssistantId, knowledgeLimit: 2 },
      { id: 'assistant', kind: 'assistant', title: 'Assistant', detail: '', x: 300, y: 0, assistantId },
      { id: 'response', kind: 'response', title: 'Output', detail: '', x: 400, y: 0 },
    ], edges: [['start', 'format'], ['format', 'knowledge'], ['knowledge', 'assistant'], ['assistant', 'response']] };
    const policy = { content: 'Synthetic policy evidence.', sourceTitle: 'Policy fixture', pageUrl: null, locator: 'FAQ fixture', score: 1 };
    const knowledge = { searchPreview: jest.fn().mockResolvedValue({ mode: 'lexical_only', eligibleSourceCount: 1, results: [policy] }) };
    const assistants = { playgroundChat: jest.fn().mockResolvedValue({ reply: 'Grounded fixture answer', sessionId: 'session-a', sources: [{ reference: 'S1', title: 'Policy fixture', type: 'FAQ', locator: 'FAQ fixture' }] }) };
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'flow-a', assistantId, version: 3, graph }]) };
    const access = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a' }) };
    const service = new FlowService(db as any, access as any, assistants as any, knowledge as any);
    const turnId = '33333333-3333-4333-8333-333333333333';

    const result = await service.run('owner-a', 'north', 'flow-a', { message: 'Question', clientTurnId: turnId }, 'request-a');

    expect(knowledge.searchPreview).toHaveBeenCalledWith('owner-a', 'north', knowledgeAssistantId, 'Customer: Question', 2, 'INTERNAL_MANAGER_PREVIEW');
    expect(assistants.playgroundChat).toHaveBeenCalledWith('owner-a', 'north', assistantId, { message: 'Customer: Question', clientTurnId: turnId }, 'request-a', undefined);
    expect(result).toMatchObject({ flowVersion: 3, reply: 'Grounded fixture answer', assistantReply: 'Grounded fixture answer', responseNodeId: 'response', knowledgeRuns: [{ nodeId: 'knowledge', query: 'Customer: Question', results: [policy] }] });
    expect(result.trace.traversedEdges.map(edge => [edge.sourceNodeId, edge.targetNodeId])).toEqual(graph.edges);
    expect(result.steps.map(step => step.nodeId)).toEqual(['start', 'format', 'knowledge', 'assistant', 'response']);
    expect(JSON.stringify(result.trace)).not.toContain(policy.content);
  });
});
