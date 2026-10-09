import { AuthService } from '../src/modules/auth/auth.service';

const activeUser = { id: 'user-1', name: 'Carteio User', email: 'person@example.com', emailVerifiedAt: new Date(), status: 'ACTIVE' };
const setup = (overrides: Record<string, any> = {}, google = { verify: jest.fn().mockResolvedValue({ sub: 'google-sub-1', email: activeUser.email, emailVerified: true, name: activeUser.name }) }) => {
  const db: any = {
    $transaction: jest.fn(async (work: (tx: any) => unknown) => work(db)),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue(activeUser) },
    authIdentity: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    emailOtpChallenge: { deleteMany: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 'challenge-1' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    userSession: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  const email = { available: true, send: jest.fn().mockResolvedValue(true) };
  return { service: new AuthService(db, email as any, google as any), db, email, google };
};

describe('Google and email OTP authentication', () => {
  const originalOtpHashSecret = process.env.AUTH_OTP_HASH_SECRET;
  beforeAll(() => { process.env.AUTH_OTP_HASH_SECRET = 'test-only-otp-hmac-secret-32-bytes-minimum'; });
  afterAll(() => { if (originalOtpHashSecret === undefined) delete process.env.AUTH_OTP_HASH_SECRET; else process.env.AUTH_OTP_HASH_SECRET = originalOtpHashSecret; });
  it('creates a session for an existing Google identity', async () => {
    const db = {
      authIdentity: { findUnique: jest.fn().mockResolvedValue({ userId: activeUser.id, user: activeUser }) },
      userSession: { create: jest.fn().mockResolvedValue({}) }, auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = setup(db as any);
    const result = await service.googleLogin('id-token');
    expect(result.user.email).toBe(activeUser.email);
    expect(db.userSession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: activeUser.id, tokenHash: expect.any(String) }) }));
  });

  it('creates a Google account with a provider-subject identity when the verified email is new', async () => {
    const userCreate = jest.fn().mockResolvedValue(activeUser);
    const { service, db } = setup({ user: { findUnique: jest.fn().mockResolvedValue(null), create: userCreate } });
    await service.googleLogin('id-token');
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ emailVerifiedAt: expect.any(Date), identities: { create: { provider: 'GOOGLE', providerSubject: 'google-sub-1' } } }) }));
    expect(db.userSession.create).toHaveBeenCalled();
  });

  it('creates a Google account with a provider-subject identity when the verified email is new', async () => {
    const userCreate = jest.fn().mockResolvedValue(activeUser);
    const { service, db } = setup({ user: { findUnique: jest.fn().mockResolvedValue(null), create: userCreate } });
    await service.googleLogin('id-token');
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ emailVerifiedAt: expect.any(Date), identities: { create: { provider: 'GOOGLE', providerSubject: 'google-sub-1' } } }) }));
    expect(db.userSession.create).toHaveBeenCalled();
  });

  it('does not automatically link a Google subject to a password account by email', async () => {
    const { service, db } = setup({ user: { findUnique: jest.fn().mockResolvedValue({ id: activeUser.id }) } });
    await expect(service.googleLogin('id-token')).rejects.toThrow(/sign in and link Google/);
    expect(db.authIdentity.create).not.toHaveBeenCalled();
    expect(db.userSession.create).not.toHaveBeenCalled();
  });

  it('requires the authenticated account email to match before Google linking', async () => {
    const google = { verify: jest.fn().mockResolvedValue({ sub: 'google-sub-2', email: 'different@example.com', emailVerified: true, name: null }) };
    const { service, db } = setup({ user: { findUnique: jest.fn().mockResolvedValue(activeUser) } }, google);
    await expect(service.linkGoogle(activeUser.id, 'id-token')).rejects.toThrow(/must match/);
    expect(db.authIdentity.create).not.toHaveBeenCalled();
  });

  it('links a verified Google subject only to the authenticated matching account', async () => {
    const { service, db } = setup({ user: { findUnique: jest.fn().mockResolvedValue(activeUser) } });
    expect(await service.linkGoogle(activeUser.id, 'id-token')).toEqual({ status: 'linked' });
    expect(db.authIdentity.create).toHaveBeenCalledWith({ data: { userId: activeUser.id, provider: 'GOOGLE', providerSubject: 'google-sub-1' } });
  });

  it('stores a keyed OTP digest and reports provider acceptance', async () => {
    const { service, db, email } = setup();
    const result = await service.requestOtp(' Person@Example.com ');
    const saved = db.emailOtpChallenge.upsert.mock.calls[0][0].create;
    const code = email.send.mock.calls[0][2].match(/code is (\d{6})/)[1];
    expect(result).toMatchObject({ status: 'request_accepted', deliveryAccepted: true, challengeId: 'challenge-1' });
    expect(saved.codeHash).toMatch(/^[a-f\d]{64}$/);
    expect(saved.codeHash).not.toBe(code);
    expect(saved.expiresAt.getTime() - saved.createdAt.getTime()).toBe(5 * 60_000);
  });

  it('uses one atomic user upsert for OTP sign-in and creates a session', async () => {
    const { service, db } = setup();
    const result = await service.verifyOtp(activeUser.email, '00000000-0000-4000-8000-000000000001', '123456');
    expect(result.user.email).toBe(activeUser.email);
    expect(db.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: activeUser.email }, create: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }) }));
    expect(db.userSession.create).toHaveBeenCalled();
  });

  it('rejects expired or replayed OTP challenges and counts invalid attempts', async () => {
    const challenge = '00000000-0000-4000-8000-000000000001';
    const { service, db } = setup({ emailOtpChallenge: { deleteMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) } });
    await expect(service.verifyOtp(activeUser.email, challenge, '123456')).rejects.toThrow(/invalid or expired/);
    expect(db.emailOtpChallenge.updateMany).toHaveBeenCalledTimes(2);
    expect(db.emailOtpChallenge.updateMany.mock.calls[0][0].where.expiresAt.gt).toBeInstanceOf(Date);
    expect(db.userSession.create).not.toHaveBeenCalled();
  });

  it('allows a code to be consumed only once and locks a challenge after the maximum invalid attempts', async () => {
    const challenge = '00000000-0000-4000-8000-000000000001';
    const replay = setup();
    replay.db.emailOtpChallenge.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    await replay.service.verifyOtp(activeUser.email, challenge, '123456');
    await expect(replay.service.verifyOtp(activeUser.email, challenge, '123456')).rejects.toThrow(/invalid or expired/);
    expect(replay.db.userSession.create).toHaveBeenCalledTimes(1);

    const bruteForce = setup({ emailOtpChallenge: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }) } });
    await expect(bruteForce.service.verifyOtp(activeUser.email, challenge, '000000')).rejects.toMatchObject({ response: { code: 'OTP_ATTEMPTS_EXCEEDED' }, status: 400 });
    expect(bruteForce.db.emailOtpChallenge.updateMany).toHaveBeenCalledTimes(3);
    expect(bruteForce.db.emailOtpChallenge.updateMany.mock.calls[2][0].data.consumedAt).toBeInstanceOf(Date);
  });

  it('enforces resend cooldown and reports Resend rejection as a safe service error', async () => {
    const recent = { createdAt: new Date(), consumedAt: null };
    const cool = setup({ emailOtpChallenge: { deleteMany: jest.fn(), findUnique: jest.fn().mockResolvedValue(recent), upsert: jest.fn(), updateMany: jest.fn() } });
    expect(await cool.service.requestOtp(activeUser.email)).toMatchObject({ deliveryAccepted: false, retryAfterSeconds: expect.any(Number) });
    expect(cool.email.send).not.toHaveBeenCalled();
    const failed = setup(); failed.email.send.mockResolvedValue(false);
    await expect(failed.service.requestOtp(activeUser.email)).rejects.toMatchObject({ response: { code: 'EMAIL_SERVICE_UNAVAILABLE' }, status: 503 });
  });
  it('reports missing OTP delivery configuration without claiming successful delivery', async () => {
    const { service } = setup();
    const email = (service as any).email;
    email.available = false;
    await expect(service.requestOtp(activeUser.email)).rejects.toMatchObject({ response: { code: 'EMAIL_SERVICE_UNAVAILABLE' }, status: 503 });
  });
  it('classifies OTP persistence failures without exposing database details', async () => {
    const { service } = setup({ emailOtpChallenge: { deleteMany: jest.fn().mockRejectedValue(new Error('private database detail')) } });
    await expect(service.requestOtp(activeUser.email)).rejects.toMatchObject({ response: { code: 'AUTH_SERVICE_UNAVAILABLE' }, status: 503 });
  });
});
