import { generateDetectionIdentity } from './detection-identity';

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
});
