import { ServiceUnavailableException } from '@nestjs/common';
import { QueryEmbeddingService } from './query-embedding.service';

describe('QueryEmbeddingService', () => {
  const originalUrl = process.env.EMBEDDING_SERVER_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.EMBEDDING_SERVER_URL;
    } else {
      process.env.EMBEDDING_SERVER_URL = originalUrl;
    }
  });

  it('lets hybrid callers degrade when the sidecar is unavailable', async () => {
    delete process.env.EMBEDDING_SERVER_URL;
    const service = new QueryEmbeddingService();

    await expect(service.embedIfAvailable('docket')).resolves.toBeNull();
    await expect(service.embed('docket')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
