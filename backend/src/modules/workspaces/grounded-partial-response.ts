import type { ConversationEvidence } from './conversation.contracts';
import { validateGroundedResponse } from './grounded-response-validation';

const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** Preserve only independently cited, complete evidence excerpts already present
 * in a rejected draft. Never truncate a policy condition or synthesize a claim.
 * Caller must revalidate authorization and reject unresolved conflicts first.
 */
export function supportedPartialResponse(draft: string, evidence: readonly ConversationEvidence[], relevantReferences: readonly string[]): string | null {
  const retained = draft.split(/\n+/u).filter((line) => {
    const refs = [...line.matchAll(/\[((?:S|C)\d+)\]/gu)].map((match) => match[1]!);
    if (refs.length !== 1 || !relevantReferences.includes(refs[0]!)) return false;
    const source = evidence.find((item) => item.reference === refs[0]);
    if (!source || source.type === 'COMMERCE_PRODUCT' || source.type === 'ASSISTANT_CONFIGURATION') return false;
    const claim = line.replace(/\[(?:S|C)\d+\]/gu, '').trim();
    if (!claim || normalize(claim) !== normalize(source.excerpt)) return false;
    return validateGroundedResponse(line, [source], undefined, { relevantReferences }).accepted;
  });
  if (!retained.length) return null;
  const partial = retained.join('\n');
  return validateGroundedResponse(partial, evidence, undefined, { relevantReferences }).accepted ? partial : null;
}
