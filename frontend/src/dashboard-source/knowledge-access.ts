import type { EffectiveKnowledge } from '../services/api/knowledge-bases';

export type SourceAssistantAccessStatus = 'available' | 'not-enabled' | 'not-indexed' | 'restricted' | 'failed' | 'blocked' | 'inactive-assistant';

export function sourceAssistantAccessStatus(input: {
  sourceId: string;
  visibility?: string;
  processingStatus?: string;
  activeIndexGeneration?: number | null;
  activeChunkCount?: number;
  effectiveKnowledge: EffectiveKnowledge;
}): SourceAssistantAccessStatus {
  if (input.effectiveKnowledge.resolution === 'INACTIVE_ASSISTANT') return 'inactive-assistant';
  if (input.effectiveKnowledge.sources.some((source) => source.id === input.sourceId)) return 'available';
  if (input.processingStatus === 'failed') return 'failed';
  if (input.visibility !== 'PUBLIC_REFERENCE') return 'restricted';
  if (input.processingStatus !== 'ready' || input.activeIndexGeneration == null || (input.activeChunkCount ?? 0) < 1) return 'not-indexed';
  if (input.effectiveKnowledge.useAllEligibleWorkspaceKnowledge) return 'blocked';
  return 'not-enabled';
}
