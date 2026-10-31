/** Authority describes origin, never factual entailment. Customer text is not business evidence. */
export type FactProvenance = 'CUSTOMER_REPORTED' | 'AUTHORIZED_KNOWLEDGE' | 'AUTHORIZED_COMMERCE' | 'AUTHORIZED_LIVE_TOOL' | 'CONVERSATION_REFERENCE' | 'UNVERIFIED_GENERATED';

const normalized = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

// Only grammatical person and numeral-script transformations are deterministic.
// No synonym, tense, condition, polarity or quantity changes are authorized here.
const reportedForm = (text: string) => normalizeNumericScript(normalized(text))
  .replace(/\bI\s+am\b/giu, 'you are').replace(/\bI\s+was\b/giu, 'you were')
  .replace(/\bI\b/gu, 'you').replace(/\bmy\b/giu, 'your')
  .replace(/[.!।]$/u, '').toLocaleLowerCase();

export function normalizeNumericScript(text: string): string {
  return text.normalize('NFKC').replace(/[०-९٠-٩۰-۹]/gu, (digit) => {
    const code = digit.codePointAt(0)!;
    return String(code - (code >= 0x0966 ? 0x0966 : code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** Conservative attribution boundary: a complete, explicitly attributed verbatim
 * quotation of an authorized user turn. Paraphrases and mixed conclusions fail
 * closed. Assistant history must never be supplied as customer statements.
 */
export function isCustomerReportedQuotation(sentence: string, customerStatements: readonly string[]): boolean {
  const match = sentence.trim().match(/^(?:You (?:said|mentioned|reported)|According to you|आपने (?:कहा|बताया)|आपके अनुसार|Aapne (?:kaha|bataya)|Aapke (?:mutabik|anusaar))\s*:?\s*(?:“([^”]+)”|"([^"]+)"|«([^»]+)»)\s*[.!।]?$/iu);
  const quoted = match?.[1] ?? match?.[2] ?? match?.[3];
  // Quoted links/citation markers must not gain authority from customer text.
  if (!quoted || /https?:\/\/|\[(?:S|C)\d+\]/iu.test(quoted)) return false;
  return customerStatements.some((statement) => normalized(statement) === normalized(quoted)
    || reportedForm(statement) === reportedForm(quoted));
}
