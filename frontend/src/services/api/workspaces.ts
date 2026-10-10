import { apiGet, apiPatch, apiPost } from './client';

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  businessType: string | null;
  status: string;
  role: WorkspaceRole;
  currentUserRole?: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}
export interface WorkspacePage { workspaces: Workspace[]; page: number; pageSize: number; total: number; }
export interface WorkspaceMember { id: string; name: string | null; role: WorkspaceRole; joinedAt: string; }
export interface WorkspaceMembersPage { members: WorkspaceMember[]; page: number; pageSize: number; total: number; currentUserRole: WorkspaceRole; }
export interface CreateWorkspaceInput { name: string; slug: string; websiteUrl?: string; businessType?: string; }
export type UpdateWorkspaceInput = Partial<Pick<Workspace, 'name' | 'websiteUrl' | 'businessType'>>;

export function listWorkspaces(page = 1, signal?: AbortSignal) { return apiGet<WorkspacePage>(`/workspaces?page=${page}&pageSize=100`, signal); }
export async function listAllWorkspaces(signal?: AbortSignal) {
  const first = await listWorkspaces(1, signal);
  const pageCount = Math.ceil(first.total / first.pageSize);
  if (pageCount <= 1) return first.workspaces;
  const remaining = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => listWorkspaces(index + 2, signal)));
  return [
    ...first.workspaces,
    ...remaining.flatMap((page) => page.workspaces),
  ];
}
export function createWorkspace(input: CreateWorkspaceInput, signal?: AbortSignal) { return apiPost<Workspace>('/workspaces', input, signal); }
export function getWorkspace(slug: string, signal?: AbortSignal) { return apiGet<Workspace>(`/workspaces/${encodeURIComponent(slug)}`, signal); }
export function updateWorkspace(slug: string, input: UpdateWorkspaceInput, signal?: AbortSignal) { return apiPatch<Workspace>(`/workspaces/${encodeURIComponent(slug)}`, input, signal); }
export function listWorkspaceMembers(slug: string, page = 1, signal?: AbortSignal) {
  return apiGet<WorkspaceMembersPage>(`/workspaces/${encodeURIComponent(slug)}/members?page=${page}&pageSize=50`, signal);
}
