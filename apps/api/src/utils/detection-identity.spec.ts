import {
  generateDetectionIdentity,
  hashIdentityKey,
} from './detection-identity';

describe('generateDetectionIdentity', () => {
  it('should generate consistent hash for same input', () => {
    const input = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_abc123',
    };

    const hash1 = generateDetectionIdentity(input);
    const hash2 = generateDetectionIdentity(input);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it('should normalize whitespace and case', () => {
    const input1 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: '  sk_test_abc123  ',
    };

    const input2 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'SK_TEST_ABC123',
    };

    const hash1 = generateDetectionIdentity(input1);
    const hash2 = generateDetectionIdentity(input2);

    expect(hash1).toBe(hash2);
  });

  it('should differentiate by findingType', () => {
    const input1 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_abc123',
    };

    const input2 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'API_KEY',
      matchedContent: 'sk_test_abc123',
    };

    const hash1 = generateDetectionIdentity(input1);
    const hash2 = generateDetectionIdentity(input2);

    expect(hash1).not.toBe(hash2);
  });

  it('should differentiate by assetId', () => {
    const input1 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_abc123',
    };

    const input2 = {
      assetId: 'asset-456',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_abc123',
    };

    const hash1 = generateDetectionIdentity(input1);
    const hash2 = generateDetectionIdentity(input2);

    expect(hash1).not.toBe(hash2);
  });

  it('should differentiate by matchedContent', () => {
    const input1 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_abc123',
    };

    const input2 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_xyz789',
    };

    const hash1 = generateDetectionIdentity(input1);
    const hash2 = generateDetectionIdentity(input2);

    expect(hash1).not.toBe(hash2);
  });

  it('should differentiate by detectorType', () => {
    const input1 = {
      assetId: 'asset-123',
      detectorType: 'SECRETS',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_abc123',
    };

    const input2 = {
      assetId: 'asset-123',
      detectorType: 'CUSTOM',
      findingType: 'SECRET_KEY',
      matchedContent: 'sk_test_abc123',
    };

    expect(generateDetectionIdentity(input1)).not.toBe(
      generateDetectionIdentity(input2),
    );
  });

  it('should differentiate by customDetectorKey for custom detections', () => {
    const input1 = {
      assetId: 'asset-123',
      detectorType: 'CUSTOM',
      customDetectorKey: 'cust_alpha',
      findingType: 'class:risk_term',
      matchedContent: 'contract penalty clause',
    };

    const input2 = {
      assetId: 'asset-123',
      detectorType: 'CUSTOM',
      customDetectorKey: 'cust_beta',
      findingType: 'class:risk_term',
      matchedContent: 'contract penalty clause',
    };

    expect(generateDetectionIdentity(input1)).not.toBe(
      generateDetectionIdentity(input2),
    );
  });

  describe('identityKey (contract C1)', () => {
    const base = {
      assetId: 'asset-123',
      detectorType: 'CUSTOM',
      customDetectorKey: 'de_dq_totals',
      findingType: 'total_mismatch',
    };

    it('keeps one identity when the value text changes', () => {
      const run1 = generateDetectionIdentity({
        ...base,
        matchedContent: 'total 523 != 520',
        identityKey: 'row-17',
      });
      const run2 = generateDetectionIdentity({
        ...base,
        matchedContent: 'total 524 != 520',
        identityKey: 'row-17',
      });
      expect(run1).toBe(run2);
    });

    it('separates rows by their identity', () => {
      expect(
        generateDetectionIdentity({
          ...base,
          matchedContent: 'x',
          identityKey: 'row-17',
        }),
      ).not.toBe(
        generateDetectionIdentity({
          ...base,
          matchedContent: 'x',
          identityKey: 'row-18',
        }),
      );
    });

    it('leaves identities without a key unchanged', () => {
      const withoutKey = generateDetectionIdentity({
        ...base,
        matchedContent: 'Total 523',
      });
      expect(
        generateDetectionIdentity({
          ...base,
          matchedContent: 'Total 523',
          identityKey: null,
        }),
      ).toBe(withoutKey);
      expect(
        generateDetectionIdentity({
          ...base,
          matchedContent: 'Total 523',
          identityKey: '  ',
        }),
      ).toBe(withoutKey);
    });

    it('never collides with a content key spelling the identity', () => {
      expect(
        generateDetectionIdentity({ ...base, matchedContent: 'id:row-17' }),
      ).not.toBe(
        generateDetectionIdentity({
          ...base,
          matchedContent: 'anything',
          identityKey: 'row-17',
        }),
      );
    });

    it('hashes an overlong identity key instead of truncating it', () => {
      const long = `row-${'1'.repeat(300)}`;
      expect(hashIdentityKey(long)).toHaveLength(64);
      expect(hashIdentityKey(long)).toBe(hashIdentityKey(long));
      expect(hashIdentityKey('row-17')).toBe('row-17');
      // Same finding either way: the CLI hashes with the same function.
      expect(
        generateDetectionIdentity({
          ...base,
          matchedContent: 'x',
          identityKey: long,
        }),
      ).toBe(
        generateDetectionIdentity({
          ...base,
          matchedContent: 'y',
          identityKey: long,
        }),
      );
    });
  });
});
