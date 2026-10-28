import { ApiError, apiGet } from './client';
import type { EffectiveProviderConfiguration } from './assistants';

export interface DashboardAssistant {
  id: string;
  name: string;
  purpose: string | null;
  status: 'draft' | 'active' | 'inactive';
  providerConfigured: boolean;
  provider?: 'groq' | 'gemini' | 'openai' | 'openrouter' | null;
  model?: string | null;
  updatedAt: string;
  linkedKnowledgeBaseCount: number;
  directKnowledgeCount: number;
}
export interface DashboardSection<T> { status: 'success' | 'error'; data?: T; }
export interface WorkspaceDashboardSummary {
  workspace?: { businessType: string | null; websiteUrl: string | null; timezone: string; role: string; updatedAt: string | null };
  integrations?: { connectedCount: number; draftCount: number; errorCount: number; status: 'AVAILABLE' | 'NOT_CONNECTED' | 'SYNC_PENDING' | 'ERROR'; items: Array<{ id: string; platform: string; displayName: string; state: string; lastSyncAt: string | null; lastSuccessfulSyncAt: string | null; lastErrorCode: string | null }> };
  commerce?: { status: 'AVAILABLE' | 'NO_DATA' | 'NOT_CONNECTED' | 'ERROR'; productCount?: number; activeProductCount?: number; outOfStockCount?: number; orderCount?: number; pendingOrderCount?: number; recentOrders?: Array<{ id: string; displayReference: string | null; currency: string | null; total: string | number | null; financialStatus: string | null; fulfillmentStatus: string | null; orderedAt: string | null; connection: { displayName: string; platform: string } }> };
  sales?: { status: 'AVAILABLE' | 'NO_DATA' | 'NOT_CONNECTED' | 'PERMISSION_REQUIRED' | 'ERROR'; from?: string; to?: string; currencyTotals?: Array<{ currency: string | null; orderCount: number; netSales: string | null }> };
  playground?: DashboardSection<{ sessions: number; from: string; to: string; kind: 'PLAYGROUND_ONLY' }>;
  assistants: DashboardSection<{ total: number; active: number; withoutKnowledge: number; withoutProvider: number; effectiveProviderConfiguration?: EffectiveProviderConfiguration; firstActiveAssistantId: string | null; items: DashboardAssistant[] }>;
  knowledge: DashboardSection<{ knowledgeBaseCount: number; firstKnowledgeBaseId: string | null; faq: number; text: number; website?: number; ready: number; processing: number; failed: number; notIndexed: number; total: number }>;
  activity: DashboardSection<Array<{ id: string; action: string; entityType: string; createdAt: string; actorUser: { name: string | null; email: string } | null }>>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isAssistantSummaryData(value: unknown): value is NonNullable<WorkspaceDashboardSummary['assistants']['data']> {
  if (!isRecord(value) || !isNumber(value.total) || !isNumber(value.active) || !isNumber(value.withoutKnowledge) || !isNumber(value.withoutProvider) || !isNullableString(value.firstActiveAssistantId) || !Array.isArray(value.items)) return false;
  if (value.effectiveProviderConfiguration !== undefined) {
    const config = value.effectiveProviderConfiguration;
    if (!isRecord(config) || (config.provider !== null && config.provider !== 'groq' && config.provider !== 'gemini' && config.provider !== 'openai' && config.provider !== 'openrouter') || !isNullableString(config.model) || typeof config.status !== 'string' || typeof config.configurationValid !== 'boolean' || typeof config.keyConfigured !== 'boolean' || typeof config.ready !== 'boolean') return false;
  }
  return value.items.every((item: unknown) => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' && isNullableString(item.purpose) && ['draft', 'active', 'inactive'].includes(String(item.status)) && typeof item.providerConfigured === 'boolean' && (item.provider === undefined || item.provider === null || item.provider === 'groq' || item.provider === 'gemini' || item.provider === 'openai' || item.provider === 'openrouter') && (item.model === undefined || isNullableString(item.model)) && typeof item.updatedAt === 'string' && isNumber(item.linkedKnowledgeBaseCount) && isNumber(item.directKnowledgeCount));
}

function isKnowledgeSummaryData(value: unknown): value is NonNullable<WorkspaceDashboardSummary['knowledge']['data']> {
  return isRecord(value) && isNumber(value.knowledgeBaseCount) && isNullableString(value.firstKnowledgeBaseId) && isNumber(value.faq) && isNumber(value.text) && (value.website === undefined || isNumber(value.website)) && isNumber(value.ready) && isNumber(value.processing) && isNumber(value.failed) && isNumber(value.notIndexed) && isNumber(value.total);
}

function isActivityData(value: unknown): value is NonNullable<WorkspaceDashboardSummary['activity']['data']> {
  return Array.isArray(value) && value.every((event: unknown) => isRecord(event) && typeof event.id === 'string' && typeof event.action === 'string' && typeof event.entityType === 'string' && typeof event.createdAt === 'string' && (event.actorUser === null || (isRecord(event.actorUser) && isNullableString(event.actorUser.name) && typeof event.actorUser.email === 'string')));
}

function isSection<T>(value: unknown, isData: (data: unknown) => data is T): value is DashboardSection<T> {
  if (!isRecord(value) || (value.status !== 'success' && value.status !== 'error')) return false;
  return value.status === 'error' || isData(value.data);
}

function isDashboardSummary(value: unknown): value is WorkspaceDashboardSummary {
  if (!isRecord(value)) return false;
  if (value.workspace !== undefined && (!isRecord(value.workspace) || !isNullableString(value.workspace.businessType) || !isNullableString(value.workspace.websiteUrl) || typeof value.workspace.timezone !== 'string' || typeof value.workspace.role !== 'string' || !isNullableString(value.workspace.updatedAt))) return false;
  if (value.integrations !== undefined && (!isRecord(value.integrations) || !isNumber(value.integrations.connectedCount) || !isNumber(value.integrations.draftCount) || !isNumber(value.integrations.errorCount) || !['AVAILABLE', 'NOT_CONNECTED', 'SYNC_PENDING', 'ERROR'].includes(String(value.integrations.status)) || !Array.isArray(value.integrations.items) || !value.integrations.items.every((item: unknown) => isRecord(item) && typeof item.id === 'string' && typeof item.platform === 'string' && typeof item.displayName === 'string' && typeof item.state === 'string' && isNullableString(item.lastSyncAt) && isNullableString(item.lastSuccessfulSyncAt) && isNullableString(item.lastErrorCode)))) return false;
  if (value.commerce !== undefined && (!isRecord(value.commerce) || !['AVAILABLE', 'NO_DATA', 'NOT_CONNECTED', 'ERROR'].includes(String(value.commerce.status)) || (value.commerce.productCount !== undefined && !isNumber(value.commerce.productCount)) || (value.commerce.activeProductCount !== undefined && !isNumber(value.commerce.activeProductCount)) || (value.commerce.outOfStockCount !== undefined && !isNumber(value.commerce.outOfStockCount)) || (value.commerce.orderCount !== undefined && !isNumber(value.commerce.orderCount)) || (value.commerce.pendingOrderCount !== undefined && !isNumber(value.commerce.pendingOrderCount)) || (value.commerce.recentOrders !== undefined && (!Array.isArray(value.commerce.recentOrders) || !value.commerce.recentOrders.every((item: unknown) => isRecord(item) && typeof item.id === 'string' && isNullableString(item.displayReference) && isNullableString(item.currency) && (isNullableString(item.total) || isNumber(item.total)) && isNullableString(item.financialStatus) && isNullableString(item.fulfillmentStatus) && isNullableString(item.orderedAt) && isRecord(item.connection) && typeof item.connection.displayName === 'string' && typeof item.connection.platform === 'string'))))) return false;
  if (value.sales !== undefined && (!isRecord(value.sales) || !['AVAILABLE', 'NO_DATA', 'NOT_CONNECTED', 'PERMISSION_REQUIRED', 'ERROR'].includes(String(value.sales.status)) || (value.sales.from !== undefined && typeof value.sales.from !== 'string') || (value.sales.to !== undefined && typeof value.sales.to !== 'string') || (value.sales.currencyTotals !== undefined && (!Array.isArray(value.sales.currencyTotals) || !value.sales.currencyTotals.every((item: unknown) => isRecord(item) && isNullableString(item.currency) && isNumber(item.orderCount) && isNullableString(item.netSales)))))) return false;
  if (value.playground !== undefined && !isSection(value.playground, (data): data is NonNullable<WorkspaceDashboardSummary['playground']>['data'] => isRecord(data) && isNumber(data.sessions) && typeof data.from === 'string' && typeof data.to === 'string' && data.kind === 'PLAYGROUND_ONLY')) return false;
  const assistants = isSection(value.assistants, isAssistantSummaryData);
  const knowledge = isSection(value.knowledge, isKnowledgeSummaryData);
  const activity = isSection(value.activity, isActivityData);
  return assistants && knowledge && activity;
}

export async function getWorkspaceDashboardSummary(slug: string, signal?: AbortSignal): Promise<WorkspaceDashboardSummary> {
  const response = await apiGet<unknown>(`/workspaces/${encodeURIComponent(slug)}/dashboard-summary`, signal);
  if (!isDashboardSummary(response)) throw new ApiError('The workspace overview returned an invalid response.', 'invalid-response');
  return response;
}
