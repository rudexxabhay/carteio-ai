import { apiDelete, apiDeleteWithBody, apiGet, apiPatch, apiPost, apiPut } from './client';
import type { KnowledgeSource } from './knowledge';
import { apiConfig } from '../../config';

export type KnowledgeBaseStatus = 'active' | 'archived';
export interface KnowledgeBase {
  id: string; organizationId: string; createdById: string | null; name: string; description: string | null;
  status: KnowledgeBaseStatus; createdAt: string; updatedAt: string; archivedAt: string | null;
  autoAddEligibleSources?: boolean;
  sourceCount: number; faqCount: number; textCount: number; readyCount: number; failedCount?: number; linkedAssistantCount: number;
}
export interface KnowledgeBasePage {
  knowledgeBases: KnowledgeBase[]; total: number; page: number; pageSize: number;
  summary: { totalKnowledgeBases: number; totalSources: number; unassignedSources: number; linkedAssistants: number };
}
export interface KnowledgeBaseSourcePage { sources: KnowledgeSource[]; total: number; page: number; pageSize: number; summary?: { sourceCount: number; byType: Record<string, number>; byProcessingStatus: Record<string, number>; byKnowledgeSection?: Record<string, number>; bySectionProcessingStatus?: Record<string, number> }; }
export interface AssistantKnowledgeBases { linked: KnowledgeBase[]; available: KnowledgeBase[]; totalAvailable: number; page: number; pageSize: number; }
export interface KnowledgeBaseAssistants {
  linked: Array<{ id: string; name: string; status: string }>;
  available: Array<{ id: string; name: string; status: string }>;
  knowledgeResolution?: { mode: 'WORKSPACE_DEFAULT' | 'EXPLICIT_ASSIGNMENT_REQUIRED'; isDefault: boolean; activeKnowledgeBaseCount: number };
}
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
const collectionPath = (slug: string, baseId: string) => `${workspaceBase(slug)}/knowledge-bases/${encodeURIComponent(baseId)}`;
const assistantPath = (slug: string, assistantId: string) => `${workspaceBase(slug)}/assistants/${encodeURIComponent(assistantId)}`;

export function listKnowledgeBases(slug: string, query: Record<string, string | number> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<KnowledgeBasePage>(`${workspaceBase(slug)}/knowledge-bases${queryString ? `?${queryString}` : ''}`, signal);
}
export function listUnassignedKnowledgeSources(slug: string, query: Record<string, string | number> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<KnowledgeBaseSourcePage>(`${workspaceBase(slug)}/knowledge-bases/unassigned-sources${queryString ? `?${queryString}` : ''}`, signal);
}
export const createKnowledgeBase = (slug: string, input: { name: string; description?: string }) => apiPost<KnowledgeBase>(`${workspaceBase(slug)}/knowledge-bases`, input);
export const getKnowledgeBase = (slug: string, id: string, signal?: AbortSignal) => apiGet<KnowledgeBase>(collectionPath(slug, id), signal);
export const updateKnowledgeBase = (slug: string, id: string, input: { name?: string; description?: string; autoAddEligibleSources?: boolean }) => apiPatch<KnowledgeBase>(collectionPath(slug, id), input);
export const archiveKnowledgeBase = (slug: string, id: string) => apiDelete<KnowledgeBase>(collectionPath(slug, id));
export function listKnowledgeBaseSources(slug: string, id: string, query: Record<string, string | number> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<KnowledgeBaseSourcePage>(`${collectionPath(slug, id)}/sources${queryString ? `?${queryString}` : ''}`, signal);
}
export function listAvailableKnowledgeSources(slug: string, id: string, query: Record<string, string | number> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<KnowledgeBaseSourcePage>(`${workspaceBase(slug)}/knowledge-bases/${encodeURIComponent(id)}/available-sources${queryString ? `?${queryString}` : ''}`, signal);
}
export const addKnowledgeBaseSources = (slug: string, id: string, sourceIds: string[]) => apiPost<{ requested: number; added: number; alreadyPresent: number; restrictedVisibility: number; processingBlocked: number; failedProcessing: number; statusBlocked: number }>(`${collectionPath(slug, id)}/sources/bulk`, { sourceIds });
export const removeKnowledgeBaseSources = (slug: string, id: string, sourceIds: string[]) => apiDeleteWithBody<{ requested: number; removed: number; notPresent: number }>(`${collectionPath(slug, id)}/sources/bulk`, { sourceIds });
export type KnowledgeVisibility = 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';
export const createKnowledgeBaseFaq = (slug: string, id: string, input: { question: string; answer: string; visibility?: KnowledgeVisibility }) => apiPost<KnowledgeSource>(`${collectionPath(slug, id)}/sources/faq`, input);
export type KnowledgeSection = import('./knowledge').KnowledgeSection;
export type FaqDraft = { question: string; answer: string; category?: string; knowledgeSection?: KnowledgeSection; languageHint?: string; visibility?: KnowledgeVisibility };
export const createKnowledgeBaseFaqBatch = (slug: string, id: string, faqs: FaqDraft[]) => apiPost<{ created: number; sourceIds: string[] }>(`${collectionPath(slug, id)}/sources/faqs/batch`, { faqs });
export const createKnowledgeBaseText = (slug: string, id: string, input: { title: string; content: string; knowledgeSection?: KnowledgeSection; languageHint?: string; visibility?: KnowledgeVisibility }) => apiPost<KnowledgeSource>(`${collectionPath(slug, id)}/sources/text`, input);
export interface FaqImportRow { rowNumber: number; question: string; answer: string; category?: string; language?: string; visibility?: KnowledgeVisibility; errors: string[]; duplicateInFile: boolean; duplicateExisting: boolean; }
export interface FaqImportPreview { rows: FaqImportRow[]; total: number; valid: number; invalid: number; duplicates: number; }
export interface FaqImportResult { created: number; skipped: number; failed: number; updated: number; duplicateRowsInFile: number; }
export const previewKnowledgeBaseFaqImport = (slug: string, id: string, file: File, signal?: AbortSignal) => { const form = new FormData(); form.append('file', file); return apiPost<FaqImportPreview>(`${collectionPath(slug, id)}/sources/faqs/import/preview`, form, signal); };
export const importKnowledgeBaseFaqs = (slug: string, id: string, file: File, duplicatePolicy: 'SKIP_EXISTING' | 'REJECT_DUPLICATES', defaultVisibility: KnowledgeVisibility = 'INTERNAL_RESTRICTED', knowledgeSection?: KnowledgeSection) => { const form = new FormData(); form.append('file', file); form.append('duplicatePolicy', duplicatePolicy); form.append('defaultVisibility', defaultVisibility); if (knowledgeSection) form.append('knowledgeSection', knowledgeSection); return apiPost<FaqImportResult>(`${collectionPath(slug, id)}/sources/faqs/import`, form); };
export const knowledgeBaseFaqTemplateUrl = (slug: string, id: string) => `${apiConfig.baseUrl}${collectionPath(slug, id)}/sources/faqs/template.csv`;
export const getKnowledgeBaseAssistants = (slug: string, id: string, signal?: AbortSignal) => apiGet<KnowledgeBaseAssistants>(`${collectionPath(slug, id)}/assistants`, signal);
export const linkAssistantToKnowledgeBase = (slug: string, id: string, assistantId: string) => apiPost<{ assistantId: string; knowledgeBaseId: string; linked: boolean }>(`${collectionPath(slug, id)}/assistants/${encodeURIComponent(assistantId)}`);
export const unlinkAssistantFromKnowledgeBase = (slug: string, id: string, assistantId: string) => apiDelete<{ assistantId: string; knowledgeBaseId: string; unlinked: boolean }>(`${collectionPath(slug, id)}/assistants/${encodeURIComponent(assistantId)}`);
export function getAssistantKnowledgeBases(slug: string, assistantId: string, query: Record<string, string | number> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<AssistantKnowledgeBases>(`${assistantPath(slug, assistantId)}/knowledge-bases${queryString ? `?${queryString}` : ''}`, signal);
}
export const replaceAssistantKnowledgeBases = (slug: string, assistantId: string, knowledgeBaseIds: string[]) => apiPut<{ linked: KnowledgeBase[]; added: number; removed: number }>(`${assistantPath(slug, assistantId)}/knowledge-bases`, { knowledgeBaseIds });
export const getEffectiveKnowledge = (slug: string, assistantId: string, signal?: AbortSignal) => apiGet<EffectiveKnowledge>(`${assistantPath(slug, assistantId)}/effective-knowledge`, signal);

