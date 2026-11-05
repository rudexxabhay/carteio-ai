import { PlaygroundTraceRecorder } from './playground-diagnostics';

describe('protected response capture', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; jest.useRealTimers(); });
  it('is off by default and requires both development and per-request consent', () => {
    delete process.env.PLAYGROUND_RAW_DEBUG_ENABLED;
    process.env.NODE_ENV = 'development';
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    recorder.captureProtectedResponse('PROVIDER_CONTENT', 'initial', 'private answer');
    expect(recorder.snapshot({}).protectedResponseDebug).toBeUndefined();
    process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const noConsent = new PlaygroundTraceRecorder('other');
    noConsent.captureProtectedResponse('PROVIDER_CONTENT', 'initial', 'private answer');
    expect(noConsent.snapshot({}).protectedResponseDebug).toBeUndefined();
  });
  it('separates drafts without putting them on the event stream', () => {
    process.env.NODE_ENV = 'development'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const emit = jest.fn();
    const recorder = new PlaygroundTraceRecorder('trace', emit, true);
    recorder.captureProtectedResponse('PROVIDER_CONTENT', 'initial', 'original');
    recorder.captureProtectedResponse('PROVIDER_CONTENT', 'recovery', 'repaired');
    const snapshot = recorder.snapshot({ messageId: 'message' });
    expect(snapshot.protectedResponseDebug?.records.map((record) => [record.attemptId, record.text])).toEqual([['initial', 'original'], ['recovery', 'repaired']]);
    expect(JSON.stringify(snapshot.events)).not.toContain('original');
    expect(JSON.stringify(emit.mock.calls)).not.toContain('repaired');
  });
  it('bounds capture size and expires response access', () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'development'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    for (let i = 0; i < 30; i++) recorder.captureProtectedResponse('VALIDATOR_INPUT', 'initial', 'x'.repeat(20000));
    expect(recorder.snapshot({}).protectedResponseDebug?.records).toHaveLength(12);
    expect(recorder.snapshot({}).protectedResponseDebug?.records[0]).toMatchObject({ truncated: true, text: 'x'.repeat(8000) });
    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(recorder.snapshot({}).protectedResponseDebug).toBeUndefined();
  });
  it('refuses raw capture in production even with consent and flag', () => {
    process.env.NODE_ENV = 'production'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    recorder.captureProtectedResponse('PROVIDER_CONTENT', 'initial', 'private');
    expect(recorder.snapshot({}).protectedResponseDebug).toBeUndefined();
  });

  it('stores the sanitized original response, parsed validation and repair chain per provider call', () => {
    process.env.NODE_ENV = 'production'; process.env.APP_ENV = 'uat'; process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const recorder = new PlaygroundTraceRecorder('trace-id', undefined, true);
    recorder.captureProtectedModelOutput({ requestId: 'request-id', callIndex: 1, purpose: 'intent_interpretation', provider: 'openrouter', model: 'vendor/model', stage: 'query_interpretation', requestDispatched: true, requestMessages: [{ role: 'system', content: 'hidden prompt' }, { role: 'user', content: 'hello test@example.com' }], content: '{"answerAspects":[{"questionSpan":"wrong phone 555 123 4567"}],"customerEmail":"private@example.com"}', finishReason: 'stop', responseStatus: 200, durationMs: 12, outcome: 'RECEIVED' });
    recorder.updateProtectedModelValidation(1, { parsing: { parsed: true, parsedJson: { answerAspects: [{ questionSpan: 'wrong' }] } }, validation: { accepted: false, code: 'invalid_answer_aspect', issues: [{ path: '$.answerAspects[0].questionSpan', expected: 'exact substring' }] }, backendDecision: { status: 'REPAIR_REQUIRED' }, repair: { attempted: true, repairCallIndex: 2 } });
    recorder.captureProtectedModelOutput({ requestId: 'request-id', callIndex: 2, purpose: 'intent_interpretation', provider: 'openrouter', model: 'vendor/model', stage: 'query_interpretation', requestDispatched: true, requestMessages: [{ role: 'user', content: 'repair' }], content: '{"intent":"business"}', finishReason: 'stop', durationMs: 9, outcome: 'RECEIVED' });
    const calls = recorder.snapshot({}).protectedResponseDebug?.modelCalls;
    expect(calls).toHaveLength(2);
    expect(calls?.[0]).toMatchObject({ requestId: 'request-id', providerCallIndex: 1, response: { content: expect.stringContaining('[REDACTED_PHONE]') }, validation: { accepted: false, issues: [{ path: '$.answerAspects[0].questionSpan' }] }, repair: { attempted: true, repairCallIndex: 2 } });
    expect(JSON.stringify(calls)).not.toContain('hidden prompt');
    expect(JSON.stringify(calls)).not.toContain('test@example.com');
    expect(JSON.stringify(calls)).not.toContain('private@example.com');
  });

  it('marks bounded outputs and missing response content explicitly', () => {
    process.env.NODE_ENV = 'development'; process.env.APP_ENV = 'local'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    recorder.captureProtectedModelOutput({ requestId: 'r', callIndex: 1, purpose: 'answer_generation', provider: 'openrouter', model: 'vendor/model', stage: 'grounded_answer', requestDispatched: true, requestMessages: [], content: 'x'.repeat(9000), finishReason: 'length', durationMs: 1, outcome: 'RECEIVED' });
    recorder.captureProtectedModelOutput({ requestId: 'r', callIndex: 2, purpose: 'answer_generation', provider: 'openrouter', model: 'vendor/model', stage: 'grounded_answer', requestDispatched: true, requestMessages: [], content: null, finishReason: null, durationMs: 1, outcome: 'REQUEST_FAILED_BEFORE_CONTENT' });
    expect(recorder.snapshot({}).protectedResponseDebug?.modelCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerCallIndex: 1, response: expect.objectContaining({ truncated: true, responseLength: 9000 }) }),
      expect.objectContaining({ providerCallIndex: 2, response: expect.objectContaining({ status: 'NO_RESPONSE_CONTENT' }), outcome: 'REQUEST_FAILED_BEFORE_CONTENT' }),
    ]));
  });

  it('bounds validation metadata and labels omitted updates instead of exceeding the capture budget', () => {
    process.env.NODE_ENV = 'development'; process.env.APP_ENV = 'local'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    recorder.captureProtectedModelOutput({ requestId: 'r', callIndex: 1, purpose: 'intent_interpretation', provider: 'openrouter', model: 'vendor/model', stage: 'query_interpretation', requestDispatched: true, requestMessages: [], content: '{}', finishReason: 'stop', durationMs: 1, outcome: 'RECEIVED' });
    recorder.updateProtectedModelValidation(1, { validation: { accepted: false, issues: [{ path: '$.field', value: 'x'.repeat(50_000) }] } });
    const call = recorder.snapshot({}).protectedResponseDebug?.modelCalls?.[0];
    expect(JSON.stringify(call)).not.toContain('x'.repeat(5000));
    expect(JSON.stringify(call)).toContain('truncated');
  });

  it('streams protected model output only through the authorized Playground trace callback', () => {
    process.env.NODE_ENV = 'development'; process.env.APP_ENV = 'local'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const emit = jest.fn();
    const recorder = new PlaygroundTraceRecorder('trace-live', emit, true, 'PLAYGROUND');
    recorder.captureProtectedModelOutput({ requestId: 'request-live', callIndex: 1, purpose: 'intent_interpretation', provider: 'openrouter', model: 'vendor/model', stage: 'query_interpretation', requestDispatched: true, requestMessages: [], content: '{"ok":false}', finishReason: 'stop', durationMs: 3, outcome: 'RECEIVED' });
    recorder.updateProtectedModelValidation(1, { validation: { accepted: false, code: 'invalid_answer_aspects' } });
    expect(emit.mock.calls.map(([event]) => event.operation)).toEqual(['PROTECTED_MODEL_OUTPUT', 'PROTECTED_MODEL_VALIDATION']);
    expect((emit.mock.calls[0]?.[0] as any).output.modelCall.response.content).toBe('{"ok":false}');
    const widgetEmit = jest.fn();
    new PlaygroundTraceRecorder('trace-widget', widgetEmit, true, 'PUBLIC_WIDGET').captureProtectedModelOutput({ requestId: 'request-widget', callIndex: 1, purpose: 'answer_generation', provider: 'openrouter', model: 'vendor/model', stage: 'grounded_answer', requestDispatched: true, requestMessages: [], content: 'private', finishReason: 'stop', durationMs: 1, outcome: 'RECEIVED' });
    expect(widgetEmit).not.toHaveBeenCalled();
  });
});
