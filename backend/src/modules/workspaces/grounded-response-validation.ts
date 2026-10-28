import type { ConversationEvidence, ConversationVerification } from './conversation.contracts';

type MoneyFact = Readonly<{ amount: string; currency: string }>;

const normalizeAmount = (value: string) => {
  const parsed = Number(value.replace(/,/gu, ''));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
};

function currencyCode(value: string): string | null {
  const normalized = value.trim().toLocaleUpperCase();
  if (/^(?:₹|INR|RS\.?|RUPEES?)$/u.test(normalized)) return 'INR';
  if (/^(?:\$|USD|US\$)$/u.test(normalized)) return 'USD';
  if (/^(?:€|EUR)$/u.test(normalized)) return 'EUR';
  if (/^(?:£|GBP)$/u.test(normalized)) return 'GBP';
  return null;
}

function textualMoneyFacts(text: string): MoneyFact[] {
  const found: MoneyFact[] = [];
  const pattern = /(?:(₹|\$|€|£|\bINR\b|\bUSD\b|\bEUR\b|\bGBP\b|\bRs\.?)(?:\s*)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)(?:\s*)(\bINR\b|\bUSD\b|\bEUR\b|\bGBP\b))/giu;
  for (const match of text.matchAll(pattern)) {
    const code = currencyCode(match[1] ?? match[4] ?? '');
    const amount = normalizeAmount(match[2] ?? match[3] ?? '');
    if (code && amount) found.push({ currency: code, amount });
  }
  return found;
}

function commerceMoneyFacts(evidence: ConversationEvidence): MoneyFact[] {
  if (evidence.type !== 'COMMERCE_PRODUCT') return [];
  let parsed: unknown;
  try { parsed = JSON.parse(evidence.excerpt); } catch { return []; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const product = parsed as Record<string, unknown>;
  const facts: MoneyFact[] = [];
  const add = (price: unknown, currency: unknown) => {
    if (typeof price !== 'string' || typeof currency !== 'string') return;
    const code = currencyCode(currency);
    const amount = normalizeAmount(price);
    if (code && amount) facts.push({ currency: code, amount });
  };
  add(product.price, product.currency);
  add(product.compareAtPrice, product.currency);
  if (Array.isArray(product.variants)) for (const variant of product.variants) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) continue;
    const row = variant as Record<string, unknown>;
    add(row.price, row.currency);
    add(row.compareAtPrice, row.currency);
  }
  return facts;
}

function staleCommerceSnapshotDate(evidence: ConversationEvidence): string | null {
  if (evidence.type !== 'COMMERCE_PRODUCT') return null;
  try {
    const parsed = JSON.parse(evidence.excerpt) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || parsed.stale !== true) return null;
    return typeof parsed.syncedAt === 'string' ? parsed.syncedAt.slice(0, 10) : '';
  } catch { return null; }
}

function commerceAvailabilityValues(evidence: ConversationEvidence): string[] {
  if (evidence.type !== 'COMMERCE_PRODUCT') return [];
  try {
    const parsed = JSON.parse(evidence.excerpt) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return [];
    const values = [parsed.availability];
    if (Array.isArray(parsed.variants)) for (const variant of parsed.variants) {
      if (variant && typeof variant === 'object' && !Array.isArray(variant)) values.push((variant as Record<string, unknown>).availabilityStatus);
    }
    return values.filter((value): value is string => typeof value === 'string').map((value) => value.toLocaleUpperCase());
  } catch { return []; }
}

function commerceSkus(evidence: ConversationEvidence): string[] {
  if (evidence.type !== 'COMMERCE_PRODUCT') return [];
  try {
    const parsed = JSON.parse(evidence.excerpt) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return [];
    const values: unknown[] = [parsed.sku];
    if (Array.isArray(parsed.variants)) for (const variant of parsed.variants) {
      if (variant && typeof variant === 'object' && !Array.isArray(variant)) values.push((variant as Record<string, unknown>).sku);
    }
    return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch { return []; }
}

const citationReferences = (text: string) => [...text.matchAll(/\[((?:S|C)\d+)\]/gu)].map((match) => match[1]!);
export type GroundingSearchState = Readonly<{ availability: 'UNAVAILABLE' | 'NO_MATCH' | 'RESULTS'; retrievedRecordCompleteness: 'NOT_ESTABLISHED' | 'COMPLETE' | 'PARTIAL_OR_UNKNOWN'; authoritativeAbsenceVerified: false }>;
export function groundingSearchState(available: boolean, resultCount: number, allResultsComplete = false): GroundingSearchState {
  return { availability: !available ? 'UNAVAILABLE' : resultCount > 0 ? 'RESULTS' : 'NO_MATCH', retrievedRecordCompleteness: !available || resultCount === 0 ? 'NOT_ESTABLISHED' : allResultsComplete ? 'COMPLETE' : 'PARTIAL_OR_UNKNOWN', authoritativeAbsenceVerified: false };
}
// Compare dates as a whole. Splitting an ISO timestamp into numeric facts loses
// its day before `T` and can also accept a different date with the same numbers.
const isoDatePattern = /\b\d{4}-\d{2}-\d{2}(?=T|\b)/gu;
type NumericFact = Readonly<{ value: string; unit: string }>;
const numericFacts = (text: string): NumericFact[] => [...text.matchAll(/\b(\d+(?:[,.]\d+)*)(?:\s*(business\s+days?|days?|hours?|weeks?|months?|years?|दिन(?:ों)?|din|%|percent))?(?![\p{L}\p{N}])/giu)]
  .flatMap((match) => {
    const amount = normalizeAmount(match[1]!);
    if (!amount) return [];
    const rawUnit = (match[2] ?? '').toLocaleLowerCase().replace(/\s+/gu, ' ').replace(/s$/u, '');
    const unit = rawUnit === '%' ? 'percent' : /^(?:days?|दिन(?:ों)?|din)$/u.test(rawUnit) ? 'day' : rawUnit;
    return [{ value: amount, unit }];
  });
const URLs = (text: string) => [...text.matchAll(/https?:\/\/[^\s\])}>"']+/giu)].map((match) => match[0].replace(/[.,!?;:]+$/u, ''));
const emails = (text: string) => [...text.matchAll(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu)].map((match) => match[0]);
const labeledPhones = (text: string) => [...text.matchAll(/\b(?:phone|telephone|tel|call|contact(?:\s+us)?\s+at)\s*[:#]?\s*(\+?\d[\d\s().-]{5,}\d)/giu)].map((match) => match[1]!);
const labeledSkus = (text: string) => [...text.matchAll(/\bSKU\s*(?:is|:|#)?\s*([A-Z0-9][A-Z0-9._/-]{1,})/giu)].map((match) => match[1]!);

/** Deterministic checks only; this does not establish prose claim entailment. */
export function validateGroundedResponse(response: string, evidence: readonly ConversationEvidence[], onNumericCheck?: (check: { claimKind: 'date' | 'number'; matched: boolean; sourceCandidateCount: number; citedReferenceCount: number }) => void, options?: { relevantReferences?: readonly string[] }): ConversationVerification {
  const allowed = new Map(evidence.map((item) => [item.reference, item]));
  const references = citationReferences(response);
  const citedReferences = [...new Set(references.filter((reference) => allowed.has(reference)))];
  const invalidCitation = references.some((reference) => !allowed.has(reference));
  if (invalidCitation) return { accepted: false, citedReferences, reason: 'unknown_reference', unsupportedClaimCount: 0, verifiedFactCount: 0 };
  if (citedReferences.length === 0) return { accepted: false, citedReferences, reason: 'missing_reference', unsupportedClaimCount: 0, verifiedFactCount: 0 };
  const relevantReferences = options?.relevantReferences;
  if (relevantReferences && citedReferences.some((reference) => !relevantReferences.includes(reference))) {
    return { accepted: false, citedReferences, reason: 'unsupported_merchant_fact', unsupportedClaimCount: 1, verifiedFactCount: 0 };
  }

  const paragraphs = response.split(/\n+/u).flatMap((paragraph) => paragraph.split(/(?<=[.!?।])\s+(?=[\p{L}\p{N}])/u)).filter(Boolean);
  let unsupportedClaimCount = 0;
  let verifiedFactCount = 0;
  let reason: ConversationVerification['reason'] = 'valid_references';
  for (const paragraph of paragraphs) {
    const refs = citationReferences(paragraph).filter((reference) => allowed.has(reference));
    const cited = refs.flatMap((reference) => allowed.get(reference) ? [allowed.get(reference)!] : []);
    const textWithoutCitations = paragraph.replace(/\[(?:S|C)\d+\]/gu, '');
    const liveSnapshotClaim = /\b(?:live|real[- ]time|currently|right now|as of now)\b.{0,48}\b(?:price|cost|stock|inventory|availability)\b|\b(?:price|cost|stock|inventory|availability)\b.{0,48}\b(?:live|real[- ]time|currently|right now|as of now)\b/iu.test(textWithoutCitations);
    if (liveSnapshotClaim && cited.some((item) => item.type === 'COMMERCE_PRODUCT')) {
      unsupportedClaimCount++;
      reason = 'unsupported_structured_product_fact';
    }
    const sourceDates = new Set(cited.flatMap((item) => item.excerpt.match(isoDatePattern) ?? []));
    for (const date of textWithoutCitations.match(isoDatePattern) ?? []) {
      onNumericCheck?.({ claimKind: 'date', matched: sourceDates.has(date), sourceCandidateCount: sourceDates.size, citedReferenceCount: refs.length });
      if (sourceDates.has(date)) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_numeric_claim'; }
    }
    const sourceNumbers = cited.flatMap((item) => numericFacts(item.excerpt.replace(isoDatePattern, '')));
    let numericText = textWithoutCitations.replace(/https?:\/\/[^\s\])}>"']+/giu, '');
    numericText = numericText.replace(isoDatePattern, '');
    for (const phone of labeledPhones(textWithoutCitations)) numericText = numericText.replace(phone, '');
    for (const sku of labeledSkus(textWithoutCitations)) numericText = numericText.replace(sku, '');
    for (const claim of numericFacts(numericText)) {
      const exactMatch = sourceNumbers.some((fact) => fact.value === claim.value && fact.unit === claim.unit);
      onNumericCheck?.({ claimKind: 'number', matched: exactMatch, sourceCandidateCount: sourceNumbers.length, citedReferenceCount: refs.length });
      if (exactMatch) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_numeric_claim'; }
    }
    for (const url of URLs(textWithoutCitations)) {
      const supported = cited.some((item) => item.locator === url || item.excerpt.includes(url));
      if (supported) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_url'; }
    }
    for (const email of emails(textWithoutCitations)) {
      const supported = cited.some((item) => `${item.excerpt} ${item.locator ?? ''}`.toLocaleLowerCase().includes(email.toLocaleLowerCase()));
      if (supported) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_merchant_fact'; }
    }
    for (const phone of labeledPhones(textWithoutCitations)) {
      const digits = phone.replace(/\D/gu, '');
      const supported = digits.length >= 7 && digits.length <= 15 && cited.some((item) => item.excerpt.replace(/\D/gu, '').includes(digits));
      if (supported) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_merchant_fact'; }
    }
    for (const sku of labeledSkus(textWithoutCitations)) {
      const supported = cited.some((item) => commerceSkus(item).some((known) => known.toLocaleLowerCase() === sku.toLocaleLowerCase()));
      if (supported) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_structured_product_fact'; }
    }
    for (const money of textualMoneyFacts(textWithoutCitations)) {
      const supported = cited.some((item) => {
        const textFacts = textualMoneyFacts(`${item.excerpt} ${item.locator ?? ''}`);
        const matchingFact = [...textFacts, ...commerceMoneyFacts(item)].some((fact) => fact.currency === money.currency && fact.amount === money.amount);
        const staleDate = staleCommerceSnapshotDate(item);
        const freshnessDisclosed = /\b(?:snapshot|last\s+synced|synced\s+on|as\s+of)\b/iu.test(textWithoutCitations)
          && (staleDate === null || (staleDate.length > 0 && textWithoutCitations.includes(staleDate)));
        return matchingFact && (staleDate === null || freshnessDisclosed);
      });
      if (supported) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_structured_product_fact'; }
    }
    const stockClaims = [...textWithoutCitations.matchAll(/\b(in stock|out of stock|sold out|unavailable)\b/giu)].map((match) => match[1]!.toLocaleLowerCase());
    for (const claim of stockClaims) {
      const expected = claim === 'in stock' ? ['IN_STOCK'] : ['OUT_OF_STOCK', 'SOLD_OUT', 'UNAVAILABLE'];
      const supported = cited.some((item) => {
        const values = commerceAvailabilityValues(item);
        const syncedDate = staleCommerceSnapshotDate(item);
        const hasSnapshotTime = /\b(?:snapshot|last\s+synced|synced\s+on|as\s+of)\b/iu.test(textWithoutCitations)
          && (syncedDate === null || (syncedDate.length > 0 && textWithoutCitations.includes(syncedDate)));
        return values.some((value) => expected.includes(value)) && hasSnapshotTime;
      });
      if (supported) verifiedFactCount++;
      else { unsupportedClaimCount++; reason = 'unsupported_structured_product_fact'; }
    }
  }
  return { accepted: unsupportedClaimCount === 0, citedReferences, reason: unsupportedClaimCount === 0 ? 'valid_references' : reason, unsupportedClaimCount, verifiedFactCount };
}
