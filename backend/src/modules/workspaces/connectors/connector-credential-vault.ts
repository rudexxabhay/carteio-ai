import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type EncryptedConnectorCredential = { ciphertext: Buffer; nonce: Buffer; authTag: Buffer; keyVersion: string };

@Injectable()
export class ConnectorCredentialVault {
  private decode(raw: string) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('Invalid key length');
    return key;
  }
  private key(version?: string): { bytes: Buffer; version: string } {
    const raw = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY ?? '';
    const currentVersion = process.env.CONNECTOR_CREDENTIAL_KEY_VERSION ?? 'v1';
    if (!raw) throw new ServiceUnavailableException({ code: 'CONNECTOR_CREDENTIAL_VAULT_UNAVAILABLE', message: 'Connector credential encryption is not configured.' });
    try {
      if (!/^[A-Za-z0-9._-]{1,32}$/.test(currentVersion)) throw new Error('Invalid version');
      if (!version || version === currentVersion) return { bytes: this.decode(raw), version: currentVersion };
      const old = JSON.parse(process.env.CONNECTOR_CREDENTIAL_PREVIOUS_KEYS ?? '{}') as Record<string, string>;
      if (!old[version]) throw new Error('Missing historical key');
      return { bytes: this.decode(old[version]!), version };
    } catch {
      throw new ServiceUnavailableException({ code: 'CONNECTOR_CREDENTIAL_KEY_VERSION_UNAVAILABLE', message: 'The key version required by this connector credential is not configured.' });
    }
  }

  encrypt(value: Record<string, unknown>, associatedData: string): EncryptedConnectorCredential {
    const { bytes, version } = this.key();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', bytes, nonce);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag(), keyVersion: version };
  }

  decrypt(record: EncryptedConnectorCredential, associatedData: string): Record<string, unknown> {
    const { bytes } = this.key(record.keyVersion);
    try {
      const decipher = createDecipheriv('aes-256-gcm', bytes, record.nonce);
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(record.authTag);
      const plaintext = Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString('utf8');
      const parsed: unknown = JSON.parse(plaintext);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid credential shape');
      return parsed as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException({ code: 'CONNECTOR_CREDENTIAL_DECRYPTION_FAILED', message: 'Connector credentials could not be decrypted.' });
    }
  }
}
