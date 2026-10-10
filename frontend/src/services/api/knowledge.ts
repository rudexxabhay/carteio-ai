import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export type KnowledgeType = 'website' | 'faq' | 'text';
export type ProcessingStatus = 'not_processed' | 'queued' | 'processing' | 'ready' | 'failed';
export interface KnowledgeSource {
  id: string; organizationId: string; createdById: string | null; type: KnowledgeType;
  status: 'registered' | 'disabled' | 'archived'; processingStatus: ProcessingStatus;
  name: string; description: string | null; sourceUrl: string | null; contentBody: string | null;
  category: string | null; languageHint: string | null; sourceVersion: number;
  lastSyncAt: string | null; lastSuccessfulSyncAt: string | null; lastSyncErrorCode: string | null;
  deletedAt: string | null; createdAt: string; updatedAt: string; linkedAssistantCount?: number;
}
export interface SourcePage { sources: KnowledgeSource[]; total: number; }
export interface AssistantKnowledge { linked: KnowledgeSource[]; available: KnowledgeSource[]; }
const base = (slug: string) => `/workspaces/${encodeURIComponent(slug)}/knowledge`;
const assistantBase = (slug: string, assistantId: string) => `/workspaces/${encodeURIComponent(slug)}/assistants/${encodeURIComponent(assistantId)}/knowledge`;
export const listKnowledge = (slug: string, signal?: AbortSignal) => apiGet<SourcePage>(base(slug), signal);
export const createWebsiteSource = (slug: string, input: { sourceUrl: string; name?: string; description?: string }) => apiPost<KnowledgeSource>(`${base(slug)}/website`, input);
export const createFaqSource = (slug: string, input: { question: string; answer: string; category?: string; languageHint?: string }) => apiPost<KnowledgeSource>(`${base(slug)}/faq`, input);
export const createTextSource = (slug: string, input: { title: string; content: string; description?: string; category?: string; languageHint?: string }) => apiPost<KnowledgeSource>(`${base(slug)}/text`, input);
export const updateKnowledge = (slug: string, id: string, input: Record<string, string>) => apiPatch<KnowledgeSource>(`${base(slug)}/${encodeURIComponent(id)}`, input);
export const archiveKnowledge = (slug: string, id: string) => apiDelete<KnowledgeSource>(`${base(slug)}/${encodeURIComponent(id)}`);
export const getAssistantKnowledge = (slug: string, assistantId: string, signal?: AbortSignal) => apiGet<AssistantKnowledge>(assistantBase(slug, assistantId), signal);
export const attachKnowledge = (slug: string, assistantId: string, sourceId: string) => apiPost<{ linked: boolean }>(`${assistantBase(slug, assistantId)}/${encodeURIComponent(sourceId)}`);
export const detachKnowledge = (slug: string, assistantId: string, sourceId: string) => apiDelete<{ unlinked: boolean }>(`${assistantBase(slug, assistantId)}/${encodeURIComponent(sourceId)}`);
