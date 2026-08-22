import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingConfigService } from './embedding-config.service';
import {
  resolvedFromEnv,
  // A value import, not `import type`: see embedding.service.ts — a type-only
  // import erases the binding before design:paramtypes is emitted, and an
  // @Optional() parameter Nest cannot resolve is silently injected as
  // undefined.
  EmbeddingSettingsService,
} from './embedding-settings.service';

@Injectable()
export class QueryEmbeddingService {
  constructor(
    private readonly provider?: EmbeddingProviderService,
    private readonly config: EmbeddingConfigService = new EmbeddingConfigService(),
    @Optional() private readonly settings?: EmbeddingSettingsService,
  ) {}

  async embed(text: string): Promise<number[]> {
    // A query has to be embedded in the same coordinate system the corpus was,
    // so this resolves the workspace's configuration rather than the
    // deployment's.
    const cfg =
      (await this.settings?.resolve()) ?? resolvedFromEnv(this.config);
    if (!cfg.enabled) {
      throw new ServiceUnavailableException(
        'Semantic search is turned off for this workspace',
      );
    }
    try {
      if (!this.provider) throw new Error('embedding provider is unavailable');
      const vector = (await this.provider.embedMany([text], cfg))[0];
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
