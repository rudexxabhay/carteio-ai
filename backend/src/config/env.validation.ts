export interface AppEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  HOST: string;
  API_PREFIX: 'api/v1';
  CORS_ALLOWED_ORIGINS: string;
  LOG_LEVEL: 'error' | 'warn' | 'log' | 'debug' | 'verbose';
  WIDGET_DEBUG_ENABLED: boolean;
  TRUST_PROXY_HOPS: number;
  /** Boolean only: connection strings remain in process.env and never enter public config. */
  DATABASE_ENABLED: boolean;
  AUTH_SESSION_DAYS: number;
  PUBLIC_APP_URL: string;
  AUTH_OTP_EXPIRES_MINUTES: number;
  AUTH_OTP_MAX_ATTEMPTS: number;
  AUTH_OTP_RESEND_COOLDOWN_SECONDS: number;
  PLAYGROUND_USER_REQUESTS_PER_MINUTE: number;
  PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE: number;
  /** Non-secret provider routing values; validation is reported safely by the provider resolver. */
  AI_DEFAULT_PROVIDER?: string;
  GROQ_MODEL?: string;
  GEMINI_MODEL?: string;
  OPENAI_MODEL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_BASE_URL?: string;
}

function validateDatabaseConfiguration(raw: Record<string, unknown>, mode: string): boolean {
  const pooled = raw.DATABASE_URL;
  const direct = raw.DIRECT_URL;
  if (pooled === undefined && direct === undefined) {
    if (mode === 'production') throw new Error('DATABASE_URL and DIRECT_URL are required in production');
    return false;
  }
  if (typeof pooled !== 'string' || typeof direct !== 'string' || !pooled.trim() || !direct.trim()) {
    throw new Error('DATABASE_URL and DIRECT_URL must both be configured');
  }

  for (const [name, value] of [['DATABASE_URL', pooled], ['DIRECT_URL', direct]] as const) {
    try {
      const url = new URL(value);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
          !url.username || !url.password || !url.pathname.slice(1) || url.searchParams.get('sslmode') !== 'require') throw new Error();
    } catch {
      throw new Error(`${name} must be a valid PostgreSQL URL with sslmode=require`);
    }
  }
  return true;
}

export function validateEnvironment(raw: Record<string, unknown>): AppEnvironment {
  const mode = raw.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(String(mode))) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const port = Number(raw.PORT ?? 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  const host = String(raw.HOST ?? (mode === 'production' ? '0.0.0.0' : '127.0.0.1')).trim();
  if (!host || /[\s/]/.test(host)) throw new Error('HOST must be a hostname or IP address');

  const prefix = raw.API_PREFIX ?? 'api/v1';
  if (prefix !== 'api/v1') throw new Error('API_PREFIX must be api/v1');

  const origins = String(raw.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000').trim();
  const parsedOrigins = origins.split(',').map((origin) => {
    try {
      const url = new URL(origin.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.trim()) {
        throw new Error();
      }
      return url;
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must be a comma-separated list of exact HTTP(S) origins');
    }
  });
  if (parsedOrigins.length === 0 || !origins) {
    throw new Error('CORS_ALLOWED_ORIGINS must include at least one origin');
  }
  if (mode === 'production' && raw.CORS_ALLOWED_ORIGINS === undefined) {
    throw new Error('CORS_ALLOWED_ORIGINS must be explicitly configured in production');
  }
  if (mode === 'production' && parsedOrigins.some((url) => {
    const hostname = url.hostname.toLowerCase();
    const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.startsWith('127.') || hostname === '[::1]';
    return url.protocol !== 'https:' || loopback;
  })) {
    throw new Error('Production CORS origins must use HTTPS and must not target localhost');
  }

  const logLevel = String(raw.LOG_LEVEL ?? 'log');
  if (!['error', 'warn', 'log', 'debug', 'verbose'].includes(logLevel)) {
    throw new Error('LOG_LEVEL must be error, warn, log, debug, or verbose');
  }
  const widgetDebugEnabled = raw.WIDGET_DEBUG_ENABLED ?? 'false';
  if (widgetDebugEnabled !== 'true' && widgetDebugEnabled !== 'false') throw new Error('WIDGET_DEBUG_ENABLED must be true or false');
  const trustProxyRaw = raw.TRUST_PROXY_HOPS ?? 0;
  const trustProxyHops = Number(trustProxyRaw);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5');
  }
  if (mode !== 'production' && trustProxyHops !== 0) {
    throw new Error('TRUST_PROXY_HOPS must be 0 outside production');
  }

  const databaseEnabled = validateDatabaseConfiguration(raw, String(mode));
  const widgetRetentionWorker = raw.WIDGET_RETENTION_WORKER_ENABLED ?? 'false';
  if (widgetRetentionWorker !== 'true' && widgetRetentionWorker !== 'false') throw new Error('WIDGET_RETENTION_WORKER_ENABLED must be true or false');
  const connectorBoolean = raw.CONNECTOR_SYNC_WORKER_ENABLED ?? 'false';
  if (connectorBoolean !== 'true' && connectorBoolean !== 'false') throw new Error('CONNECTOR_SYNC_WORKER_ENABLED must be true or false');
  for (const [name, fallback, minimum, maximum] of [
    ['CONNECTOR_SYNC_POLL_MS', 15000, 1000, 300000], ['CONNECTOR_SYNC_BATCH_SIZE', 10, 1, 100], ['CONNECTOR_SYNC_MAX_ATTEMPTS', 8, 1, 20],
    ['CONNECTOR_MAX_CONFIG_BYTES', 16384, 1024, 65536], ['CONNECTOR_WEBHOOK_MAX_BYTES', 262144, 1024, 1048576], ['CONNECTOR_WEBHOOK_RATE_LIMIT_PER_MINUTE', 60, 1, 600],
  ] as const) {
    const value = Number(raw[name] ?? fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is outside its allowed range`);
  }
  const shopifyVersion = String(raw.SHOPIFY_API_VERSION ?? '2026-10');
  if (!/^20\d{2}-(01|04|07|10)$/.test(shopifyVersion)) throw new Error('SHOPIFY_API_VERSION must be a Shopify quarterly version such as 2026-10');
  const shopifyScopes = String(raw.SHOPIFY_SCOPES ?? 'read_products,read_inventory,read_orders').split(',').map((scope) => scope.trim()).filter(Boolean);
  if (!shopifyScopes.includes('read_products') || shopifyScopes.some((scope) => !/^[a-z][a-z0-9_]{0,127}$/.test(scope))) throw new Error('SHOPIFY_SCOPES must contain read_products and valid Shopify scope handles');
  for (const name of ['SHOPIFY_CALLBACK_URL'] as const) {
    const value = String(raw[name] ?? '').trim();
    if (!value) continue;
    try { const url = new URL(value); if (url.protocol !== 'https:' && mode === 'production' || url.username || url.password || url.hash) throw new Error(); }
    catch { throw new Error(`${name} must be a valid callback URL${mode === 'production' ? ' using HTTPS' : ''}`); }
  }
  const shopifyClientId = String(raw.SHOPIFY_CLIENT_ID ?? '').trim(), shopifyClientSecret = String(raw.SHOPIFY_CLIENT_SECRET ?? '').trim();
  if (Boolean(shopifyClientId) !== Boolean(shopifyClientSecret)) throw new Error('SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be configured together');
  const credentialKey = String(raw.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY ?? '');
  if (credentialKey) {
    const bytes = /^[0-9a-f]{64}$/i.test(credentialKey) ? Buffer.from(credentialKey, 'hex') : Buffer.from(credentialKey, 'base64');
    if (bytes.length !== 32) throw new Error('CONNECTOR_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters');
  }
  const previousKeys = String(raw.CONNECTOR_CREDENTIAL_PREVIOUS_KEYS ?? '');
  if (previousKeys) {
    try {
      const map = JSON.parse(previousKeys) as Record<string, string>;
      if (!map || typeof map !== 'object' || Array.isArray(map) || Object.entries(map).some(([version, key]) => !/^[A-Za-z0-9._-]{1,32}$/.test(version) || typeof key !== 'string' || ![32, 64, 44].includes(key.length))) throw new Error();
    } catch { throw new Error('CONNECTOR_CREDENTIAL_PREVIOUS_KEYS must be a JSON object of key versions to encoded 32-byte keys'); }
  }
  const otpExpiresMinutes = Number(raw.AUTH_OTP_EXPIRES_MINUTES ?? 5);
  if (!Number.isInteger(otpExpiresMinutes) || otpExpiresMinutes < 1 || otpExpiresMinutes > 5) throw new Error('AUTH_OTP_EXPIRES_MINUTES must be an integer from 1 to 5');
  const otpMaxAttempts = Number(raw.AUTH_OTP_MAX_ATTEMPTS ?? 5);
  if (!Number.isInteger(otpMaxAttempts) || otpMaxAttempts < 1 || otpMaxAttempts > 5) throw new Error('AUTH_OTP_MAX_ATTEMPTS must be an integer from 1 to 5');
  const otpResendCooldown = Number(raw.AUTH_OTP_RESEND_COOLDOWN_SECONDS ?? 60);
  if (!Number.isInteger(otpResendCooldown) || otpResendCooldown < 60 || otpResendCooldown > 900) throw new Error('AUTH_OTP_RESEND_COOLDOWN_SECONDS must be an integer from 60 to 900');
  const playgroundUserRateLimit = Number(raw.PLAYGROUND_USER_REQUESTS_PER_MINUTE === '' || raw.PLAYGROUND_USER_REQUESTS_PER_MINUTE === undefined ? 30 : raw.PLAYGROUND_USER_REQUESTS_PER_MINUTE);
  if (!Number.isInteger(playgroundUserRateLimit) || playgroundUserRateLimit < 1 || playgroundUserRateLimit > 120) throw new Error('PLAYGROUND_USER_REQUESTS_PER_MINUTE must be an integer from 1 to 120');
  const playgroundWorkspaceRateLimit = Number(raw.PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE === '' || raw.PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE === undefined ? 120 : raw.PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE);
  if (!Number.isInteger(playgroundWorkspaceRateLimit) || playgroundWorkspaceRateLimit < 1 || playgroundWorkspaceRateLimit > 1000) throw new Error('PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE must be an integer from 1 to 1000');
  const otpHashSecret = String(raw.AUTH_OTP_HASH_SECRET ?? '');
  if (otpHashSecret && Buffer.byteLength(otpHashSecret) < 32) throw new Error('AUTH_OTP_HASH_SECRET must contain at least 32 bytes');

  const isPlaceholder = (value: string) => /^(YOUR_|GENERATE_|CHANGE_ME|PLACEHOLDER)/i.test(value.trim());
  if (mode === 'production' && (!otpHashSecret.trim() || isPlaceholder(otpHashSecret) || Buffer.byteLength(otpHashSecret) < 32)) throw new Error('AUTH_OTP_HASH_SECRET must be configured in production with at least 32 non-placeholder bytes');
  const sessionDays = Number(raw.AUTH_SESSION_DAYS ?? 14);
  if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 90) throw new Error('AUTH_SESSION_DAYS must be an integer from 1 to 90');
  const publicAppUrl = String(raw.PUBLIC_APP_URL ?? (mode === 'production' ? '' : 'http://localhost:3000')).replace(/\/$/, '');
  try {
    const url = new URL(publicAppUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== publicAppUrl || (mode === 'production' && url.protocol !== 'https:')) throw new Error();
  } catch { throw new Error('PUBLIC_APP_URL must be an exact app origin; production must use HTTPS'); }
  if (!parsedOrigins.some((origin) => origin.origin === publicAppUrl)) throw new Error('PUBLIC_APP_URL must be included in CORS_ALLOWED_ORIGINS');
  const resendKey = String(raw.RESEND_API_KEY ?? '').trim();
  const authEmailFrom = String(raw.AUTH_EMAIL_FROM ?? '').trim();
  if (mode === 'production' && (!resendKey || isPlaceholder(resendKey) || !authEmailFrom || isPlaceholder(authEmailFrom))) {
    throw new Error('RESEND_API_KEY and AUTH_EMAIL_FROM are required in production for account email delivery');
  }

  const openRouterBaseUrl = String(raw.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').trim();
  try {
    const url = new URL(openRouterBaseUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'openrouter.ai' || url.port || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/api/v1') throw new Error();
  } catch { throw new Error('OPENROUTER_BASE_URL must be https://openrouter.ai/api/v1'); }

  return {
    NODE_ENV: mode as AppEnvironment['NODE_ENV'],
    PORT: port,
    HOST: host,
    API_PREFIX: 'api/v1',
    CORS_ALLOWED_ORIGINS: origins,
    LOG_LEVEL: logLevel as AppEnvironment['LOG_LEVEL'],
    WIDGET_DEBUG_ENABLED: widgetDebugEnabled === 'true',
    TRUST_PROXY_HOPS: trustProxyHops,
    DATABASE_ENABLED: databaseEnabled,
    AUTH_SESSION_DAYS: sessionDays,
    PUBLIC_APP_URL: publicAppUrl,
    AUTH_OTP_EXPIRES_MINUTES: otpExpiresMinutes,
    AUTH_OTP_MAX_ATTEMPTS: otpMaxAttempts,
    AUTH_OTP_RESEND_COOLDOWN_SECONDS: otpResendCooldown,
    PLAYGROUND_USER_REQUESTS_PER_MINUTE: playgroundUserRateLimit,
    PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE: playgroundWorkspaceRateLimit,
    ...(typeof raw.AI_DEFAULT_PROVIDER === 'string' ? { AI_DEFAULT_PROVIDER: raw.AI_DEFAULT_PROVIDER } : {}),
    ...(typeof raw.GROQ_MODEL === 'string' ? { GROQ_MODEL: raw.GROQ_MODEL } : {}),
    ...(typeof raw.GEMINI_MODEL === 'string' ? { GEMINI_MODEL: raw.GEMINI_MODEL } : {}),
    ...(typeof raw.OPENAI_MODEL === 'string' ? { OPENAI_MODEL: raw.OPENAI_MODEL } : {}),
    ...(typeof raw.OPENROUTER_MODEL === 'string' ? { OPENROUTER_MODEL: raw.OPENROUTER_MODEL } : {}),
    OPENROUTER_BASE_URL: openRouterBaseUrl,
  };
}
