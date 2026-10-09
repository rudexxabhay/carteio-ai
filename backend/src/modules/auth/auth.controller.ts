import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, sessionCookieName } from './auth.service';
import { EmailDto, GoogleTokenDto, LoginDto, OtpRequestDto, OtpVerifyDto, ResetPasswordDto, SignupDto, TokenDto } from './auth.dto';
import { AuthSessionGuard, getCookie } from './auth-session.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

export const sessionCookieOptions = (maxAge?: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/', ...(maxAge ? { maxAge } : {}) });
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('signup') @UseGuards(AuthRateLimitGuard) signup(@Body() body: SignupDto) { return this.auth.signup(body); }
  @Post('login') @HttpCode(200) @UseGuards(AuthRateLimitGuard) async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.email, body.password, getCookie(req, sessionCookieName()));
    res.cookie(sessionCookieName(), result.token, sessionCookieOptions(result.expiresAt.getTime() - Date.now()));
    return { user: result.user };
  }
  @Post('google') @HttpCode(200) @UseGuards(AuthRateLimitGuard) async google(@Body() body: GoogleTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.googleLogin(body.credential, getCookie(req, sessionCookieName()));
    res.cookie(sessionCookieName(), result.token, sessionCookieOptions(result.expiresAt.getTime() - Date.now()));
    return { user: result.user };
  }
  @Post('google/link') @HttpCode(200) @UseGuards(AuthSessionGuard, AuthRateLimitGuard) linkGoogle(@Body() body: GoogleTokenDto, @Req() req: Request & { authSession?: { userId: string } }) {
    return this.auth.linkGoogle(req.authSession!.userId, body.credential);
  }
  @Post('otp/request') @HttpCode(200) @UseGuards(AuthRateLimitGuard) requestOtp(@Body() body: OtpRequestDto) { return this.auth.requestOtp(body.email); }
  @Post('otp/verify') @HttpCode(200) @UseGuards(AuthRateLimitGuard) async verifyOtp(@Body() body: OtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(body.email, body.challengeId, body.code, getCookie(req, sessionCookieName()));
    res.cookie(sessionCookieName(), result.token, sessionCookieOptions(result.expiresAt.getTime() - Date.now()));
    return { user: result.user };
  }
  @Get('me') @UseGuards(AuthSessionGuard) async me(@Req() req: Request & { authSession?: { user: unknown } }) { return { user: req.authSession?.user }; }
  @Post('logout') @HttpCode(200) async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = getCookie(req, sessionCookieName());
    if (token) {
      try { const session = await this.auth.current(token); await this.auth.logout(session.sessionId, session.user.id); }
      catch (error) { if (!(error instanceof UnauthorizedException)) throw error; }
    }
    res.clearCookie(sessionCookieName(), sessionCookieOptions()); return { status: 'logged_out' };
  }
  @Post('logout-all') @HttpCode(200) @UseGuards(AuthSessionGuard) async logoutAll(@Req() req: Request & { authSession?: { userId: string; sessionId: string } }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(req.authSession!.userId); res.clearCookie(sessionCookieName(), sessionCookieOptions()); return { status: 'logged_out' };
  }
  @Post('verify-email') @HttpCode(200) @UseGuards(AuthRateLimitGuard) verify(@Body() body: TokenDto) { return this.auth.verify(body.token); }
  @Post('resend-verification') @HttpCode(200) @UseGuards(AuthRateLimitGuard) resend(@Body() body: EmailDto) { return this.auth.resend(body.email); }
  @Post('forgot-password') @HttpCode(200) @UseGuards(AuthRateLimitGuard) forgot(@Body() body: EmailDto) { return this.auth.forgot(body.email); }
  @Post('reset-password') @HttpCode(200) @UseGuards(AuthRateLimitGuard) reset(@Body() body: ResetPasswordDto) { return this.auth.reset(body.token, body.password); }
}
