import { BadRequestException, ConflictException, HttpException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomInt, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailService } from './email.service';
import { GoogleTokenVerifier } from './google-token-verifier';

const sessionLifetimeDays = () => Number(process.env.AUTH_SESSION_DAYS ?? 14);
export const sessionCookieName = () => process.env.NODE_ENV === 'production' ? '__Host-carteio_session' : 'carteio_session';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (left: string, right: string) => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
const normalizeEmail = (email: string) => email.trim().normalize('NFKC').toLowerCase();
const otpDigest = (email: string, code: string) => {
  const secret = process.env.AUTH_OTP_HASH_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) throw new ServiceUnavailableException({ code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Email code sign-in is not configured.' });
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly db: any;
  constructor(prisma: PrismaService, private readonly email: EmailService, private readonly google: GoogleTokenVerifier = new GoogleTokenVerifier()) { this.db = prisma as any; }

  private async audit(action: string, userId: string) {
    try { await this.db.auditEvent.create({ data: { actorUserId: userId, action, entityType: 'User', entityId: userId, metadata: { source: 'authentication' } } }); }
    catch { this.logger.warn(`Could not persist security audit event: ${action}`); }
  }

  private async tokenRecord(model: 'emailVerificationToken' | 'passwordResetToken', userId: string, ttlMs: number) {
    const now = new Date();
    await this.db[model].updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
    const token = randomBytes(32).toString('base64url');
    await this.db[model].create({ data: { userId, tokenHash: hash(token), expiresAt: new Date(now.getTime() + ttlMs) } });
    return token;
  }
  private mailUrl(path: string, token: string) { const base = (process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''); return `${base}${path}#token=${encodeURIComponent(token)}`; }
  private async sendVerification(user: { id: string; email: string }) {
    const token = await this.tokenRecord('emailVerificationToken', user.id, 24 * 60 * 60 * 1000);
    const sent = await this.email.send(user.email, 'Verify your Carteio AI email', `Verify your email address: ${this.mailUrl('/verify-email', token)}\nThis link expires in 24 hours.`);
    if (!sent) this.logger.warn('Verification email could not be delivered; configure the transactional email provider.');
    return sent;
  }

  async signup(input: { name: string; email: string; password: string }) {
    if (!this.email.available) throw new ServiceUnavailableException('Email verification is not configured. Please try again later.');
    const name = input.name.trim().normalize('NFKC'); const email = normalizeEmail(input.email);
    if (!name || /[\u0000-\u001f\u007f]/.test(name)) throw new BadRequestException('Enter a valid name.');
    if (/(password|123456|qwerty|letmein|welcome|admin)/i.test(input.password) && input.password.length < 16) throw new BadRequestException('Choose a less common password.');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    try {
      const user = await this.db.user.create({ data: { name, email, credential: { create: { passwordHash } } }, select: { id: true, email: true } });
      const delivered = await this.sendVerification(user);
      if (!delivered) throw new ServiceUnavailableException('Your account was created, but verification email delivery is unavailable. Contact support before retrying.');
      await this.audit('auth.signup.created', user.id);
      this.logger.log('signup_created');
      return { status: 'verification_required' };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('An account with this email already exists.');
      throw error;
    }
  }

  async verify(token: string) {
    const record = await this.db.emailVerificationToken.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) throw new BadRequestException('This verification link is invalid or expired.');
    await this.db.$transaction(async (tx: any) => {
      const consumed = await tx.emailVerificationToken.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new BadRequestException('This verification link is invalid or expired.');
      await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    });
    await this.audit('auth.email.verified', record.userId);
    return { status: 'verified' };
  }

  async resend(emailInput: string) {
    const email = normalizeEmail(emailInput); const user = await this.db.user.findUnique({ where: { email }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (user && !user.emailVerifiedAt) {
      const recent = await this.db.emailVerificationToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
      if (!recent) await this.sendVerification(user);
    }
    return { status: 'request_accepted', deliveryAvailable: this.email.available };
  }

  async login(emailInput: string, password: string, existingSessionToken?: string) {
    // Opportunistic cleanup keeps the database tidy without a separate worker or server.
    const now = new Date();
    await this.db.userSession.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.db.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } });
    const user = await this.db.user.findUnique({ where: { email: normalizeEmail(emailInput) }, include: { credential: true } });
    const valid = user?.credential ? await argon2.verify(user.credential.passwordHash, password).catch(() => false) : false;
    if (!valid || user.status !== 'ACTIVE') { this.logger.warn('login_rejected'); throw new UnauthorizedException('Email or password is incorrect.'); }
    if (!user.emailVerifiedAt) throw new UnauthorizedException('Verify your email before signing in.');
    await this.audit('auth.login.succeeded', user.id);
    return this.createSession(user, existingSessionToken);
  }

  private async createSession(user: any, existingSessionToken?: string, db = this.db) {
    if (existingSessionToken) await db.userSession.updateMany({ where: { tokenHash: hash(existingSessionToken), revokedAt: null }, data: { revokedAt: new Date() } });
    const raw = randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + sessionLifetimeDays() * 86400000);
    await db.userSession.create({ data: { userId: user.id, tokenHash: hash(raw), expiresAt } });
    return { token: raw, expiresAt, user: this.publicUser(user) };
  }

  async googleLogin(idToken: string, existingSessionToken?: string) {
    const claims = await this.google.verify(idToken);
    let identity = await this.db.authIdentity.findUnique({ where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: claims.sub } }, include: { user: true } });
    if (identity) {
      if (identity.user.status !== 'ACTIVE') throw new UnauthorizedException('This account is unavailable.');
      const session = await this.createSession(identity.user, existingSessionToken);
      void this.audit('auth.google.login.succeeded', identity.userId);
      return session;
    }
    const existing = await this.db.user.findUnique({ where: { email: claims.email }, select: { id: true } });
    if (existing) throw new ConflictException('Could not complete Google sign-in. If you already have an account, sign in and link Google from your account settings.');
    let user: any;
    try {
      user = await this.db.$transaction(async (tx: any) => {
        const created = await tx.user.create({ data: { email: claims.email, name: claims.name, emailVerifiedAt: new Date(), identities: { create: { provider: 'GOOGLE', providerSubject: claims.sub } } } });
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      identity = await this.db.authIdentity.findUnique({ where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: claims.sub } }, include: { user: true } });
      if (!identity || identity.user.status !== 'ACTIVE') throw new ConflictException('This Google identity could not be linked to an account.');
      user = identity.user;
    }
    const session = await this.createSession(user, existingSessionToken);
    void this.audit('auth.google.login.succeeded', user.id);
    return session;
  }

  async linkGoogle(userId: string, idToken: string) {
    const claims = await this.google.verify(idToken);
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || normalizeEmail(user.email) !== claims.email) throw new ConflictException('The verified Google email must match the signed-in account email.');
    const existing = await this.db.authIdentity.findUnique({ where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: claims.sub } } });
    if (existing && existing.userId !== userId) throw new ConflictException('This Google identity is already linked to another account.');
    if (!existing) {
      try { await this.db.authIdentity.create({ data: { userId, provider: 'GOOGLE', providerSubject: claims.sub } }); }
      catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        const raced = await this.db.authIdentity.findUnique({ where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: claims.sub } } });
        if (!raced || raced.userId !== userId) throw new ConflictException('This Google identity is already linked to another account.');
      }
    }
    await this.audit('auth.google.linked', userId);
    return { status: 'linked' };
  }

  async requestOtp(emailInput: string) {
    if (!this.email.available) throw new ServiceUnavailableException({ code: 'EMAIL_SERVICE_UNAVAILABLE', message: 'Email code delivery is temporarily unavailable.' });
    const email = normalizeEmail(emailInput);
    let failureBoundary = 'challenge_cleanup';
    try {
    const now = new Date(); const cooldownMs = Number(process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS ?? 60) * 1000;
    await this.db.emailOtpChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null }, createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } }] } });
    failureBoundary = 'challenge_transaction';
    const challenge = await this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
      const prior = await tx.emailOtpChallenge.findUnique({ where: { email } });
      const remaining = prior ? cooldownMs - (now.getTime() - prior.createdAt.getTime()) : 0;
      if (remaining > 0) return { id: null, retryAfterSeconds: Math.ceil(remaining / 1000), code: null };
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = new Date(now.getTime() + Number(process.env.AUTH_OTP_EXPIRES_MINUTES ?? 5) * 60_000);
      const saved = await tx.emailOtpChallenge.upsert({
        where: { email },
        create: { email, codeHash: otpDigest(email, code), createdAt: now, expiresAt, attempts: 0, consumedAt: null },
        update: { codeHash: otpDigest(email, code), createdAt: now, expiresAt, attempts: 0, consumedAt: null },
        select: { id: true },
      });
      return { id: saved.id, retryAfterSeconds: 0, code };
    });
    if (!challenge.id || !challenge.code) return { status: 'request_accepted', deliveryAccepted: false, retryAfterSeconds: challenge.retryAfterSeconds };
    failureBoundary = 'provider_delivery';
    const sent = await this.email.send(email, 'Your Carteio AI sign-in code', `Your sign-in code is ${challenge.code}. It expires in ${process.env.AUTH_OTP_EXPIRES_MINUTES ?? '5'} minutes. If you did not request it, you can ignore this email.`);
    if (!sent) { failureBoundary = 'failed_delivery_cleanup'; await this.db.emailOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } }); throw new ServiceUnavailableException({ code: 'EMAIL_SERVICE_UNAVAILABLE', message: 'Email code delivery is temporarily unavailable.' }); }
    return { status: 'request_accepted', deliveryAccepted: sent, retryAfterSeconds: sent ? Math.ceil(cooldownMs / 1000) : 0, ...(sent ? { challengeId: challenge.id } : {}) };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`OTP request failed at ${failureBoundary}`);
      throw new ServiceUnavailableException({ code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Email code sign-in is temporarily unavailable.' });
    }
  }

  async verifyOtp(emailInput: string, challengeId: string, code: string, existingSessionToken?: string) {
    const email = normalizeEmail(emailInput); const now = new Date(); const digest = otpDigest(email, code);
    const result = await this.db.$transaction(async (tx: any) => {
      const consumed = await tx.emailOtpChallenge.updateMany({ where: { id: challengeId, email, codeHash: digest, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: Number(process.env.AUTH_OTP_MAX_ATTEMPTS ?? 5) } }, data: { consumedAt: now } });
      if (consumed.count !== 1) return null;
      const user = await tx.user.upsert({
        where: { email },
        create: { email, name: null, emailVerifiedAt: now },
        update: { emailVerifiedAt: now },
      });
      if (user.status !== 'ACTIVE') return { blocked: true, user: null, session: null };
      const session = await this.createSession(user, existingSessionToken, tx);
      return { blocked: false, user, session };
    });
    if (!result) {
      const attempt = await this.db.emailOtpChallenge.updateMany({ where: { id: challengeId, email, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: Number(process.env.AUTH_OTP_MAX_ATTEMPTS ?? 5) } }, data: { attempts: { increment: 1 } } });
      const maxAttempts = Number(process.env.AUTH_OTP_MAX_ATTEMPTS ?? 5);
      const locked = attempt.count === 1 ? await this.db.emailOtpChallenge.updateMany({ where: { id: challengeId, email, consumedAt: null, attempts: { gte: maxAttempts } }, data: { consumedAt: now } }) : { count: 0 };
      if (locked.count === 1) throw new BadRequestException({ code: 'OTP_ATTEMPTS_EXCEEDED', message: 'Too many incorrect codes. Request a new code.' });
      const challenge = attempt.count === 0 ? await this.db.emailOtpChallenge.findUnique({ where: { id: challengeId }, select: { email: true, expiresAt: true, attempts: true } }) : null;
      if (challenge?.email === email && challenge.expiresAt <= now) throw new BadRequestException({ code: 'OTP_EXPIRED', message: 'This code has expired. Request a new code.' });
      if (challenge?.email === email && challenge.attempts >= maxAttempts) throw new BadRequestException({ code: 'OTP_ATTEMPTS_EXCEEDED', message: 'Too many incorrect codes. Request a new code.' });
      throw new BadRequestException({ code: 'OTP_INVALID', message: 'This code is invalid or expired. Request a new code and try again.' });
    }
    if (result.blocked) throw new UnauthorizedException('This account is unavailable.');
    await this.audit('auth.otp.login.succeeded', result.user.id);
    return result.session;
  }

  async current(raw?: string) {
    if (!raw) throw new UnauthorizedException();
    const digest = hash(raw); const row = await this.db.userSession.findUnique({ where: { tokenHash: digest }, include: { user: true } });
    if (!row || !equal(row.tokenHash, digest) || row.revokedAt || row.expiresAt <= new Date() || row.user.status !== 'ACTIVE') throw new UnauthorizedException();
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) await this.db.userSession.updateMany({ where: { id: row.id, revokedAt: null }, data: { lastUsedAt: new Date() } });
    return { sessionId: row.id, user: this.publicUser(row.user) };
  }
  async logout(sessionId: string, userId: string) { await this.db.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } }); await this.audit('auth.logout', userId); }
  async logoutAll(userId: string) { await this.db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }); await this.audit('auth.logout_all', userId); }

  async forgot(emailInput: string) {
    if (!this.email.available) return { status: 'request_accepted', deliveryAvailable: false };
    const user = await this.db.user.findUnique({ where: { email: normalizeEmail(emailInput) }, select: { id: true, email: true } });
    if (user) {
      const recent = await this.db.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
      if (!recent) {
        const token = await this.tokenRecord('passwordResetToken', user.id, 60 * 60 * 1000);
        await this.email.send(user.email, 'Reset your Carteio AI password', `Reset your password: ${this.mailUrl('/reset-password', token)}\nThis link expires in one hour.`);
      }
    }
    return { status: 'request_accepted', deliveryAvailable: true };
  }
  async reset(token: string, password: string) {
    if (/(password|123456|qwerty|letmein|welcome|admin)/i.test(password) && password.length < 16) throw new BadRequestException('Choose a less common password.');
    const record = await this.db.passwordResetToken.findUnique({ where: { tokenHash: hash(token) } });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) throw new BadRequestException('This reset link is invalid or expired.');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await this.db.$transaction(async (tx: any) => {
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new BadRequestException('This reset link is invalid or expired.');
      await tx.passwordCredential.update({ where: { userId: record.userId }, data: { passwordHash, changedAt: new Date() } });
      await tx.userSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await this.audit('auth.password.reset', record.userId);
    return { status: 'password_reset' };
  }
  private publicUser(user: any) { return { id: user.id, name: user.name, email: user.email, emailVerified: Boolean(user.emailVerifiedAt), status: user.status.toLowerCase() }; }
}

