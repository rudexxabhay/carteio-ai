'use strict';

// Test-only guard. Provider/Shopify/crawler calls must be mocked before use.
// Blocking sockets also catches clients that bypass fetch (including DB drivers).
const deny = () => {
  const error = new Error('PHASE00_NETWORK_BLOCKED: use a deterministic fixture; live network access is forbidden');
  error.code = 'PHASE00_NETWORK_BLOCKED';
  throw error;
};

globalThis.fetch = async () => deny();
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  transport.request = deny;
  transport.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;

