import { Injectable } from '@nestjs/common';

export type SupportDeliveryResult = { state: 'SENT' | 'DELIVERED' | 'FAILED' | 'UNSUPPORTED_CHANNEL'; retryable?: boolean; transportEventId?: string; detailCode?: string };
export interface SupportChannelAdapter {
  deliver(message: { id: string; content: string; conversationId: string }): Promise<SupportDeliveryResult>;
}

/** Durable ticket outbox transport boundary. No Phase 13 customer channel is connected yet. */
@Injectable()
export class SupportDeliveryService {
  private readonly adapters = new Map<string, SupportChannelAdapter>();

  /** Trusted in-process registration point for supported channel modules. */
  register(channel: string, adapter: SupportChannelAdapter) {
    if (!/^[A-Z0-9_-]{2,32}$/.test(channel)) throw new Error('Invalid support channel adapter key');
    this.adapters.set(channel, adapter);
  }

  supportedChannels() { return [...this.adapters.keys()]; }

  async deliver(channel: string, message: { id: string; content: string; conversationId: string }): Promise<SupportDeliveryResult> {
    const adapter = this.adapters.get(channel);
    if (adapter) return adapter.deliver(message);
    return { state: 'UNSUPPORTED_CHANNEL', detailCode: 'CHANNEL_TRANSPORT_NOT_CONFIGURED' };
  }
}
