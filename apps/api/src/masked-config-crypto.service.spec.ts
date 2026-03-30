import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import { MASKED_CONFIG_ENCRYPTED_PREFIX } from './utils/masked-config.utils';

describe('MaskedConfigCryptoService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.CLASSIFYRE_MASKED_CONFIG_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('encrypts and decrypts masked fields recursively', () => {
    const service = new MaskedConfigCryptoService();
    const config = {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      masked: {
        username: 'postgres',
        password: 'super-secret-password',
        nested: {
          api_token: 'token-123',
        },
      },
    };

    const encrypted = service.encryptMaskedConfig(config);
    const encryptedPassword = (encrypted.masked as Record<string, unknown>)
      .password as string;
    expect(encryptedPassword.startsWith(MASKED_CONFIG_ENCRYPTED_PREFIX)).toBe(
      true,
    );

    const decrypted = service.decryptMaskedConfig(encrypted);
    expect(decrypted).toEqual(config);
  });

  it('keeps existing encrypted values unchanged during encrypt pass', () => {
    const service = new MaskedConfigCryptoService();
    const firstEncrypted = service.encryptMaskedConfig({
      type: 'SLACK',
      required: { workspace: 'acme' },
      masked: {
        bot_token: 'xoxb-initial',
      },
    });

    const secondEncrypted = service.encryptMaskedConfig(firstEncrypted);
    expect(secondEncrypted).toEqual(firstEncrypted);
  });

  it('preserves non-encrypted values on decrypt pass', () => {
    const service = new MaskedConfigCryptoService();
    const config = {
      type: 'WORDPRESS',
      required: { url: 'https://example.com' },
      masked: {
        username: 'admin',
        application_password: 'plain-password',
      },
    };

    expect(service.decryptMaskedConfig(config)).toEqual(config);
  });

  it('decrypts encrypted empty masked strings', () => {
    const service = new MaskedConfigCryptoService();
    const config = {
      type: 'S3_COMPATIBLE_STORAGE',
      required: { bucket: 'bucket' },
      masked: {
        aws_session_token: '',
      },
    };

    const encrypted = service.encryptMaskedConfig(config);
    expect(service.decryptMaskedConfig(encrypted)).toEqual(config);
  });

  it('throws on malformed encrypted value markers', () => {
    const service = new MaskedConfigCryptoService();
    const malformedConfig = {
      type: 'SLACK',
      required: { workspace: 'acme' },
      masked: {
        bot_token: `${MASKED_CONFIG_ENCRYPTED_PREFIX}invalid`,
      },
    };

    expect(() => service.decryptMaskedConfig(malformedConfig)).toThrow(
      'Malformed encrypted masked value',
    );
  });
});
