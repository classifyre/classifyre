import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingConfigService } from './embedding-config.service';

@Injectable()
export class QueryEmbeddingService {
  constructor(
    private readonly provider?: EmbeddingProviderService,
    private readonly config: EmbeddingConfigService = new EmbeddingConfigService(),
  ) {}

  async embed(text: string): Promise<number[]> {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException(
        'Semantic query embedding is disabled by EMBEDDING_ENABLED=false',
      );
    }
    try {
      if (!this.provider) throw new Error('embedding provider is unavailable');
      const vector = (await this.provider.embedMany([text]))[0];
      if (!vector?.length) throw new Error('provider returned no vector');
      return vector;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Semantic query embedding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async embedIfAvailable(text: string): Promise<number[] | null> {
    try {
      return await this.embed(text);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        return null;
      }
      throw error;
    }
  }
}
