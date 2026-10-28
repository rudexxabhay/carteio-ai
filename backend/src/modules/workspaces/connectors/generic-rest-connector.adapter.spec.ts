import { createHmac } from 'node:crypto';
import { GenericRestConnectorAdapter } from './generic-rest-connector.adapter';

describe('GenericRestConnectorAdapter signed webhook gate', () => {
  const adapter = new GenericRestConnectorAdapter({} as any);
  it('accepts a timestamp-bound signature and rejects a tampered body', async () => {
    const timestamp = Math.floor(Date.now() / 1000), secret = 's'.repeat(32), rawBody = Buffer.from('{"event":"health"}');
    const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
    const input = { eventId: 'event-1', eventType: 'health', timestamp, rawBody, payload: { event: 'health' } };
    expect(await adapter.verifyWebhook({ organizationId: 'tenant', connectorInstanceId: 'connector' }, input, { 'x-connector-signature': signature }, {}, { webhookSecret: secret })).toBe(true);
    expect(await adapter.verifyWebhook({ organizationId: 'tenant', connectorInstanceId: 'connector' }, { ...input, rawBody: Buffer.from('tampered') }, { 'x-connector-signature': signature }, {}, { webhookSecret: secret })).toBe(false);
  });
});
