import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/** One coordinate system this workspace holds vectors in. */
export interface EmbeddingSpaceStats {
  id: string;
  provider: string;
  model: string;
  revision: string;
  dimensions: number;
  pooling: string;
  normalized: boolean;
  isActive: boolean;
  vectors: number;
  createdAt: string;
  lastRecalibratedAt: string | null;
}

export interface EmbeddingStats {
  spaces: EmbeddingSpaceStats[];
  /** Vectors in the active space. */
  vectors: number;
  /** Vectors across every space, which is what actually occupies the disk. */
  vectorsAllSpaces: number;
  /** Bytes held by the vector table and its indexes. */
  storageBytes: number | null;
  /** Bytes held by the ranking table derived from those vectors. */
  analysisStorageBytes: number | null;
  /** Text chunks eligible for embedding. */
  chunks: number;
  /** Findings carrying embeddable evidence text. */
  embeddableFindings: number;
  /** Findings with a ranking score derived from the active space. */
  rankedFindings: number;
}

/**
 * Size and coverage of the embedding corpus.
 *
 * Deliberately separate from the queue's status: that reports what the
 * pipeline is doing right now (jobs pending, worker health), while this
 * reports what exists on disk. An operator deciding whether to change models
 * needs the second one — "this will delete 4.2 GB and re-embed 1.1M chunks" is
 * the number that makes the decision, and it was previously unavailable
 * anywhere in the product.
 */
@Injectable()
export class EmbeddingStatsService {
  private readonly logger = new Logger(EmbeddingStatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collect(activeSpaceId?: string): Promise<EmbeddingStats> {
    const empty: EmbeddingStats = {
      spaces: [],
      vectors: 0,
      vectorsAllSpaces: 0,
      storageBytes: null,
      analysisStorageBytes: null,
      chunks: 0,
      embeddableFindings: 0,
      rankedFindings: 0,
    };

    try {
      // Read in parallel rather than in a transaction: these are independent
      // counters for a status panel, and wrapping them would hold a connection
      // from a pool that ingestion is already competing for.
      const [spaces, perSpace, sizes, chunks, embeddable, ranked] =
        await Promise.all([
          this.prisma.embeddingSpace.findMany({
            orderBy: { createdAt: 'desc' },
          }),
          this.vectorsPerSpace(),
          this.sizes(),
          this.prisma.assetChunk.count(),
          this.prisma.finding.count({
            where: { embedContentHash: { not: null } },
          }),
          activeSpaceId
            ? this.prisma.findingEvidenceAnalysis.count({
                where: { spaceId: activeSpaceId },
              })
            : Promise.resolve(0),
        ]);

      const spaceStats: EmbeddingSpaceStats[] = spaces.map((space) => ({
        id: space.id,
        provider: space.provider,
        model: space.model,
        revision: space.revision,
        dimensions: space.dim,
        pooling: space.pooling,
        normalized: space.normalized,
        isActive: space.isActive,
        vectors: perSpace.get(space.id) ?? 0,
        createdAt: space.createdAt.toISOString(),
        lastRecalibratedAt: space.lastRecalibratedAt?.toISOString() ?? null,
      }));

      return {
        spaces: spaceStats,
        vectors: activeSpaceId ? (perSpace.get(activeSpaceId) ?? 0) : 0,
        vectorsAllSpaces: [...perSpace.values()].reduce((a, b) => a + b, 0),
        storageBytes: sizes.embeddings,
        analysisStorageBytes: sizes.analyses,
        chunks,
        embeddableFindings: embeddable,
        rankedFindings: ranked,
      };
    } catch (error) {
      // A status panel must never be the thing that fails a settings page.
      this.logger.warn(
        `Embedding stats unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return empty;
    }
  }

  private async vectorsPerSpace(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ space_id: string; count: bigint }>
    >`
      SELECT space_id, count(*)::bigint AS count
      FROM content_embeddings
      GROUP BY space_id
    `;
    return new Map(rows.map((row) => [row.space_id, Number(row.count)]));
  }

  /**
   * On-disk size including indexes — for vectors the HNSW index is routinely
   * larger than the rows it covers, so table size alone understates it badly.
   */
  private async sizes(): Promise<{
    embeddings: number | null;
    analyses: number | null;
  }> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ embeddings: bigint; analyses: bigint }>
      >`
        SELECT
          pg_total_relation_size(
            (quote_ident(current_schema()) || '.content_embeddings')::regclass
          )::bigint AS embeddings,
          pg_total_relation_size(
            (quote_ident(current_schema()) || '.finding_evidence_analyses')::regclass
          )::bigint AS analyses
      `;
      const row = rows[0];
      return {
        embeddings: row ? Number(row.embeddings) : null,
        analyses: row ? Number(row.analyses) : null,
      };
    } catch {
      return { embeddings: null, analyses: null };
    }
  }
}
