import { validateEnvironment } from '../src/config/env.validation';

describe('environment configuration', () => {
  const productionDatabase = {
    DATABASE_URL: 'postgresql://test:test@pooled.example/test?sslmode=require',
    DIRECT_URL: 'postgresql://test:test@direct.example/test?sslmode=require',
  };
  const productionMail = { PUBLIC_APP_URL: 'https://ai.carteio.in', RESEND_API_KEY: 'test-provider-key', AUTH_EMAIL_FROM: 'Carteio AI <no-reply@mail.carteio.in>', AUTH_OTP_HASH_SECRET: 'test-only-production-secret-32-bytes' };
  it('accepts the local defaults', () => {
    expect(validateEnvironment({}).PORT).toBe(5000);
    expect(validateEnvironment({}).HOST).toBe('127.0.0.1');
    expect(validateEnvironment({})).toMatchObject({ AUTH_OTP_EXPIRES_MINUTES: 5, AUTH_OTP_MAX_ATTEMPTS: 5, AUTH_OTP_RESEND_COOLDOWN_SECONDS: 60, PLAYGROUND_USER_REQUESTS_PER_MINUTE: 30, PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE: 120 });
  });

  it('keeps OpenRouter optional unless selected and pins its configurable API base to the official origin', () => {
    expect(validateEnvironment({}).OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(validateEnvironment({ OPENROUTER_API_KEY: 'router-key-not-returned' })).not.toHaveProperty('OPENROUTER_API_KEY');
    expect(() => validateEnvironment({ OPENROUTER_BASE_URL: 'https://attacker.example/api/v1' })).toThrow(/OPENROUTER_BASE_URL/);
    expect(validateEnvironment({ OPENROUTER_MODEL: 'vendor/model-x' }).OPENROUTER_MODEL).toBe('vendor/model-x');
  });

  it('validates passwordless email OTP limits', () => {
    expect(() => validateEnvironment({ AUTH_OTP_EXPIRES_MINUTES: '6' })).toThrow(/AUTH_OTP_EXPIRES_MINUTES/);
    expect(() => validateEnvironment({ AUTH_OTP_MAX_ATTEMPTS: '6' })).toThrow(/AUTH_OTP_MAX_ATTEMPTS/);
    expect(() => validateEnvironment({ AUTH_OTP_RESEND_COOLDOWN_SECONDS: '59' })).toThrow(/AUTH_OTP_RESEND_COOLDOWN_SECONDS/);
    expect(() => validateEnvironment({ PLAYGROUND_USER_REQUESTS_PER_MINUTE: '0' })).toThrow(/PLAYGROUND_USER_REQUESTS_PER_MINUTE/);
    expect(() => validateEnvironment({ PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE: '1001' })).toThrow(/PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE/);
    expect(() => validateEnvironment({ AUTH_OTP_HASH_SECRET: 'short' })).toThrow(/AUTH_OTP_HASH_SECRET/);
  });

  it('requires the OTP hash secret in production without echoing its value', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in', ...productionDatabase, ...productionMail, AUTH_OTP_HASH_SECRET: '' })).toThrow(/AUTH_OTP_HASH_SECRET/);
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in', ...productionDatabase, ...productionMail, AUTH_OTP_HASH_SECRET: 'GENERATE_A_RANDOM_SECRET_OF_32_BYTES_OR_MORE' })).toThrow(/AUTH_OTP_HASH_SECRET/);
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in', ...productionDatabase, ...productionMail, RESEND_API_KEY: 'YOUR_RESEND_API_KEY' })).toThrow(/RESEND_API_KEY/);
  });

  it('accepts an explicitly configured production origin and keeps secrets out of returned config', () => {
    const config = validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in', PRIVATE_KEY: 'never-return-this', ...productionDatabase, ...productionMail });
    expect(config.CORS_ALLOWED_ORIGINS).toBe('https://ai.carteio.in');
    expect(config).not.toHaveProperty('PRIVATE_KEY');
    expect(config).not.toHaveProperty('DATABASE_URL');
  });

  it('rejects unsupported environments and malformed ports', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    for (const PORT of ['0', '65536', '5.5', 'abc']) expect(() => validateEnvironment({ PORT })).toThrow(/PORT/);
  });

  it('requires production CORS configuration and rejects development origins', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(/explicitly configured/);
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in,http://localhost:3000' })).toThrow();
  });

  it('validates log level and restricts proxy trust to configured production hops', () => {
    expect(() => validateEnvironment({ LOG_LEVEL: 'trace' })).toThrow(/LOG_LEVEL/);
    expect(() => validateEnvironment({ TRUST_PROXY_HOPS: '1' })).toThrow(/outside production/);
    expect(validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in', TRUST_PROXY_HOPS: '1', ...productionDatabase, ...productionMail }).TRUST_PROXY_HOPS).toBe(1);
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in', TRUST_PROXY_HOPS: '99' })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('rejects malformed origins and wildcard CORS', () => {
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: '*' })).toThrow();
    expect(() => validateEnvironment({ CORS_ALLOWED_ORIGINS: 'https://example.com/path' })).toThrow();
  });

  it('rejects insecure or loopback production origins', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'http://api.example.com' })).toThrow();
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://localhost' })).toThrow();
  });

  it('allows explicitly limited local mode without database credentials', () => {
    expect(validateEnvironment({}).DATABASE_ENABLED).toBe(false);
  });

  it('requires both encrypted PostgreSQL URLs in production and never returns them', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in' })).toThrow(/DATABASE_URL and DIRECT_URL/);
    const config = validateEnvironment({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://ai.carteio.in', ...productionDatabase, ...productionMail });
    expect(config.DATABASE_ENABLED).toBe(true);
    expect(config).not.toHaveProperty('DATABASE_URL');
    expect(config).not.toHaveProperty('DIRECT_URL');
  });

  it('rejects partial, malformed, non-PostgreSQL, and non-TLS database URLs without echoing credentials', () => {
    expect(() => validateEnvironment({ DATABASE_URL: 'postgresql://secret@host/db?sslmode=require' })).toThrow(/both be configured/);
    expect(() => validateEnvironment({ DATABASE_URL: 'postgresql://secret@host/db', DIRECT_URL: 'postgresql://secret@host/db?sslmode=require' })).toThrow(/sslmode=require/);
    expect(() => validateEnvironment({ DATABASE_URL: 'https://secret@host/db?sslmode=require', DIRECT_URL: 'postgresql://secret@host/db?sslmode=require' })).toThrow(/DATABASE_URL/);
    try {
      validateEnvironment({ DATABASE_URL: 'postgresql://secret@host/db', DIRECT_URL: 'postgresql://secret@host/db?sslmode=require' });
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });
});
