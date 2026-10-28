import { ConnectorCredentialVault } from './connector-credential-vault';

describe('ConnectorCredentialVault', () => {
  const originalKey = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  const originalVersion = process.env.CONNECTOR_CREDENTIAL_KEY_VERSION;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY; else process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = originalKey;
    if (originalVersion === undefined) delete process.env.CONNECTOR_CREDENTIAL_KEY_VERSION; else process.env.CONNECTOR_CREDENTIAL_KEY_VERSION = originalVersion;
  });

  it('encrypts credentials with unique nonces and decrypts only with matching authenticated context', () => {
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.CONNECTOR_CREDENTIAL_KEY_VERSION = 'test-v1';
    const vault = new ConnectorCredentialVault(), value = { apiToken: 'never-return-this' }, aad = 'tenant:connector:one';
    const first = vault.encrypt(value, aad), second = vault.encrypt(value, aad);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toContain(value.apiToken);
    expect(vault.decrypt(first, aad)).toEqual(value);
    expect(() => vault.decrypt(first, 'tenant:connector:two')).toThrow();
  });

  it('fails closed when the encryption key is missing', () => {
    delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
    const vault = new ConnectorCredentialVault();
    expect(() => vault.encrypt({ apiToken: 'secret' }, 'aad')).toThrow();
  });
});
