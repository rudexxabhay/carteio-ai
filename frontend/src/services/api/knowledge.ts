import { apiDelete, apiGet, apiPatch, apiPost } from './client';

export type KnowledgeType = 'website' | 'faq' | 'text';
export type KnowledgeSection = 'BUSINESS_INTRODUCTION' | 'SHIPPING_DELIVERY' | 'RETURNS_REFUNDS' | 'PAYMENT_CANCELLATION' | 'WARRANTY_SUPPORT_FAQS';
export type ProcessingStatus = 'not_processed' | 'queued' | 'processing' | 'ready' | 'failed';
export type KnowledgeDocumentStage = 'UPLOADING' | 'EXTRACTING' | 'SAVING' | 'QUEUED' | 'INDEXING' | 'READY' | 'FAILED';
export interface KnowledgePdfPageMetadata { page: number; start: number; end: number; heading?: string | null; contentHash?: string; wordCount?: number; extractionWarnings?: string[]; }
export interface KnowledgeDocumentMetadata { provenance?: 'AUTHENTICATED_PDF_EXTRACTION_V1' | null; filename: string; bytes: number; hash: string; contentHash?: string; sourceLanguage?: 'en'; extracted: boolean; pages: KnowledgePdfPageMetadata[]; pageCount?: number; characterCount?: number; wordCount?: number; warnings: string[]; }
export interface KnowledgeDocumentProcessingProgress { processingId: string; stage: KnowledgeDocumentStage; totalPages?: number; pagesExtracted: number; pagesPersisted: number; chunksIndexed: number; failureReason?: string; lastUpdatedAt: string; completedAt?: string; }
export interface KnowledgeSource {
  document?: KnowledgeDocumentMetadata | null;
  id: string; organizationId: string; createdById: string | null; type: KnowledgeType;
  status: 'registered' | 'disabled' | 'archived'; processingStatus: ProcessingStatus;
  name: string; description: string | null; sourceUrl: string | null; contentBody: string | null;
  category: string | null; knowledgeSection?: KnowledgeSection | null; languageHint: string | null; sourceVersion: number;
  activeIndexGeneration?: number | null; processingErrorCode?: string | null;
  semanticIndexStatus?: 'NOT_CONFIGURED' | 'PENDING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED'; semanticIndexErrorCode?: string | null;
  visibility?: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE';
  lastSyncAt: string | null; lastSuccessfulSyncAt: string | null; lastSyncErrorCode: string | null;
  verificationStatus?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'FAILED'; verifiedAt?: string | null;
  syncPolicy?: 'MANUAL' | 'DAILY' | 'WEEKLY'; syncPaused?: boolean; nextSyncAt?: string | null;
  deletedAt: string | null; createdAt: string; updatedAt: string; linkedAssistantCount?: number; pageCount?: number;
  indexedPageCount?: number; activeChunkCount?: number; lastIndexedAt?: string | null; activeIndexSearchable?: boolean; blockedReason?: string;
  knowledgeBaseMemberships?: Array<{ id: string; name: string; status: string; assistantAssignments?: Array<{ id: string; name: string; status: string }> }>;
  directAssistantAssignments?: Array<{ id: string; name: string; status: string }>;
}
export interface SourcePage { sources: KnowledgeSource[]; total: number; page?: number; pageSize?: number; pageCount?: number; counts?: Array<{ section: KnowledgeSection | null; status: ProcessingStatus; count: number }>; pdfCounts?: Array<{ section: KnowledgeSection | null; status: ProcessingStatus; count: number }>; }
export interface AssistantKnowledge { linked: KnowledgeSource[]; available: KnowledgeSource[]; }
export interface ProcessingDetails { id: string; processingStatus: string; processingErrorCode: string | null; semanticIndexStatus: 'NOT_CONFIGURED' | 'PENDING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED'; semanticIndexErrorCode: string | null; semanticVectorCount?: number; semanticEmbeddingProvider?: 'openai' | 'openrouter' | null; semanticEmbeddingModel?: string | null; semanticEmbeddingDimensions?: number | null; sourceVersion: number; activeIndexGeneration: number | null; documentProgress?: KnowledgeDocumentProcessingProgress; jobs: Array<{ id: string; kind: string; status: string; stage: string | null; attempts: number; errorCode: string | null; createdAt: string; updatedAt: string }>; chunkCount: number; lastIndexedAt: string | null; }
export interface KnowledgeChunkPage { sourceId: string; sourceVersion: number; activeGeneration: number | null; processingStatus: string; activeChunkCount: number; chunks: Array<{ id: string; pageId: string | null; sourceVersion: number; generation: number; sequence: number; contentPreview: string; locator: string | null; indexedAt: string; active: boolean; page: { title: string; canonicalUrl: string; status: string } | null }>; total: number; page: number; pageSize: number; pageCount: number; }
export interface KnowledgeEvidenceMetadataRequest { assistantId: string; items: Array<{ sourceId: string; chunkId: string; pageId?: string | null; sourceVersion: number; generation: number }>; }
export interface KnowledgeEvidenceMetadataItem { sourceId: string; chunkId: string; status: 'CURRENT_VERIFIED_PDF' | 'HISTORICAL_SOURCE_NO_LONGER_ELIGIBLE' | 'METADATA_UNAVAILABLE'; provenance?: 'AUTHENTICATED_PDF_EXTRACTION_V1'; filename?: string | null; title?: string; section?: string | null; knowledgeBaseId?: string | null; knowledgeBaseName?: string | null; sourceVersion?: number; generation?: number; pageId?: string | null; locator?: string | null; chunkSequence?: number; customerVisible?: boolean; }
export interface KnowledgeSearchHit { chunkId: string; sourceId: string; sourceTitle: string; sourceType: string; visibility: string; content: string; locator: string | null; pageUrl?: string | null; pageTitle?: string | null; pageCategory?: string | null; languageHint?: string | null; sourceAuthority?: 'SHOPIFY_API_POLICY' | 'SHOPIFY_API_POLICY_STALE' | 'PUBLIC_WEBSITE' | 'MERCHANT_KNOWLEDGE'; sourceDataAt?: string | null; pageFetchedAt?: string | null; sourceVersion: number; generation?: number; indexedAt: string; score: number; rankingPosition?: number; method?: string; }
export interface KnowledgeSearchResult { mode: 'lexical_only' | 'hybrid'; audience?: 'INTERNAL_MANAGER_PREVIEW' | 'PUBLIC_VISITOR'; semanticUnavailableCode?: string; context: 'authenticated_workspace_preview' | 'public_safe_playground_preview'; eligibleSourceCount: number; results: KnowledgeSearchHit[]; diagnostics?: { assignedSourceCount: number; rejectedSourceCount: number; indexReadySourceCount: number; activeIndexChunkCount: number; indexReadinessDurationMs: number; queryVariantCount: number; lexicalCandidateCount: number; semanticCandidateCount: number; rankedCandidateCount: number; selectedEvidenceCount: number; lexicalDurationMs: number; semanticDurationMs: number; rankingDurationMs: number; methodsAttempted: string[]; retrievalReason?: string; rejectionReasons: Array<{ reason: string; count: number }>; sourceIndexStates: Array<{ sourceId: string; sourceVersion: number; activeGeneration: number | null; processingStatus: string; ready: boolean; activeChunkCount: number }> }; }
export interface ShopifyWebsiteDiscoveryStatus { connectorInstanceId: string; storefrontUrl: string | null; sourceId: string | null; sourceUrl?: string | null; authorizationStatus: 'NOT_REGISTERED' | 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'FAILED'; verifiedAt?: string | null; crawlAllowed?: boolean; crawlStatus?: string; crawlStage?: string | null; discoveredUrls: number; crawledPages: number; ingestedPages: number; changedPages?: number; unchangedPages?: number; removedPages?: number; failedPages: number; skippedPages: number; unsupportedPages: number; retryableFailures: number; partial?: boolean; knowledgeFreshness: 'FRESH' | 'STALE' | 'UNAVAILABLE'; lastSuccessfulRefreshAt: string | null; lastAttemptAt: string | null; lastSuccessfulIndexAt?: string | null; nextScheduledRefreshAt?: string | null; errorCode: string | null; }
const base = (slug: string) => `/workspaces/${encodeURIComponent(slug)}/knowledge`;
const assistantBase = (slug: string, assistantId: string) => `/workspaces/${encodeURIComponent(slug)}/assistants/${encodeURIComponent(assistantId)}/knowledge`;
export const listKnowledge = (slug: string, signal?: AbortSignal, query: { page?: number; pageSize?: number; search?: string; section?: KnowledgeSection; processingStatus?: string; pdfOnly?: boolean } = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return apiGet<SourcePage>(`${base(slug)}${params.size ? `?${params}` : ''}`, signal);
};
export const getDocumentCapabilities = (slug: string, signal?: AbortSignal) => apiGet<{ uploadAvailable: boolean; maxBytes: number; maxPages: number; workerEnabled: boolean; blockedReason: string | null }>(`${base(slug)}/document-capabilities`, signal);
export const uploadKnowledgePdf = (slug: string, file: File, input: { knowledgeBaseId: string; knowledgeSection: KnowledgeSection; visibility: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE'; title?: string }, sourceId?: string) => {
  const form = new FormData(); form.append('file', file);
  Object.entries(input).forEach(([key, value]) => form.append(key, value));
  return apiPost<KnowledgeSource>(`${base(slug)}/${sourceId ? `${encodeURIComponent(sourceId)}/document` : 'documents'}`, form, undefined, { timeoutMs: 60_000 });
};
export const getKnowledgeSource = (slug: string, sourceId: string, signal?: AbortSignal) => apiGet<KnowledgeSource & { directAssistantAssignments?: Array<{ id: string; name: string; status: string }> }>(`${base(slug)}/${encodeURIComponent(sourceId)}`, signal);
export const resolveKnowledgeEvidenceMetadata = (slug: string, input: KnowledgeEvidenceMetadataRequest, signal?: AbortSignal) => apiPost<{ items: KnowledgeEvidenceMetadataItem[] }>(`${base(slug)}/evidence-metadata`, input, signal);
export const getShopifyWebsiteDiscovery = (slug: string, connectorId: string, signal?: AbortSignal) => apiGet<ShopifyWebsiteDiscoveryStatus>(`${base(slug)}/shopify/${encodeURIComponent(connectorId)}/discovery`, signal);
export const discoverShopifyWebsite = (slug: string, connectorId: string) => apiPost<{ connectorInstanceId: string; storefrontUrl: string; sourceId: string; sourceUrl: string | null; authorizationStatus: string; verifiedAt: string | null; crawlAllowed: boolean }>(`${base(slug)}/shopify/${encodeURIComponent(connectorId)}/discovery`, {});
export const createShopifyWebsiteVerificationChallenge = (slug: string, connectorId: string) => apiPost<{ hostname: string; recordName: string; recordValue: string; expiresAt: string }>(`${base(slug)}/shopify/${encodeURIComponent(connectorId)}/discovery/verification-challenge`, {});
export const verifyShopifyWebsite = (slug: string, connectorId: string) => apiPost<{ verificationStatus: string; verifiedAt: string }>(`${base(slug)}/shopify/${encodeURIComponent(connectorId)}/discovery/verify`, {});
export const refreshShopifyWebsite = (slug: string, connectorId: string) => apiPost<{ sourceId: string; jobId: string; status: string }>(`${base(slug)}/shopify/${encodeURIComponent(connectorId)}/discovery/refresh`, {});
export const updateKnowledge = (slug: string, id: string, input: Record<string, string>) => apiPatch<KnowledgeSource>(`${base(slug)}/${encodeURIComponent(id)}`, input);
export const archiveKnowledge = (slug: string, id: string) => apiDelete<KnowledgeSource>(`${base(slug)}/${encodeURIComponent(id)}`);
export const archiveKnowledgeSources = (slug: string, sourceIds: string[]) => apiPost<{ requested: number; archived: number; alreadyArchived: number }>(`${base(slug)}/archive/bulk`, { sourceIds });
export const getAssistantKnowledge = (slug: string, assistantId: string, signal?: AbortSignal) => apiGet<AssistantKnowledge>(assistantBase(slug, assistantId), signal);
export const attachKnowledge = (slug: string, assistantId: string, sourceId: string) => apiPost<{ linked: boolean }>(`${assistantBase(slug, assistantId)}/${encodeURIComponent(sourceId)}`);
export const detachKnowledge = (slug: string, assistantId: string, sourceId: string) => apiDelete<{ unlinked: boolean }>(`${assistantBase(slug, assistantId)}/${encodeURIComponent(sourceId)}`);
export const getKnowledgeProcessing = (slug: string, sourceId: string, signal?: AbortSignal) => apiGet<ProcessingDetails>(`${base(slug)}/${encodeURIComponent(sourceId)}/processing`, signal);
export function getKnowledgeChunks(slug: string, sourceId: string, query: { page?: number; pageSize?: number; search?: string } = {}, signal?: AbortSignal) { const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])); const queryString = params.toString(); return apiGet<KnowledgeChunkPage>(`${base(slug)}/${encodeURIComponent(sourceId)}/chunks${queryString ? `?${queryString}` : ''}`, signal); }
export const reindexKnowledge = (slug: string, sourceId: string) => apiPost<{ sourceId: string; status: string }>(`${base(slug)}/${encodeURIComponent(sourceId)}/reindex`, {});
export const previewKnowledgeSearch = (slug: string, assistantId: string, query: string) => apiPost<KnowledgeSearchResult>(`${base(slug)}/search-preview`, { assistantId, query, limit: 5 });
export const restoreKnowledge = (slug: string, sourceId: string) => apiPost<KnowledgeSource>(`${base(slug)}/${encodeURIComponent(sourceId)}/restore`, {});
export const permanentlyDeleteKnowledge = (slug: string, sourceId: string) => apiDelete<{ sourceId: string; deleted: boolean; impact: Record<string, number> }>(`${base(slug)}/${encodeURIComponent(sourceId)}/permanent`);
export const getKnowledgeDeleteImpact = (slug: string, sourceId: string) => apiGet<{ sourceId: string; impact: Record<string, number> }>(`${base(slug)}/${encodeURIComponent(sourceId)}/delete-impact`);
