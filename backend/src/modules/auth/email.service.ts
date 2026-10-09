import { Injectable, Logger } from '@nestjs/common';

export interface TransactionalEmailProvider {
  readonly available: boolean;
  send(to: string, subject: string, text: string, requestId?: string): Promise<boolean>;
}

const isPlaceholder = (value: string) => /^(YOUR_|GENERATE_|CHANGE_ME|PLACEHOLDER)/i.test(value.trim());

@Injectable()
export class ResendEmailProvider implements TransactionalEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  get available(): boolean { return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.AUTH_EMAIL_FROM?.trim() && !isPlaceholder(process.env.RESEND_API_KEY) && !isPlaceholder(process.env.AUTH_EMAIL_FROM)); }

  async send(to: string, subject: string, text: string, requestId?: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    const diagnostic = (event: string, stage: string, statusCode?: number) => this.logger.warn(JSON.stringify({ event: requestId ? event : event.replace(/^OTP_/, ''), requestId: requestId ?? 'unknown', stage, ...(statusCode ? { statusCode } : {}) }));
    if (!key?.trim() || !from?.trim() || isPlaceholder(key) || isPlaceholder(from)) { diagnostic('OTP_CONFIGURATION_ERROR', 'resend_credentials'); return false; }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) { diagnostic('OTP_EMAIL_PROVIDER_ERROR', 'http_rejection', response.status); return false; }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) { diagnostic('OTP_EMAIL_PROVIDER_ERROR', 'response_content_type'); return false; }
      const payload: unknown = await response.json().catch(() => null);
      const accepted = typeof payload === 'object' && payload !== null && 'id' in payload && typeof payload.id === 'string' && payload.id.length > 0;
      if (!accepted) diagnostic('OTP_EMAIL_PROVIDER_ERROR', 'response_validation');
      return accepted;
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      diagnostic(timedOut ? 'OTP_EMAIL_PROVIDER_TIMEOUT' : 'OTP_EMAIL_PROVIDER_ERROR', timedOut ? 'request_timeout' : 'request_failed');
      return false;
    }
  }
}

@Injectable()
export class EmailService {
  constructor(private readonly provider: ResendEmailProvider) {}
  get available(): boolean { return this.provider.available; }
  send(to: string, subject: string, text: string, requestId?: string): Promise<boolean> { return this.provider.send(to, subject, text, requestId); }
}
