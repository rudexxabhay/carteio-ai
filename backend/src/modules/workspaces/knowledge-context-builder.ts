export type ContextEvidence = Readonly<{
  reference: string;
  sourceId: string;
  contentHash: string;
  excerpt: string;
  title: string;
  type: string;
  locator: string | null;
  sourceAuthority?: string | null;
  retrievalScore?: number;
  dataCompleteness?: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
}>;

export type BuiltEvidenceContext<T extends ContextEvidence> = Readonly<{
  evidence: readonly T[];
  estimatedTokens: number;
  bytes: number;
  droppedDuplicates: number;
  droppedForBudget: number;
  droppedForDiversity: number;
}>;

const authorityRank = (evidence: ContextEvidence) => evidence.sourceAuthority === 'SHOPIFY_API_POLICY' ? 2 : evidence.sourceAuthority === 'SHOPIFY_API_POLICY_STALE' ? 0 : 1;

/** Bounded evidence selection; excerpts remain untrusted data and are never interpreted here. */
export function buildEvidenceContext<T extends ContextEvidence>(
  candidates: readonly T[],
  options: { maxBytes?: number; maxTokens?: number; maxItems?: number; maxPerSource?: number } = {},
): BuiltEvidenceContext<T> {
  const maxBytes = Math.max(1024, Math.min(32 * 1024, options.maxBytes ?? 20 * 1024));
  const maxTokens = Math.max(256, Math.min(8_000, options.maxTokens ?? 6_000));
  const maxItems = Math.max(1, Math.min(8, options.maxItems ?? 5));
  const maxPerSource = Math.max(1, Math.min(4, options.maxPerSource ?? 2));
  const sorted = [...candidates].sort((left, right) => authorityRank(right) - authorityRank(left)
    || (right.retrievalScore ?? 0) - (left.retrievalScore ?? 0)
    || left.sourceId.localeCompare(right.sourceId)
    || left.reference.localeCompare(right.reference));
  const selected: T[] = [];
  const duplicateKeys = new Set<string>();
  const sourceCounts = new Map<string, number>();
  let bytes = 0, estimatedTokens = 0, droppedDuplicates = 0, droppedForBudget = 0, droppedForDiversity = 0;
  for (const candidate of sorted) {
    const normalizedExcerpt = candidate.excerpt.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
    const duplicateKey = JSON.stringify([candidate.sourceId, candidate.type, candidate.locator, normalizedExcerpt]);
    if (duplicateKeys.has(duplicateKey)) { droppedDuplicates++; continue; }
    duplicateKeys.add(duplicateKey);
    const sourceCount = sourceCounts.get(candidate.sourceId) ?? 0;
    const sourceLimit = candidate.sourceAuthority === 'SHOPIFY_API_POLICY' ? Math.max(maxPerSource, 3) : maxPerSource;
    if (sourceCount >= sourceLimit) { droppedForDiversity++; continue; }
    if (selected.length >= maxItems) { droppedForBudget++; continue; }
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    const candidateTokens = Math.ceil(candidateBytes / 2);
    if (bytes + candidateBytes > maxBytes || estimatedTokens + candidateTokens > maxTokens) { droppedForBudget++; continue; }
    selected.push(candidate);
    bytes += candidateBytes;
    estimatedTokens += candidateTokens;
    sourceCounts.set(candidate.sourceId, sourceCount + 1);
  }
  let knowledgeReference = 0, commerceReference = 0;
  const evidence = selected.map((item) => {
    const commerce = item.reference.startsWith('C');
    const reference = commerce ? `C${++commerceReference}` : `S${++knowledgeReference}`;
    return { ...item, reference };
  });
  return { evidence, bytes, estimatedTokens, droppedDuplicates, droppedForBudget, droppedForDiversity };
}
