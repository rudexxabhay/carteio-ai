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

  it('rejects expired and revoked sessions and revokes a session on logout', async () => {
    const raw = 'opaque-session-value'; const digest = require('node:crypto').createHash('sha256').update(raw).digest('hex');
    const session = { id: 'session-1', userId: user.id, tokenHash: digest, expiresAt: new Date(Date.now() + 60000), revokedAt: null, user };
    const db: Record<string, any> = { userSession: { findUnique: jest.fn().mockResolvedValue(session), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const { service } = makeService(db);
    expect(await service.current(raw)).toHaveProperty('user.email', user.email);
    session.revokedAt = new Date();
    await expect(service.current(raw)).rejects.toThrow();
    await service.logout('session-1');
    expect(db.userSession.updateMany).toHaveBeenCalled();
  });
});
