import { Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService security behavior', () => {
  const user = { id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerifiedAt: new Date(), status: 'ACTIVE' };
  const makeService = (db: Record<string, any>, email = { available: true, send: jest.fn().mockResolvedValue(true) }) => ({ service: new AuthService(db as any, email as any), db, email });

  it('stores only an Argon2id password hash during registration', async () => {
    const db: Record<string, any> = { user: { create: jest.fn().mockResolvedValue({ id: user.id, email: user.email }) }, emailVerificationToken: { updateMany: jest.fn(), create: jest.fn().mockResolvedValue({}) } };
    const { service } = makeService(db);
    await service.signup({ name: ' Test User ', email: 'TEST@example.com', password: 'a very long secure passphrase' });
    const hash = db.user.create.mock.calls[0][0].data.credential.create.passwordHash;
    expect(hash).not.toContain('a very long secure passphrase');
    expect(await argon2.verify(hash, 'a very long secure passphrase')).toBe(true);
    expect(db.user.create.mock.calls[0][0].data.email).toBe('test@example.com');
  });

  it('uses generic credentials and persists a server-side session after valid login', async () => {
    const passwordHash = await argon2.hash('a very long secure passphrase', { type: argon2.argon2id });
    const db: Record<string, any> = {
      userSession: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({}) },
      emailVerificationToken: { deleteMany: jest.fn() }, passwordResetToken: { deleteMany: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ ...user, credential: { passwordHash } }) },
    };
    const { service } = makeService(db);
    const result = await service.login(' TEST@example.com ', 'a very long secure passphrase');
    expect(db.userSession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: user.id, tokenHash: expect.any(String), expiresAt: expect.any(Date) }) }));
    expect(result.token).toHaveLength(43);
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects invalid credentials without creating a session', async () => {
    const db: Record<string, any> = {
      userSession: { deleteMany: jest.fn(), create: jest.fn() }, emailVerificationToken: { deleteMany: jest.fn() },
      passwordResetToken: { deleteMany: jest.fn() }, user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service } = makeService(db);
    await expect(service.login('missing@example.com', 'incorrect')).rejects.toThrow('Email or password is incorrect.');
    expect(db.userSession.create).not.toHaveBeenCalled();
  });

  it('logs categorized email-provider failures without addresses, OTPs or provider error content', async () => {
    const previousSecret = process.env.AUTH_OTP_HASH_SECRET;
    process.env.AUTH_OTP_HASH_SECRET = 'test-only-otp-hash-secret-with-more-than-32-bytes';
    const privateEmail = 'private.person@example.test';
    const providerBody = 'provider-secret-response-and-token';
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
      emailOtpChallenge: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'challenge-1' }),
      },
    };
    const db: Record<string, any> = {
      emailOtpChallenge: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const email = { available: true, send: jest.fn().mockRejectedValue(new Error(providerBody)) };
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeService(db, email);

    try {
      const failure = await service.requestOtp(privateEmail, '11111111-1111-4111-8111-111111111111').catch((error: unknown) => error);
      const output = JSON.stringify({ logs: warning.mock.calls, failure });
      expect(output).not.toContain(privateEmail);
      expect(output).not.toContain(providerBody);
      expect(output).not.toContain('AUTH_OTP_HASH_SECRET');
      expect(failure).toMatchObject({ response: { code: 'AUTH_SERVICE_UNAVAILABLE' } });
      expect(output).toContain('OTP_EMAIL_PROVIDER_ERROR');
    } finally {
      warning.mockRestore();
      if (previousSecret === undefined) delete process.env.AUTH_OTP_HASH_SECRET;
      else process.env.AUTH_OTP_HASH_SECRET = previousSecret;
    }
  });

  it('rejects expired and revoked sessions and revokes a session on logout', async () => {
    const raw = 'opaque-session-value'; const digest = require('node:crypto').createHash('sha256').update(raw).digest('hex');
    const session: { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null; user: typeof user } = { id: 'session-1', userId: user.id, tokenHash: digest, expiresAt: new Date(Date.now() + 60000), revokedAt: null, user };
    const db: Record<string, any> = { userSession: { findUnique: jest.fn().mockResolvedValue(session), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const { service } = makeService(db);
    await expect(service.current()).rejects.toThrow();
    expect(db.userSession.findUnique).not.toHaveBeenCalled();
    await expect(service.current('invalid-session-value')).rejects.toThrow();
    expect(await service.current(raw)).toHaveProperty('user.email', user.email);
    session.expiresAt = new Date(Date.now() - 1);
    await expect(service.current(raw)).rejects.toThrow();
    session.expiresAt = new Date(Date.now() + 60000);
    session.revokedAt = new Date();
    await expect(service.current(raw)).rejects.toThrow();
    await service.logout('session-1', user.id);
    expect(db.userSession.updateMany).toHaveBeenCalled();
  });
});
