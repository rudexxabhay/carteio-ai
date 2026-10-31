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
    expect(recorder.snapshot({}).protectedResponseDebug?.records).toHaveLength(24);
    expect(recorder.snapshot({}).protectedResponseDebug?.records[0]).toMatchObject({ truncated: true, text: 'x'.repeat(16000) });
    jest.advanceTimersByTime(5 * 60_000);
    expect(recorder.snapshot({}).protectedResponseDebug).toBeUndefined();
  });
  it('refuses raw capture in production even with consent and flag', () => {
    process.env.NODE_ENV = 'production'; process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    recorder.captureProtectedResponse('PROVIDER_CONTENT', 'initial', 'private');
    expect(recorder.snapshot({}).protectedResponseDebug).toBeUndefined();
  });
});
