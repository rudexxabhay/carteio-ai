const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./offline.cjs');

test('Phase 00 refuses unmocked provider fetches', async () => {
  await assert.rejects(fetch('https://provider.invalid'), { code: 'PHASE00_NETWORK_BLOCKED' });
});

test('Phase 00 refuses unmocked Shopify HTTP clients', () => {
  assert.throws(() => require('node:https').request('https://shop.invalid'), { code: 'PHASE00_NETWORK_BLOCKED' });
});

test('Phase 00 refuses socket clients including live database drivers', () => {
  const socket = new (require('node:net').Socket)();
  assert.throws(() => socket.connect(5432, 'database.invalid'), { code: 'PHASE00_NETWORK_BLOCKED' });
  socket.destroy();
});
