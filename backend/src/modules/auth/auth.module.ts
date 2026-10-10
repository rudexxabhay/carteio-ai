import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionGuard } from './auth-session.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { EmailService, ResendEmailProvider } from './email.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { GoogleTokenVerifier } from './google-token-verifier';
@Module({ controllers: [AuthController], providers: [AuthService, AuthSessionGuard, AuthRateLimitGuard, EmailService, ResendEmailProvider, GoogleTokenVerifier, PrismaService], exports: [AuthSessionGuard, PrismaService] })
export class AuthModule {}
