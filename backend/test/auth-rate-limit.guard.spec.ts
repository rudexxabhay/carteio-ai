import { AuthRateLimitGuard } from '../src/modules/auth/auth-rate-limit.guard';

describe('AuthRateLimitGuard', () => {
  const names = ['NODE_ENV', 'APP_ENV', 'AUTH_OTP_RATE_LIMIT_ENABLED', 'AUTH_OTP_RATE_LIMIT_TEST_EMAILS'] as const;
  const original = new Map(names.map(name => [name, process.env[name]]));

  afterEach(() => {
    for (const name of names) {
      const value = original.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const request = (email: string, route: string, ip: string) => {
    const req = { body: { email }, route: { path: route }, path: route, ip };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    return new AuthRateLimitGuard().canActivate(context);
  };

  it('bypasses OTP request throttling only for an explicitly listed email in local development', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_OTP_RATE_LIMIT_ENABLED = 'false';
    process.env.AUTH_OTP_RATE_LIMIT_TEST_EMAILS = ' otp-test@example.invalid ';

    for (let index = 0; index < 5; index += 1) {
      expect(request('OTP-Test@example.invalid', 'otp/request', '127.0.0.10')).toBe(true);
    }
  });

  it('keeps OTP request throttling for unlisted email addresses', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_OTP_RATE_LIMIT_ENABLED = 'false';
    process.env.AUTH_OTP_RATE_LIMIT_TEST_EMAILS = 'otp-test@example.invalid';

    for (let index = 0; index < 4; index += 1) request('other@example.invalid', 'otp/request', '127.0.0.11');
    expect(() => request('other@example.invalid', 'otp/request', '127.0.0.11')).toThrow();
  });

  it('keeps throttling enabled outside development even when the disable option is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_OTP_RATE_LIMIT_ENABLED = 'false';
    process.env.AUTH_OTP_RATE_LIMIT_TEST_EMAILS = 'otp-test@example.invalid';

    for (let index = 0; index < 4; index += 1) request('otp-test@example.invalid', 'otp/request', '127.0.0.12');
    expect(() => request('otp-test@example.invalid', 'otp/request', '127.0.0.12')).toThrow();
  });

  it('keeps throttling enabled for UAT even if its Node mode is misconfigured as development', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'uat';
    process.env.AUTH_OTP_RATE_LIMIT_ENABLED = 'false';
    process.env.AUTH_OTP_RATE_LIMIT_TEST_EMAILS = 'otp-test@example.invalid';

    for (let index = 0; index < 4; index += 1) request('otp-test@example.invalid', 'otp/request', '127.0.0.15');
    expect(() => request('otp-test@example.invalid', 'otp/request', '127.0.0.15')).toThrow();
  });

  it('keeps OTP request throttling enabled by default in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_OTP_RATE_LIMIT_ENABLED;
    process.env.AUTH_OTP_RATE_LIMIT_TEST_EMAILS = 'otp-test@example.invalid';

    for (let index = 0; index < 4; index += 1) request('otp-test@example.invalid', 'otp/request', '127.0.0.14');
    expect(() => request('otp-test@example.invalid', 'otp/request', '127.0.0.14')).toThrow();
  });

  it('keeps OTP verification throttled when development request throttling is disabled', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_OTP_RATE_LIMIT_ENABLED = 'false';
    process.env.AUTH_OTP_RATE_LIMIT_TEST_EMAILS = 'otp-test@example.invalid';

    for (let index = 0; index < 10; index += 1) request('otp-test@example.invalid', 'otp/verify', '127.0.0.13');
    expect(() => request('otp-test@example.invalid', 'otp/verify', '127.0.0.13')).toThrow();
  });
});
