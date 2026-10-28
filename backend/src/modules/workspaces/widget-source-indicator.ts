export type WidgetEvidenceSource = 'SHOPIFY' | 'KNOWLEDGE_BASE' | 'WEBSITE';
export type WidgetSourceIndicator = Readonly<{
  generationType: 'AI_GENERATED' | 'SYSTEM_GENERATED';
  evidenceSources: readonly WidgetEvidenceSource[];
}>;

const systemOrigins = new Set(['DETERMINISTIC_SOCIAL', 'DETERMINISTIC_POLICY', 'KNOWLEDGE_FALLBACK']);

/** Builds a public, coarse source label from persisted server provenance only. */
export function widgetSourceIndicator(answerOrigin: unknown, rawSources: unknown, kind: unknown = 'AI'): WidgetSourceIndicator | undefined {
  const origin = typeof answerOrigin === 'string' ? answerOrigin : '';
  const generationType = origin === 'MODEL_GENERATED' ? 'AI_GENERATED'
    : systemOrigins.has(origin) || kind === 'SYSTEM' || origin === 'SYSTEM_GENERATED' ? 'SYSTEM_GENERATED' : undefined;
  if (!generationType) return undefined;

  const sources = new Set<WidgetEvidenceSource>();
  if (Array.isArray(rawSources)) {
    for (const value of rawSources) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (item.cited !== 'true') continue;
      if (typeof item.type !== 'string') continue;
      if (item.type === 'COMMERCE_PRODUCT' || item.sourceAuthority === 'SHOPIFY_API_POLICY' || item.sourceAuthority === 'SHOPIFY_API_POLICY_STALE') sources.add('SHOPIFY');
      else if (item.type === 'WEBSITE' || item.sourceAuthority === 'PUBLIC_WEBSITE') sources.add('WEBSITE');
      else sources.add('KNOWLEDGE_BASE');
    }
  }
  const ordered = (['SHOPIFY', 'KNOWLEDGE_BASE', 'WEBSITE'] as const).filter((source) => sources.has(source));
  return { generationType, evidenceSources: ordered };
}
