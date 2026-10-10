import { Module, type DynamicModule } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionGuard } from './auth-session.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { EmailService, ResendEmailProvider } from './email.service';
import { GoogleTokenVerifier } from './google-token-verifier';
@Module({})
export class AuthModule {
  static register(databaseModule: DynamicModule): DynamicModule {
    return {
      module: AuthModule,
      imports: [databaseModule],
      controllers: [AuthController],
      providers: [AuthService, AuthSessionGuard, AuthRateLimitGuard, EmailService, ResendEmailProvider, GoogleTokenVerifier],
      exports: [AuthSessionGuard, AuthService],
    };
  }
}
