import type { PlaygroundTurn } from './conversation-intent';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Metadata only: never pass user text, prompts, excerpts, or credentials here. */
export function historyDiagnostic(loadedCount: number, includedCount: number, contextBytes: number, contentTruncated = false) {
  return {
    loadedMessageCount: Math.max(0, Math.floor(loadedCount)),
    includedMessageCount: Math.max(0, Math.floor(includedCount)),
    contextBytes: Math.max(0, Math.floor(contextBytes)),
    contentTruncated,
    truncated: includedCount < loadedCount || contentTruncated,
  };
}

export type BoundedHistorySelection = Readonly<{
  turns: readonly PlaygroundTurn[];
  loadedMessageCount: number;
  includedMessageCount: number;
  contextBytes: number;
  droppedMessageCount: number;
  contentTruncationCount: number;
  truncationReasons: readonly ('MESSAGE_LIMIT' | 'BYTE_LIMIT' | 'CONTENT_TRUNCATED')[];
}>;

export type ConversationMemoryDiagnostic = Omit<BoundedHistorySelection, 'turns'> & {
  order: 'chronological';
  windowAtCapacity: boolean;
};

/** Inspect only server-built context envelopes before the current message. Never return text. */
export function providerHistoryDiagnostic(messages: readonly { role: string; content: string }[]) {
  for (const message of messages.slice(0, -1)) {
    if (message.role !== 'user') continue;
    try {
      const value = JSON.parse(message.content);
      if (value?.type !== 'untrusted_conversation_context' || !Array.isArray(value.priorTurns)) continue;
      const roles = value.priorTurns.filter((turn: any) => turn && ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string').slice(0, 12).map((turn: any) => turn.role as 'user' | 'assistant');
      return { historyMessageCount: roles.length, historyRoles: roles };
    } catch { /* Raw customer text is not a history envelope. */ }
  }
  return { historyMessageCount: 0, historyRoles: [] as Array<'user' | 'assistant'> };
}

const serializedBytes = (turn: PlaygroundTurn) => Buffer.byteLength(JSON.stringify(turn), 'utf8');

function truncateTurn(turn: PlaygroundTurn, maxBytes: number): PlaygroundTurn | null {
  if (maxBytes <= 0) return null;
  if (serializedBytes(turn) <= maxBytes) return turn;
  const marker = turn.role === 'user' ? '…[earlier message omitted]' : '[earlier reply omitted]…';
  const base = { ...turn, content: marker };
  if (serializedBytes(base) > maxBytes) return null;
  const chars = Array.from(turn.content);
  const fit = (length: number): PlaygroundTurn => ({
    ...turn,
    content: turn.role === 'user' ? `${marker}${chars.slice(chars.length - length).join('')}` : `${chars.slice(0, length).join('')}${marker}`,
  });
  // Budget the serialized text, including JSON escapes, rather than raw UTF-8.
  let low = 0, high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (serializedBytes(fit(middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return fit(low);
}

/** Select newest whole user/assistant turns, then return them in chronological order. */
export function selectBoundedHistory(turns: readonly PlaygroundTurn[], maxMessages: number, maxBytes: number): BoundedHistorySelection {
  const groups: PlaygroundTurn[][] = [];
  let pendingUser: PlaygroundTurn | null = null;
  for (const turn of turns) {
    if (turn.role === 'user') {
      if (pendingUser) groups.push([pendingUser]);
      pendingUser = turn;
    } else if (pendingUser) {
      groups.push([pendingUser, turn]);
      pendingUser = null;
    } else groups.push([turn]);
  }
  if (pendingUser) groups.push([pendingUser]);

  const selected: PlaygroundTurn[][] = [];
  let included = 0;
  let bytes = 0;
  let contentTruncationCount = 0;
  const truncationReasons = new Set<'MESSAGE_LIMIT' | 'BYTE_LIMIT' | 'CONTENT_TRUNCATED'>();
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]!;
    const slots = maxMessages - included;
    const budget = maxBytes - bytes;
    if (slots <= 0) { truncationReasons.add('MESSAGE_LIMIT'); break; }
    if (budget <= 0) { truncationReasons.add('BYTE_LIMIT'); break; }
    const groupBytes = group.reduce((sum, turn) => sum + serializedBytes(turn), 0);
    if (group.length <= slots && groupBytes <= budget) {
      selected.unshift(group);
      included += group.length;
      bytes += groupBytes;
      continue;
    }
    if (group.length > slots) truncationReasons.add('MESSAGE_LIMIT');
    if (groupBytes > budget) truncationReasons.add('BYTE_LIMIT');
    if (group.length > slots && selected.length > 0) break;

    // Do not skip a newer turn to include older context. Preserve its customer
    // message first when the group cannot fit as a whole.
    const prioritized = group.length > slots
      ? [group.find((turn) => turn.role === 'user') ?? group.at(-1)!]
      : [...group];
    const fitted: PlaygroundTurn[] = [];
    let remaining = budget;
    for (const turn of prioritized) {
      const bounded = truncateTurn(turn, remaining);
      if (!bounded) continue;
      fitted.push(bounded);
      const used = serializedBytes(bounded);
      remaining -= used;
      if (bounded.content !== turn.content) { contentTruncationCount++; truncationReasons.add('CONTENT_TRUNCATED'); }
    }
    if (fitted.length) {
      selected.unshift(fitted);
      included += fitted.length;
      bytes += fitted.reduce((sum, turn) => sum + serializedBytes(turn), 0);
    }
    break;
  }
  const resultTurns = selected.flat();
  return {
    turns: resultTurns,
    loadedMessageCount: turns.length,
    includedMessageCount: resultTurns.length,
    contextBytes: bytes,
    droppedMessageCount: Math.max(0, turns.length - resultTurns.length),
    contentTruncationCount,
    truncationReasons: [...truncationReasons],
  };
}

/** Bound and validate identifiers before putting retrieval metadata in logs. */
export function safeDiagnosticSourceIds(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && UUID.test(value)).slice(0, 5);
}
