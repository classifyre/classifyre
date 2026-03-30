import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  MASKED_CONFIG_ENCRYPTED_PREFIX,
  isEncryptedMaskedValue,
  transformMaskedConfig,
} from './utils/masked-config.utils';
import { resolveApplicationSecretKey } from './secret-key.util';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_BYTE_LENGTH = 12;

@Injectable()
export class MaskedConfigCryptoService {
  private readonly encryptionKey = resolveApplicationSecretKey();

  encryptMaskedConfig(
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    return transformMaskedConfig(config, (value) => this.encryptValue(value));
  }

  decryptMaskedConfig(
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    return transformMaskedConfig(config, (value) => this.decryptValue(value));
  }

  isEncryptedValue(value: unknown): value is string {
    return isEncryptedMaskedValue(value);
  }

  encryptString(value: string): string {
    return this.encryptValue(value);
  }

  decryptString(value: string): string {
    return this.decryptValue(value);
  }

  private encryptValue(value: string): string {
    if (this.isEncryptedValue(value)) {
      this.decryptValue(value);
      return value;
    }

    const iv = crypto.randomBytes(IV_BYTE_LENGTH);
    const cipher = crypto.createCipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const payload = [
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');

    return `${MASKED_CONFIG_ENCRYPTED_PREFIX}${payload}`;
  }

  private decryptValue(value: string): string {
    if (!this.isEncryptedValue(value)) {
      return value;
    }

    const payload = value.slice(MASKED_CONFIG_ENCRYPTED_PREFIX.length);
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted masked value');
    }
    const [ivPart, authTagPart, encryptedPart] = parts;
    if (!ivPart || !authTagPart || encryptedPart === undefined) {
      throw new Error('Malformed encrypted masked value');
    }

    const iv = Buffer.from(ivPart, 'base64url');
    const authTag = Buffer.from(authTagPart, 'base64url');
    const encrypted = Buffer.from(encryptedPart, 'base64url');

    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      iv,
    );
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
