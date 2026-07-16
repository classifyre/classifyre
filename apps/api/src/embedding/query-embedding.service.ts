import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class QueryEmbeddingService {
  private readonly baseUrl = process.env.EMBEDDING_SERVER_URL?.replace(
    /\/$/,
    '',
  );

  async embed(text: string): Promise<number[]> {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException(
        'Semantic query embedding is unavailable; EMBEDDING_SERVER_URL is not configured',
      );
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: [text] }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Semantic query embedding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Semantic query embedding failed with HTTP ${response.status}`,
      );
    }
    const payload = (await response.json()) as { vectors?: number[][] };
    const vector = payload.vectors?.[0];
    if (!vector?.length) {
      throw new ServiceUnavailableException(
        'Embedding server returned no vector',
      );
    }
    return vector;
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
