import {
  MASKED_CONFIG_ENCRYPTED_PREFIX,
  isEncryptedMaskedValue,
  stableStringify,
  transformMaskedConfig,
} from './masked-config.utils';

describe('masked-config.utils', () => {
  describe('transformMaskedConfig', () => {
    it('transforms only masked string leaves', () => {
      const config = {
        type: 'SLACK',
        required: { workspace: 'acme' },
        masked: {
          bot_token: 'xoxb-token',
          nested: {
            refresh_token: 'refresh-token',
          },
          array_tokens: ['token-a', 'token-b'],
          unchanged_number: 42,
        },
      };

      const transformed = transformMaskedConfig(
        config,
        (value) => `enc:${value}`,
      );

      expect(transformed.required).toEqual(config.required);
      expect(transformed.masked).toEqual({
        bot_token: 'enc:xoxb-token',
        nested: {
          refresh_token: 'enc:refresh-token',
        },
        array_tokens: ['enc:token-a', 'enc:token-b'],
        unchanged_number: 42,
      });
    });

    it('returns a shallow clone when masked field is missing', () => {
      const config = {
        type: 'POSTGRESQL',
        required: { host: 'db.local', port: 5432 },
      };

      const transformed = transformMaskedConfig(
        config,
        (value) => `enc:${value}`,
      );

      expect(transformed).toEqual(config);
      expect(transformed).not.toBe(config);
    });
  });

  describe('isEncryptedMaskedValue', () => {
    it('detects versioned encrypted values', () => {
      expect(
        isEncryptedMaskedValue(`${MASKED_CONFIG_ENCRYPTED_PREFIX}payload`),
      ).toBe(true);
      expect(isEncryptedMaskedValue('plain-text')).toBe(false);
      expect(isEncryptedMaskedValue(null)).toBe(false);
    });
  });

  describe('stableStringify', () => {
    it('produces order-independent object serialization', () => {
      const left = {
        type: 'WORDPRESS',
        required: {
          url: 'https://example.com',
        },
        masked: {
          username: 'admin',
        },
      };
      const right = {
        masked: {
          username: 'admin',
        },
        required: {
          url: 'https://example.com',
        },
        type: 'WORDPRESS',
      };

      expect(stableStringify(left)).toBe(stableStringify(right));
    });
  });
});
