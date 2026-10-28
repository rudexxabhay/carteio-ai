export const MAX_RETRIEVAL_QUERY_VARIANTS = 8;
export const MAX_RETRIEVAL_QUERY_LENGTH = 300;
export type ProtectedRetrievalEntity = Readonly<{ type: string; raw: string }>;
export type RetrievalQueryPlan = Readonly<{
  originalQuery: string;
  contextualQuery: string | null;
  queries: readonly string[];
  rejectedExpansionCount: number;
}>;

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_RETRIEVAL_QUERY_LENGTH);
const key = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const identifierTokens = (value: string) => value.match(/\b(?=[A-Z0-9_-]{4,}\b)(?=[A-Z0-9_-]*\d)[A-Z0-9]+(?:[-_][A-Z0-9]+)*\b/giu) ?? [];

/**
 * Builds a bounded, advisory retrieval plan from the current message, an already
 * authorized same-session reference, and validated interpretation candidates.
 * It never selects sources or grants access. Provider-written rewrites that
 * introduce identifier-shaped values are discarded; validated exact entities
 * are retained in rewrites so they cannot be silently mutated or omitted.
 */
export function buildRetrievalQueryPlan(input: {
  originalMessage: string;
  contextualQuery?: string | null;
  semanticQueries?: readonly string[];
  answerAspectQueries?: readonly string[];
  protectedEntities?: readonly ProtectedRetrievalEntity[];
}): RetrievalQueryPlan {
  const originalQuery = clean(input.originalMessage);
  const contextualQuery = input.contextualQuery ? clean(input.contextualQuery) : null;
  const safeEntities = (input.protectedEntities ?? []).filter((entity) =>
    typeof entity.raw === 'string' && entity.raw.length > 0 && entity.raw.length <= 200
      && (input.originalMessage.includes(entity.raw) || Boolean(input.contextualQuery?.includes(entity.raw))));
  const authorizedIdentifiers = new Set([
    ...identifierTokens(input.originalMessage),
    ...(input.contextualQuery ? identifierTokens(input.contextualQuery) : []),
    ...safeEntities.map((entity) => entity.raw),
  ]);

  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const normalized = clean(value);
    const identity = key(normalized);
    if (normalized && !seen.has(identity) && queries.length < MAX_RETRIEVAL_QUERY_VARIANTS) {
      seen.add(identity);
      queries.push(normalized);
    }
  };
  // A resolved reference is useful for search, while the current wording is
  // always retained as its own query and never replaced by a rewrite.
  if (contextualQuery) add(contextualQuery);
  add(originalQuery);
  let rejectedExpansionCount = 0;

  // Aspect search expressions are validated as part of the interpretation
  // contract. They improve coverage for multi-part questions but do not carry
  // any source permissions or entity authority.
  for (const candidate of input.answerAspectQueries ?? []) {
    if (queries.length >= MAX_RETRIEVAL_QUERY_VARIANTS) break;
    if (typeof candidate !== 'string' || candidate.length > MAX_RETRIEVAL_QUERY_LENGTH) { rejectedExpansionCount++; continue; }
    let expanded = clean(candidate);
    if (!expanded || key(expanded) === key(originalQuery) || (contextualQuery && key(expanded) === key(contextualQuery))) continue;
    const candidateIdentifiers = identifierTokens(expanded);
    if (candidateIdentifiers.some((identifier) => !authorizedIdentifiers.has(identifier))) {
      rejectedExpansionCount++;
      continue;
    }
    for (const entity of safeEntities) {
      if (expanded.includes(entity.raw)) continue;
      const joined = `${expanded} ${entity.raw}`;
      if (joined.length > MAX_RETRIEVAL_QUERY_LENGTH) { expanded = ''; break; }
      expanded = joined;
    }
    if (!expanded) { rejectedExpansionCount++; continue; }
    add(expanded);
  }

  for (const candidate of input.semanticQueries ?? []) {
    if (queries.length >= MAX_RETRIEVAL_QUERY_VARIANTS) break;
    if (typeof candidate !== 'string' || candidate.length > MAX_RETRIEVAL_QUERY_LENGTH) { rejectedExpansionCount++; continue; }
    let expanded = clean(candidate);
    if (!expanded || key(expanded) === key(originalQuery) || (contextualQuery && key(expanded) === key(contextualQuery))) continue;
    const candidateIdentifiers = identifierTokens(expanded);
    if (candidateIdentifiers.some((identifier) => !authorizedIdentifiers.has(identifier))) {
      rejectedExpansionCount++;
      continue;
    }
    // Preserve server-validated identifiers through a semantic rewrite. This
    // keeps exact IDs searchable without allowing the rewrite to canonicalize them.
    for (const entity of safeEntities) {
      if (expanded.includes(entity.raw)) continue;
      const joined = `${expanded} ${entity.raw}`;
      if (joined.length > MAX_RETRIEVAL_QUERY_LENGTH) { expanded = ''; break; }
      expanded = joined;
    }
    if (!expanded) { rejectedExpansionCount++; continue; }
    add(expanded);
  }

  return Object.freeze({ originalQuery, contextualQuery, queries: Object.freeze(queries), rejectedExpansionCount });
}
