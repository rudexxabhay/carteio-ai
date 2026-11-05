import { getPlaygroundConversation, getPlaygroundDiagnosticTraces, type PlaygroundDiagnosticTrace, type PlaygroundTrace } from '../../services/api/assistants';

export type CopyableChatMessage = {
  id: string;
  clientTurnId?: string | null;
  role: 'user' | 'visitor' | 'assistant' | 'notice' | 'error';
  content: string;
  createdAt?: number | null;
  provenance?: string;
  sources?: readonly { reference: string; title: string; type: string }[];
  providerUsed?: string | null;
  modelUsed?: string | null;
  diagnostics?: PlaygroundTrace;
  requestId?: string;
  liveEvents?: PlaygroundTrace['events'];
};

export const PLAYGROUND_EXPORT_MAX_MESSAGES = 1000;
export const PLAYGROUND_EXPORT_MAX_BYTES = 2 * 1024 * 1024;
export const PLAYGROUND_DIAGNOSTIC_PAGE_LIMIT = 100;
export const PLAYGROUND_DIAGNOSTIC_MAX_RECORDS = 1000;

function exportSafeTrace(trace: PlaygroundTrace): PlaygroundTrace {
  // This module is used only by authenticated Playground manager export flows;
  // protected fields arrive redacted and bounded from the authorized trace API.
  return trace;
}

export async function loadCompletePlaygroundDiagnosticTraces(input: { workspaceSlug: string; assistantId: string; conversationId: string; signal: AbortSignal; firstPage?: Awaited<ReturnType<typeof getPlaygroundDiagnosticTraces>> }): Promise<{ traces: PlaygroundDiagnosticTrace[]; incomplete: boolean; captureEnabled: boolean }> {
  const traces: PlaygroundDiagnosticTrace[] = [];
  const seenIds = new Set<string>();
  let page = input.firstPage ?? await getPlaygroundDiagnosticTraces(input.workspaceSlug, input.assistantId, input.conversationId, input.signal, { offset: 0, limit: PLAYGROUND_DIAGNOSTIC_PAGE_LIMIT });
  if (page.sessionId !== input.conversationId || !Array.isArray(page.items)) throw new Error('The requested conversation traces could not be confirmed.');
  const captureEnabled = page.captureEnabled === true;
  let nextOffset = page.nextOffset;
  let hasMore = page.hasMore === true;
  const addPage = (items: PlaygroundDiagnosticTrace[]) => {
    for (const item of items) if (!seenIds.has(item.id) && traces.length < PLAYGROUND_DIAGNOSTIC_MAX_RECORDS) { seenIds.add(item.id); traces.push(item); }
  };
  addPage(page.items);
  while (hasMore && traces.length < PLAYGROUND_DIAGNOSTIC_MAX_RECORDS) {
    if (nextOffset === null || nextOffset === undefined || nextOffset <= page.offset) throw new Error('Diagnostic trace pagination did not advance safely.');
    page = await getPlaygroundDiagnosticTraces(input.workspaceSlug, input.assistantId, input.conversationId, input.signal, { offset: nextOffset, limit: PLAYGROUND_DIAGNOSTIC_PAGE_LIMIT });
    if (page.sessionId !== input.conversationId || !Array.isArray(page.items)) throw new Error('The requested conversation traces could not be confirmed.');
    addPage(page.items);
    hasMore = page.hasMore === true;
    if (page.nextOffset !== null && page.nextOffset !== undefined && page.nextOffset <= nextOffset && hasMore) throw new Error('Diagnostic trace pagination did not advance safely.');
    nextOffset = page.nextOffset;
    if (page.items.length === 0 && hasMore) throw new Error('Diagnostic trace pagination returned no progress.');
  }
  return { traces, incomplete: hasMore || traces.length >= PLAYGROUND_DIAGNOSTIC_MAX_RECORDS && page.hasMore === true, captureEnabled };
}

export async function loadCompletePlaygroundHistory(input: { workspaceSlug: string; assistantId: string; conversationId: string; signal: AbortSignal; localMessages?: readonly CopyableChatMessage[] }): Promise<{ messages: CopyableChatMessage[]; incomplete: boolean }> {
  const output: CopyableChatMessage[] = [];
  const localById = new Map((input.localMessages ?? []).map((message) => [message.id, message]));
  let offset = 0;
  let hasMore = true;
  while (hasMore && output.length < PLAYGROUND_EXPORT_MAX_MESSAGES) {
    const page = await getPlaygroundConversation(input.workspaceSlug, input.assistantId, input.conversationId, input.signal, { offset, limit: 100 });
    if (page.sessionId !== input.conversationId || !Array.isArray(page.messages)) throw new Error('The requested conversation history could not be confirmed.');
    output.push(...page.messages.map((item) => {
      const local = localById.get(item.id);
      return { id: item.id, clientTurnId: item.clientTurnId, role: item.responseType === 'knowledge_setup' ? 'notice' as const : item.role, content: item.content, sources: item.sources, provenance: item.provenance, providerUsed: item.providerUsed, modelUsed: item.modelUsed, diagnostics: local?.diagnostics, requestId: local?.requestId, liveEvents: local?.liveEvents, createdAt: new Date(item.createdAt).getTime() };
    }));
    hasMore = page.hasMore === true;
    if (hasMore && (page.nextOffset === null || page.nextOffset === undefined || page.nextOffset <= offset)) throw new Error('Conversation history pagination did not advance safely.');
    offset = page.nextOffset ?? offset + page.messages.length;
    if (page.messages.length === 0 && hasMore) throw new Error('Conversation history pagination returned no progress.');
  }
  return { messages: output.slice(0, PLAYGROUND_EXPORT_MAX_MESSAGES), incomplete: hasMore || output.length > PLAYGROUND_EXPORT_MAX_MESSAGES };
}

function timestamp(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function origin(value?: string, sources?: CopyableChatMessage['sources']): string | null {
  if (value === 'AI_GENERATED') return 'AI generated';
  if (value === 'KNOWLEDGE_GROUNDED') return sources?.some((source) => source.type === 'COMMERCE_PRODUCT') ? 'AI generated · Shopify data' : 'AI generated · Knowledge Base';
  if (value === 'SYSTEM_RESPONSE') return 'System response';
  return null;
}

export function formatPlaygroundMessage(message: Pick<CopyableChatMessage, 'content'>): string {
  return message.content;
}

export function formatPlaygroundHistory(input: {
  assistantName: string;
  conversationId: string | null;
  messages: readonly CopyableChatMessage[];
  exportedAt?: Date;
  incomplete?: boolean;
  maxBytes?: number;
  maxMessages?: number;
}): string {
  const maxBytes = input.maxBytes ?? PLAYGROUND_EXPORT_MAX_BYTES;
  const maxMessages = input.maxMessages ?? PLAYGROUND_EXPORT_MAX_MESSAGES;
  const exportedAt = input.exportedAt ?? new Date();
  const header = [
    'CARTEIO AI — PLAYGROUND CHAT HISTORY',
    `Assistant: ${input.assistantName}`,
    `Conversation: ${input.conversationId ?? 'unsaved conversation'}`,
    `Exported: ${exportedAt.toISOString()}`,
    '',
  ].join('\n');
  const blocks: string[] = [];
  let bytes = new TextEncoder().encode(header).byteLength;
  let truncated = input.incomplete === true || input.messages.length > maxMessages;
  for (const message of input.messages.slice(0, maxMessages)) {
    const role = message.role === 'user' || message.role === 'visitor' ? 'USER' : message.role === 'assistant' ? 'CARTEIO AI' : message.role === 'error' ? 'ERROR' : 'SYSTEM';
    const time = timestamp(message.createdAt);
    const responseOrigin = origin(message.provenance, message.sources);
    const block = `${blocks.length ? '\n\n' : ''}${time ? `[${time}] ` : ''}${role}\n${message.content}${responseOrigin ? `\nResponse origin: ${responseOrigin}` : ''}${message.sources?.length ? `\nSources: ${message.sources.map((source) => `[${source.reference}] ${source.title} (${source.type})`).join('; ')}` : ''}`;
    const size = new TextEncoder().encode(block).byteLength;
    if (bytes + size > maxBytes - 160) { truncated = true; break; }
    blocks.push(block);
    bytes += size;
  }
  const body = `${header}${blocks.join('')}`;
  return truncated ? `${body}\n\nEXPORT INCOMPLETE: The safe export limit was reached; some messages may be omitted.` : body;
}

export function formatPlaygroundDiagnostics(messages: readonly CopyableChatMessage[], maxBytes = 1024 * 1024): string {
  const traced = messages.flatMap((message) => message.diagnostics || message.liveEvents?.length ? [{ message, trace: message.diagnostics, events: message.diagnostics?.events ?? message.liveEvents ?? [] }] : []);
  const sections = traced.map(({ message, trace, events }) => {
    const lines = [`Message: ${message.id}`, `Trace: ${trace?.traceId ?? events.find((event) => event.traceId)?.traceId ?? message.requestId ?? 'unavailable'}`];
    if (trace) lines.push(`Duration: ${trace.totalLatencyMs} ms`, `Final source: ${trace.finalSource}`, `Knowledge retrieval: ${trace.retrieval.attempted ? 'attempted' : 'not attempted'} · ${trace.retrieval.resultCount} result(s) · ${trace.retrieval.eligibleSourceCount} eligible source(s)`);
    else lines.push('Source: live backend events; final trace not available.');
    if (message.providerUsed && message.modelUsed) lines.push(`Provider/model: ${message.providerUsed} · ${message.modelUsed}`);
    if (trace?.developmentCapture && Date.parse(trace.developmentCapture.expiresAt) > Date.now()) {
      lines.push('Development capture: metadata only; no raw payloads or drafts.');
      for (const check of trace.developmentCapture.checks.slice(0, 16)) lines.push(`- ${check.stage}: ${JSON.stringify(check.metadata)}`);
    }
    lines.push('Stages:');
    for (const event of events) {
      const metadata = [event.durationMs !== undefined ? `${event.durationMs} ms` : null, event.reason, event.errorCategory, event.provider && event.model ? `${event.provider} · ${event.model}` : null].filter(Boolean).join(' · ');
      lines.push(`- ${event.operation}: ${event.status}${metadata ? ` · ${metadata}` : ''}`);
    }
    lines.push('Tools:');
    for (const tool of trace?.tools ?? []) lines.push(`- ${tool.tool}: ${tool.outcome}${tool.resultCount !== undefined ? ` · ${tool.resultCount} result(s)` : ''}${tool.reason ? ` · ${tool.reason}` : ''}`);
    return lines.join('\n');
  });
  const output = sections.join('\n\n');
  const encoded = new TextEncoder().encode(output);
  if (encoded.byteLength <= maxBytes) return output;
  const suffix = '\n\nDIAGNOSTICS INCOMPLETE: The diagnostic export size limit was reached.';
  const prefix = new TextDecoder().decode(encoded.slice(0, Math.max(0, maxBytes - new TextEncoder().encode(suffix).byteLength)));
  return `${prefix}${suffix}`;
}

/** Structured, explicitly bounded export. Attempts remain independent of turns so failed retries are never overwritten. */
export function buildPlaygroundDebugReport(input: {
  assistantName: string;
  conversationId: string | null;
  messages: readonly CopyableChatMessage[];
  attempts?: readonly PlaygroundDiagnosticTrace[];
  liveAttempts?: readonly { requestId: string; clientTurnId: string | null; status: string; startedAt: string; events: PlaygroundTrace['events'] }[];
  incomplete?: boolean;
  maxBytes?: number;
}): { report: Record<string, unknown>; json: string; incomplete: boolean } {
  const maxBytes = input.maxBytes ?? PLAYGROUND_EXPORT_MAX_BYTES;
  const turns = input.messages.filter((message) => message.role === 'user' || message.role === 'visitor' || message.role === 'assistant' || message.role === 'error');
  const items = turns.map((message) => ({
    messageId: message.id,
    clientTurnId: message.clientTurnId ?? null,
    role: message.role === 'visitor' ? 'user' : message.role,
    timestamp: typeof message.createdAt === 'number' ? new Date(message.createdAt).toISOString() : null,
    requestId: message.requestId ?? null,
    traceId: message.diagnostics?.traceId ?? message.liveEvents?.find((event) => event.traceId)?.traceId ?? null,
    content: message.content,
    answer: message.role === 'assistant' ? { provenance: message.provenance ?? 'NOT_CAPTURED', sourceCount: message.sources?.length ?? 0 } : 'NOT_APPLICABLE',
    diagnosticStatus: message.diagnostics ? 'RECORDED' : message.liveEvents?.length ? 'LIVE_EVENTS_ONLY' : 'NOT_CAPTURED',
  }));
  const attempts = [...(input.attempts ?? [])].map((item) => ({
    recordId: item.id,
    requestId: item.requestId,
    clientTurnId: item.clientTurnId,
    attempt: item.attempt,
    outcome: item.outcome,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt ?? null,
    trace: exportSafeTrace(item.payload),
  }));
  const liveAttempts = [...(input.liveAttempts ?? [])].map((item) => ({ ...item }));
  const failed = attempts.filter((item) => item.outcome !== 'COMPLETED');
  const categories = new Map<string, number>();
  for (const item of attempts) for (const event of item.trace.events) if (event.errorCategory) categories.set(event.errorCategory, (categories.get(event.errorCategory) ?? 0) + 1);
  const report: Record<string, unknown> = {
    reportVersion: 'playground-execution-debug-v2',
    executionIdentity: { conversationId: input.conversationId, assistantName: input.assistantName, exportedAt: new Date().toISOString() },
    conversationSummary: { totalTurns: turns.filter((message) => message.role === 'visitor' || message.role === 'user').length, successfulResponses: turns.filter((message) => message.role === 'assistant').length, failedRequests: failed.length, errorCategories: Object.fromEntries(categories), recurringFailurePatterns: [...categories.keys()] },
    completeness: { status: input.incomplete ? 'INCOMPLETE_PAGE_LIMIT' : 'COMPLETE', configuredByteLimit: maxBytes, omittedTurns: 0, omittedAttempts: 0, omittedLiveAttempts: 0 },
    turns: [] as typeof items,
    attempts: [] as typeof attempts,
    liveAttempts: [] as typeof liveAttempts,
  };

  const encoder = new TextEncoder();
  const used = encoder.encode(JSON.stringify(report)).byteLength;
  const candidates: Array<{ kind: 'turns' | 'attempts' | 'liveAttempts'; value: (typeof items)[number] | (typeof attempts)[number] | (typeof liveAttempts)[number]; at: number; bytes: number }> = [
    ...items.map((value) => ({ kind: 'turns' as const, value, at: value.timestamp ? Date.parse(value.timestamp) : 0, bytes: encoder.encode(JSON.stringify(value)).byteLength + 1 })),
    ...attempts.map((value) => ({ kind: 'attempts' as const, value, at: Date.parse(value.createdAt), bytes: encoder.encode(JSON.stringify(value)).byteLength + 1 })),
    ...liveAttempts.map((value) => ({ kind: 'liveAttempts' as const, value, at: Date.parse(value.startedAt), bytes: encoder.encode(JSON.stringify(value)).byteLength + 1 })),
  ].sort((left, right) => right.at - left.at);
  let remainingBytes = Math.max(0, maxBytes - used);
  for (const item of candidates) {
    if (item.bytes <= remainingBytes) {
      (report[item.kind] as unknown[]).push(item.value);
      remainingBytes -= item.bytes;
    } else {
      const completeness = report.completeness as Record<string, unknown>;
      completeness.status = 'INCOMPLETE_BYTE_LIMIT';
      const key = item.kind === 'turns' ? 'omittedTurns' : item.kind === 'attempts' ? 'omittedAttempts' : 'omittedLiveAttempts';
      completeness[key] = Number(completeness[key]) + 1;
    }
  }
  for (const key of ['turns', 'attempts', 'liveAttempts']) (report[key] as Array<{ timestamp?: string; createdAt?: string; startedAt?: string }>).sort((left, right) => Date.parse(left.timestamp ?? left.createdAt ?? left.startedAt ?? '') - Date.parse(right.timestamp ?? right.createdAt ?? right.startedAt ?? ''));
  const incomplete = input.incomplete === true || (report.completeness as Record<string, unknown>).status !== 'COMPLETE';
  const json = JSON.stringify(report, null, 2);
  return { report, json, incomplete };
}
