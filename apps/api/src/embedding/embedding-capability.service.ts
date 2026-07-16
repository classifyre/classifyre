import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class EmbeddingCapabilityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddingCapabilityService.name);
  private vectorAvailable = false;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS available
    `;
    this.vectorAvailable = rows[0]?.available === true;
    this.logger.log(
      this.vectorAvailable
        ? 'pgvector available: semantic queries use HNSW with exact-filter fallback'
        : 'pgvector unavailable: semantic queries use portable exact cosine scans',
    );
  }

  hasVector(): boolean {
    return this.vectorAvailable;
  }
}
