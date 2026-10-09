import { IsEmail, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SignupDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsEmail() @MaxLength(320) email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
export class LoginDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsEmail() @MaxLength(320) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class EmailDto { @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsEmail() @MaxLength(320) email!: string; }
export class TokenDto { @IsString() @MinLength(32) @MaxLength(256) token!: string; }
export class ResetPasswordDto extends TokenDto { @IsString() @MinLength(12) @MaxLength(128) password!: string; }
export class GoogleTokenDto { @IsString() @MinLength(20) @MaxLength(8192) credential!: string; }
export class OtpRequestDto extends EmailDto {}
export class OtpVerifyDto extends EmailDto {
  @IsUUID() challengeId!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
