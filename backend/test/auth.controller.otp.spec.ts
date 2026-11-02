import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthRateLimitGuard } from '../src/modules/auth/auth-rate-limit.guard';
import { AuthSessionGuard } from '../src/modules/auth/auth-session.guard';

describe('AuthController OTP verification route', () => {
  it('accepts the OTP verification request without an existing session and creates its session cookie', async () => {
    const user = { id: 'user-test', email: 'member@example.invalid', name: 'Member', emailVerified: true, status: 'ACTIVE' };
    const session = { token: 'test-session-token', expiresAt: new Date(Date.now() + 60_000), user };
    const auth = { verifyOtp: jest.fn().mockResolvedValue({ status: 'authenticated', session }) };
    const controller = new AuthController(auth as any);
    const req = { headers: {}, requestId: 'otp-login-test' } as any;
    const res = { cookie: jest.fn() } as any;
    const body = { email: user.email, challengeId: '00000000-0000-4000-8000-000000000009', code: '123456', flow: 'login' as const };

    const result = await controller.verifyOtp(body, req, res);

    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.verifyOtp)).toEqual([AuthRateLimitGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.verifyOtp)).not.toContain(AuthSessionGuard);
    expect(auth.verifyOtp).toHaveBeenCalledWith(user.email, body.challengeId, body.code, undefined, 'login', undefined, req.requestId);
    expect(res.cookie).toHaveBeenCalled();
    expect(result).toEqual({ user });
  });
});
