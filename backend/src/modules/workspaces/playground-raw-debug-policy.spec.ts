import { playgroundDevelopmentCaptureEnabled, playgroundRawDebugEnabled, redactProtectedDebugText } from './playground-diagnostics';

describe('PLAYGROUND_RAW_DEBUG_ENABLED environment policy', () => {
  const original = {
    appEnv: process.env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
    diagnostics: process.env.PLAYGROUND_DIAGNOSTICS_ENABLED,
    raw: process.env.PLAYGROUND_RAW_DEBUG_ENABLED,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries({
      APP_ENV: original.appEnv,
      NODE_ENV: original.nodeEnv,
      PLAYGROUND_DIAGNOSTICS_ENABLED: original.diagnostics,
      PLAYGROUND_RAW_DEBUG_ENABLED: original.raw,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('allows explicit local development raw capture', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'local';
    process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    expect(playgroundRawDebugEnabled()).toBe(true);
  });

  it('allows explicitly enabled UAT diagnostics with raw capture', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'uat';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true';
    process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    expect(playgroundRawDebugEnabled()).toBe(true);
    expect(playgroundDevelopmentCaptureEnabled(true)).toBe(true);
  });

  it('rejects UAT raw capture without diagnostics and rejects public production', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'uat';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'false';
    process.env.PLAYGROUND_RAW_DEBUG_ENABLED = 'true';
    expect(playgroundRawDebugEnabled()).toBe(false);
    process.env.APP_ENV = 'production';
    process.env.PLAYGROUND_DIAGNOSTICS_ENABLED = 'true';
    expect(playgroundRawDebugEnabled()).toBe(false);
  });

  it('redacts credentials and authorization values while retaining interpretation JSON', () => {
    const raw = '{"intent":"PRODUCT_SEARCH","apiKey":"sk-abcdefghijklmnopqrstuvwxyz","authorization":"Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature"}';
    const redacted = redactProtectedDebugText(raw);
    expect(redacted).toContain('"intent":"PRODUCT_SEARCH"');
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });
});
