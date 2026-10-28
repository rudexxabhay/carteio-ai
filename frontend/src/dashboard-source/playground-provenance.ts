import type { PlaygroundChatReply } from '../services/api/assistants';

export function playgroundSourceLabel(message: Pick<PlaygroundChatReply, 'provenance'> & Partial<Pick<PlaygroundChatReply, 'sources'>>): string {
  if (message.provenance === 'SYSTEM_RESPONSE') return 'System response';
  const sources = message.sources || [];
  const knowledge = sources.some((source) => source.type !== 'COMMERCE_PRODUCT');
  const shopify = sources.some((source) => source.type === 'COMMERCE_PRODUCT');
  if (knowledge && shopify) return 'AI generated · Knowledge Base + Shopify data';
  if (knowledge) return 'AI generated · Knowledge Base';
  if (shopify) return 'AI generated · Shopify data';
  if (message.provenance === 'AI_GENERATED') return 'AI generated';
  return 'Source unavailable';
}
