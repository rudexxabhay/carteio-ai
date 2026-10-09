import { Injectable, Logger } from '@nestjs/common';

export interface TransactionalEmailProvider {
  readonly available: boolean;
  send(to: string, subject: string, text: string): Promise<boolean>;
}

@Injectable()
export class ResendEmailProvider implements TransactionalEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  get available(): boolean { return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.AUTH_EMAIL_FROM?.trim()); }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.AUTH_EMAIL_FROM;
    if (!key?.trim() || !from?.trim()) return false;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) { this.logger.warn(`Transactional email provider rejected delivery (status ${response.status})`); return false; }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) { this.logger.warn('Transactional email provider returned an unsupported response'); return false; }
      const payload: unknown = await response.json().catch(() => null);
      return typeof payload === 'object' && payload !== null && 'id' in payload && typeof payload.id === 'string' && payload.id.length > 0;
    } catch {
      this.logger.warn('Transactional email provider request failed');
      return false;
    }
  }
}

@Injectable()
export class EmailService {
  constructor(private readonly provider: ResendEmailProvider) {}
  get available(): boolean { return this.provider.available; }
  send(to: string, subject: string, text: string): Promise<boolean> { return this.provider.send(to, subject, text); }
}
