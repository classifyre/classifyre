import {
  ENCRYPTED_CONFIG_PATHS,
  MASKED_CONFIG_ENCRYPTED_PREFIX,
  isEncryptedMaskedValue,
  mergeEncryptedConfigs,
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

  describe('augmentation secrets', () => {
    it('lists both encrypted paths', () => {
      expect([...ENCRYPTED_CONFIG_PATHS]).toEqual([
        'masked',
        'augmentation.secrets',
      ]);
    });

    it('transforms leaves under both encrypted paths', () => {
      const config = {
        type: 'POSTGRESQL',
        required: { host: 'db.local' },
        masked: { password: 'pw' },
        augmentation: {
          enabled: true,
          notebook: { revision: 1, cells: [] },
          secrets: { enrichment_api_token: 'tok' },
          variables: { base_url: 'https://example.com' },
        },
      };

      const transformed = transformMaskedConfig(
        config,
        (value) => `enc:${value}`,
      );

      expect(transformed.masked).toEqual({ password: 'enc:pw' });
      const augmentation = transformed.augmentation as Record<string, unknown>;
      expect(augmentation['secrets']).toEqual({
        enrichment_api_token: 'enc:tok',
      });
      // Everything else rides through untouched.
      expect(augmentation['variables']).toEqual({
        base_url: 'https://example.com',
      });
      expect(augmentation['notebook']).toEqual({ revision: 1, cells: [] });
      expect(transformed.required).toEqual({ host: 'db.local' });
    });

    it('round-trips both paths through encrypt and decrypt', () => {
      const config = {
        masked: { password: 'pw' },
        augmentation: { enabled: true, secrets: { token: 'tok' } },
      };
      const encrypted = transformMaskedConfig(
        config,
        (value) => `${MASKED_CONFIG_ENCRYPTED_PREFIX}${value}`,
      );
      expect(
        isEncryptedMaskedValue(
          (encrypted.masked as Record<string, string>)['password'],
        ),
      ).toBe(true);
      const decrypted = transformMaskedConfig(encrypted, (value) =>
        value.startsWith(MASKED_CONFIG_ENCRYPTED_PREFIX)
          ? value.slice(MASKED_CONFIG_ENCRYPTED_PREFIX.length)
          : value,
      );
      expect(decrypted).toEqual(config);
    });
  });

  describe('mergeEncryptedConfigs', () => {
    it('merges write-only secrets on every encrypted path', () => {
      const existing = {
        type: 'POSTGRESQL',
        masked: { password: `${MASKED_CONFIG_ENCRYPTED_PREFIX}old` },
        augmentation: {
          enabled: true,
          secrets: { token: `${MASKED_CONFIG_ENCRYPTED_PREFIX}old` },
        },
      };
      const incoming = {
        type: 'POSTGRESQL',
        masked: {},
        augmentation: { enabled: true, secrets: { token: 'fresh' } },
      };
      const merged = mergeEncryptedConfigs(existing, incoming);
      // Untouched leaves keep the stored ciphertext; supplied ones overwrite.
      expect((merged.masked as Record<string, string>)['password']).toBe(
        `${MASKED_CONFIG_ENCRYPTED_PREFIX}old`,
      );
      expect(
        (merged.augmentation as Record<string, { token: string }>)['secrets'],
      ).toEqual({ token: 'fresh' });
    });

    it('deletes a secret set to null on the augmentation path', () => {
      const existing = {
        augmentation: {
          secrets: { token: `${MASKED_CONFIG_ENCRYPTED_PREFIX}old` },
        },
      };
      const merged = mergeEncryptedConfigs(existing, {
        augmentation: { secrets: { token: null } },
      });
      expect(
        (merged.augmentation as Record<string, unknown>)['secrets'],
      ).toEqual({});
    });

    it('adds no augmentation key when neither side has one', () => {
      const merged = mergeEncryptedConfigs(
        { type: 'SLACK' },
        { type: 'SLACK', masked: {} },
      );
      expect(merged).not.toHaveProperty('augmentation');
      // `masked` keeps its historical always-present shape.
      expect(merged).toHaveProperty('masked');
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
