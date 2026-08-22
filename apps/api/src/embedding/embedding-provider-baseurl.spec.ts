import { normalizeEmbeddingBaseUrl } from './embedding-provider.service';

/**
 * Every provider's documentation shows the complete endpoint in its curl
 * example, so the complete endpoint is what people paste. The AI SDK appends
 * `/embeddings` to the base it is given, and the resulting
 * `/v1/embeddings/embeddings` came back as a 404 that the UI explained as
 * "check that the model name is an embeddings model for this endpoint" —
 * pointing the one person who could fix it at the one thing that was right.
 */
describe('normalizeEmbeddingBaseUrl', () => {
  it.each([
    [
      'https://integrate.api.nvidia.com/v1',
      'https://integrate.api.nvidia.com/v1',
    ],
    [
      'https://integrate.api.nvidia.com/v1/embeddings',
      'https://integrate.api.nvidia.com/v1',
    ],
    [
      'https://integrate.api.nvidia.com/v1/embeddings/',
      'https://integrate.api.nvidia.com/v1',
    ],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    ['  https://host/v1  ', 'https://host/v1'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeEmbeddingBaseUrl(input)).toBe(expected);
  });

  it('is undefined when there is nothing at all, so the caller can say so', () => {
    expect(normalizeEmbeddingBaseUrl(undefined)).toBeUndefined();
    expect(normalizeEmbeddingBaseUrl('   ')).toBeUndefined();
  });
});
