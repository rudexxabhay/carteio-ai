import { Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';

type GoogleClient = { verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): Record<string, any> | undefined }> };

export interface GoogleIdentityClaims {
  sub: string;
  email: string;
  emailVerified: true;
  name: string | null;
}

@Injectable()
export class GoogleTokenVerifier {
  protected async verifySignedToken(idToken: string, audience: string): Promise<Record<string, any> | undefined> {
    const client = new (require('google-auth-library').OAuth2Client)() as GoogleClient;
    const ticket = await client.verifyIdToken({ idToken, audience });
    return ticket.getPayload();
  }

  async verify(idToken: string): Promise<GoogleIdentityClaims> {
    const audience = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!audience) throw new ServiceUnavailableException('Google sign-in is not configured.');
    try {
      const payload = await this.verifySignedToken(idToken, audience);
      const issuer = payload?.iss;
      if (!payload || !payload.sub || !payload.email || payload.email_verified !== true ||
          (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') ||
          payload.aud !== audience || !payload.exp || payload.exp * 1000 <= Date.now()) {
        throw new Error('Invalid Google identity claims');
      }
      const name = typeof payload.name === 'string' ? payload.name.trim().normalize('NFKC').slice(0, 200) : '';
      return { sub: payload.sub, email: payload.email.trim().normalize('NFKC').toLowerCase(), emailVerified: true, name: name || null };
    } catch {
      throw new UnauthorizedException('Google sign-in could not be verified.');
    }
  }
}
