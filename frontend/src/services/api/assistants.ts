import { apiGet, apiPatch, apiPost } from './client';

export type AssistantStatus = 'draft' | 'active' | 'inactive';
export type ResponseTone = 'professional' | 'friendly' | 'concise' | 'empathetic';
export interface Assistant {
  id: string;
  organizationId: string;
  createdById: string | null;
  name: string;
  description: string | null;
  businessPurpose: string | null;
  systemInstructions: string | null;
  defaultLanguage: string;
  responseTone: ResponseTone;
  fallbackMessage: string;
  status: AssistantStatus;
  createdAt: string;
  updatedAt: string;
}
export type AssistantInput = Pick<Assistant, 'name' | 'description' | 'businessPurpose' | 'systemInstructions' | 'defaultLanguage' | 'responseTone' | 'fallbackMessage'>;
export interface AssistantPage { assistants: Assistant[]; page: number; pageSize: number; total: number; }

const base = (slug: string) => `/workspaces/${encodeURIComponent(slug)}/assistants`;
export function listAssistants(slug: string, page = 1, signal?: AbortSignal) {
  return apiGet<AssistantPage>(`${base(slug)}?page=${page}&pageSize=100`, signal);
}
export function getAssistant(slug: string, id: string, signal?: AbortSignal) {
  return apiGet<Assistant>(`${base(slug)}/${encodeURIComponent(id)}`, signal);
}
export function createAssistant(slug: string, input: AssistantInput, signal?: AbortSignal) {
  return apiPost<Assistant>(base(slug), input, signal);
}
export function updateAssistant(slug: string, id: string, input: Partial<AssistantInput>, signal?: AbortSignal) {
  return apiPatch<Assistant>(`${base(slug)}/${encodeURIComponent(id)}`, input, signal);
}
export function setAssistantActive(slug: string, id: string, active: boolean, signal?: AbortSignal) {
  return apiPost<Assistant>(`${base(slug)}/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`, undefined, signal);
}
