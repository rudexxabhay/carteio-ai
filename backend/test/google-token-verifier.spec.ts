import { UnauthorizedException } from '@nestjs/common';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';

describe('GoogleTokenVerifier', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  let verifier: GoogleTokenVerifier;
  let verifySignedToken: jest.SpyInstance;
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
    verifier = new GoogleTokenVerifier();
    verifySignedToken = jest.spyOn(verifier as any, 'verifySignedToken');
  });
  afterAll(() => { if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = originalClientId; });

  it('rejects signature/library verification failures without leaking details', async () => {
    verifySignedToken.mockRejectedValue(new Error('sensitive verifier detail'));
    await expect(verifier.verify('invalid-token')).rejects.toThrow('Google sign-in could not be verified.');
  });

  it('rejects a token with an unexpected audience', async () => {
    verifySignedToken.mockResolvedValue({ iss: 'https://accounts.google.com', aud: 'other-client', exp: Date.now() / 1000 + 60, sub: 'google-sub', email: 'user@example.com', email_verified: true });
    await expect(verifier.verify('signed-token')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unexpected issuer and expired tokens', async () => {
    const claims = { iss: 'https://attacker.example', aud: process.env.GOOGLE_CLIENT_ID, exp: Date.now() / 1000 + 60, sub: 'google-sub', email: 'user@example.com', email_verified: true };
    verifySignedToken.mockResolvedValue(claims);
    await expect(verifier.verify('signed-token')).rejects.toThrow(UnauthorizedException);
    claims.iss = 'https://accounts.google.com'; claims.exp = Date.now() / 1000 - 1;
    await expect(verifier.verify('signed-token')).rejects.toThrow(UnauthorizedException);
  });
});
