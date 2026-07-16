import { ServiceUnavailableException } from '@nestjs/common';
import { QueryEmbeddingService } from './query-embedding.service';

describe('QueryEmbeddingService', () => {
  it('lets hybrid callers degrade when the configured provider fails', async () => {
    const service = new QueryEmbeddingService({
      embedMany: jest.fn().mockRejectedValue(new Error('provider offline')),
    } as never);

    await expect(service.embedIfAvailable('docket')).resolves.toBeNull();
    await expect(service.embed('docket')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
