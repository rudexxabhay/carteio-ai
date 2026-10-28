import { describe, expect, it } from 'vitest';
import { sourceAssistantAccessStatus } from '../dashboard-source/knowledge-access';
import type { EffectiveKnowledge } from '../services/api/knowledge-bases';

const effective = (overrides: Partial<EffectiveKnowledge> = {}): EffectiveKnowledge => ({
  organizationId: 'org-a', assistantId: 'assistant-a', resolution: 'NO_ACTIVE_BASE', defaultKnowledgeBaseId: null,
  knowledgeBases: [], sources: [], retrievalEnabled: false, useAllEligibleWorkspaceKnowledge: false, ...overrides,
});

describe('source effective assistant access status', () => {
  it('reports real effective access and avoids suggesting a direct attachment', () => {
    expect(sourceAssistantAccessStatus({ sourceId: 'source-a', visibility: 'PUBLIC_REFERENCE', processingStatus: 'ready', activeIndexGeneration: 1, activeChunkCount: 2, effectiveKnowledge: effective({ sources: [{ id: 'source-a', type: 'faq', sourceVersion: 1, activeIndexGeneration: 1, activeChunkCount: 2, visibility: 'PUBLIC_REFERENCE', sourceOrigin: 'WORKSPACE_AUTHORED' }] }) })).toBe('available');
  });
  it('reports restricted, failed, unindexed, automatic-policy blocker, and manual-assignment states distinctly', () => {
    const source = { sourceId: 'source-a', activeIndexGeneration: 1, activeChunkCount: 1, effectiveKnowledge: effective() };
    expect(sourceAssistantAccessStatus({ ...source, visibility: 'INTERNAL_RESTRICTED', processingStatus: 'ready' })).toBe('restricted');
    expect(sourceAssistantAccessStatus({ ...source, visibility: 'PUBLIC_REFERENCE', processingStatus: 'failed' })).toBe('failed');
    expect(sourceAssistantAccessStatus({ ...source, visibility: 'PUBLIC_REFERENCE', processingStatus: 'ready', activeIndexGeneration: null })).toBe('not-indexed');
    expect(sourceAssistantAccessStatus({ ...source, visibility: 'PUBLIC_REFERENCE', processingStatus: 'ready', effectiveKnowledge: effective({ useAllEligibleWorkspaceKnowledge: true }) })).toBe('blocked');
    expect(sourceAssistantAccessStatus({ ...source, visibility: 'PUBLIC_REFERENCE', processingStatus: 'ready' })).toBe('not-enabled');
  });
});
