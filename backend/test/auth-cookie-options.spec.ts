import { sessionCookieOptions } from '../src/modules/auth/auth.controller';

describe('session cookie options', () => {
  const before = process.env.NODE_ENV;
  afterEach(() => { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; });
  it('uses a host-only HttpOnly strict cookie and Secure only in production', () => {
    process.env.NODE_ENV = 'development';
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, secure: false, sameSite: 'strict', path: '/' });
    expect(sessionCookieOptions()).not.toHaveProperty('domain');
    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  });
});
