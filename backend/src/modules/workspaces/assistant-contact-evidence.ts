import { createHash } from 'node:crypto';
import type { ConversationAssistantRecord, ConversationEvidence } from './conversation.contracts';

export type AssistantContactConfiguration = Pick<ConversationAssistantRecord,
  'id' | 'organizationId' | 'name' | 'systemInstructions' | 'updatedAt'>;

const cleanLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
const helpContactsHeader = /^\s*(?:#{1,6}\s*)?HELP\s+CONTACTS\s*:?[ \t]*$/iu;

export function hasAssistantHelpContactsSection(instructions: string | null): boolean {
  return Boolean(instructions && instructions.length <= 10_000 && instructions.split(/\r?\n/u).some((line) => helpContactsHeader.test(line)));
}

/**
 * Contacts become evidence only when saved in the explicit HELP CONTACTS
 * section and each value passes a type-specific validation. Other free-form
 * behavior instructions remain instructions, never verified business facts.
 */
export function parseAssistantHelpContacts(instructions: string | null): { content: string; website?: string } | null {
  if (!instructions || instructions.length > 10_000) return null;
  const lines = instructions.split(/\r?\n/u);
  const isHeading = (line: string) => /^\s*#{1,6}\s+\S/u.test(line) || /^[A-Z][A-Z0-9 _/-]{2,64}:?\s*$/u.test(line.trim());
  const start = lines.findIndex((line) => helpContactsHeader.test(line));
  if (start < 0) return null;
  const values = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (isHeading(line)) break;
    const match = /^\s*(Website|Email|Phone|Listed location)\s*:\s*(.*?)\s*$/iu.exec(line);
    if (!match) continue;
    const label = match[1]!.toLocaleLowerCase();
    const value = cleanLine(match[2]!).slice(0, 500);
    if (!value || values.has(label)) continue;
    if (label === 'website') {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 500) continue;
        values.set(label, url.toString());
      } catch { continue; }
    } else if (label === 'email') {
      if (value.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value)) continue;
      values.set(label, value);
    } else if (label === 'phone') {
      const digits = value.replace(/\D/gu, '').length;
      if (value.length > 32 || !/^[+0-9(). -]+$/u.test(value) || digits < 7 || digits > 15) continue;
      values.set(label, value);
    } else if (value.length <= 160 && !/[<>]/u.test(value)) {
      values.set(label, value);
    }
  }
  if (!values.size) return null;
  const content = [
    'Merchant-configured customer support contact details.',
    ...(['website', 'email', 'phone', 'listed location'] as const).flatMap((label) => values.has(label) ? [`${label === 'listed location' ? 'Listed location' : label[0]!.toUpperCase() + label.slice(1)}: ${values.get(label)}`] : []),
  ].join('\n');
  return { content, ...(values.has('website') ? { website: values.get('website')! } : {}) };
}

function deterministicUuid(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildAssistantContactEvidence(assistant: AssistantContactConfiguration, reference = 'S1'): ConversationEvidence | null {
  const parsed = parseAssistantHelpContacts(assistant.systemInstructions);
  if (!parsed) return null;
  const contentHash = createHash('sha256').update(parsed.content).digest('hex');
  const sourceVersion = assistant.updatedAt instanceof Date ? assistant.updatedAt.getTime() : 0;
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) return null;
  return {
    reference,
    chunkId: deterministicUuid(`${assistant.id}:help-contacts:${contentHash}`),
    sourceId: assistant.id,
    sourceVersion,
    contentHash,
    title: `${assistant.name} support contact details`,
    type: 'ASSISTANT_CONFIGURATION',
    excerpt: parsed.content,
    locator: parsed.website ?? null,
    retrievalScore: 1,
    retrievalReason: 'assistant_configuration',
    dataCompleteness: 'COMPLETE',
    sourceAuthority: 'MERCHANT_KNOWLEDGE',
  };
}

