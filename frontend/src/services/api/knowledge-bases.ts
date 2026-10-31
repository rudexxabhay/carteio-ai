import { apiDelete, apiGet, apiPost, apiPut } from './client';

export type KnowledgeBaseStatus = 'active' | 'archived';
export interface KnowledgeBase {
  id: string; organizationId: string; createdById: string | null; name: string; description: string | null;
  status: KnowledgeBaseStatus; createdAt: string; updatedAt: string; archivedAt: string | null;
  autoAddEligibleSources?: boolean;
  sourceCount: number; faqCount: number; textCount: number; readyCount: number; failedCount?: number; linkedAssistantCount: number;
}
export interface KnowledgeBasePage { knowledgeBases: KnowledgeBase[]; total: number; page: number; pageSize: number; }
export interface AssistantKnowledgeBases { linked: KnowledgeBase[]; available: KnowledgeBase[]; totalAvailable: number; page: number; pageSize: number; }
export interface EffectiveKnowledge {
  organizationId: string;
  assistantId: string;
  resolution: 'INACTIVE_ASSISTANT' | 'SINGLE_ACTIVE_BASE_DEFAULT' | 'EXPLICIT_ASSIGNMENTS' | 'NO_ACTIVE_BASE' | 'ALL_ELIGIBLE_WORKSPACE_KNOWLEDGE';
  useAllEligibleWorkspaceKnowledge?: boolean;
  defaultKnowledgeBaseId: string | null;
  effectiveSourceCount?: number;
  blockedReasonCounts?: Record<string, number>;
  knowledgeBases: Array<{ id: string; name: string; status: string; assignment: 'WORKSPACE_DEFAULT' | 'EXPLICIT'; eligibleSourceCount: number; retrievalEnabled: boolean }>;
  sources: Array<{ id: string; type: string; sourceVersion: number; activeIndexGeneration?: number | null; activeChunkCount?: number; visibility: string; semanticIndexStatus?: string; sourceOrigin: string; accessPath?: string; accessPaths?: Array<'WORKSPACE_POLICY' | 'KNOWLEDGE_BASE' | 'DIRECT'> }>;
  searchableSourceCount?: number;
  retrievalEnabled: boolean;
}
const workspaceBase = (slug: string) => `/workspaces/${encodeURIComponent(slug)}`;
const assistantPath = (slug: string, assistantId: string) => `${workspaceBase(slug)}/assistants/${encodeURIComponent(assistantId)}`;
export const listKnowledgeBases = (slug: string, query: Record<string, string | number> = {}, signal?: AbortSignal) => {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<KnowledgeBasePage>(`${workspaceBase(slug)}/knowledge-bases${queryString ? `?${queryString}` : ''}`, signal);
};
export const createKnowledgeBase = (slug: string, input: { name: string; description?: string }) => apiPost<KnowledgeBase>(`${workspaceBase(slug)}/knowledge-bases`, input);
export function getAssistantKnowledgeBases(slug: string, assistantId: string, query: Record<string, string | number> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<AssistantKnowledgeBases>(`${assistantPath(slug, assistantId)}/knowledge-bases${queryString ? `?${queryString}` : ''}`, signal);
}
export const linkAssistantToKnowledgeBase = (slug: string, id: string, assistantId: string) => apiPost<{ assistantId: string; knowledgeBaseId: string; linked: boolean }>(`${workspaceBase(slug)}/knowledge-bases/${encodeURIComponent(id)}/assistants/${encodeURIComponent(assistantId)}`);
export const unlinkAssistantFromKnowledgeBase = (slug: string, id: string, assistantId: string) => apiDelete<{ assistantId: string; knowledgeBaseId: string; unlinked: boolean }>(`${workspaceBase(slug)}/knowledge-bases/${encodeURIComponent(id)}/assistants/${encodeURIComponent(assistantId)}`);
export const replaceAssistantKnowledgeBases = (slug: string, assistantId: string, knowledgeBaseIds: string[]) => apiPut<{ linked: KnowledgeBase[]; added: number; removed: number }>(`${assistantPath(slug, assistantId)}/knowledge-bases`, { knowledgeBaseIds });
export const getEffectiveKnowledge = (slug: string, assistantId: string, signal?: AbortSignal) => apiGet<EffectiveKnowledge>(`${assistantPath(slug, assistantId)}/effective-knowledge`, signal);

