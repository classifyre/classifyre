import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { UnionFind } from '../utils/union-find';
import { EmbeddingCapabilityService } from './embedding-capability.service';
import { EmbeddingAnalysisService } from './embedding-analysis.service';
import {
  EmbeddingSpaceDto,
  PutAssetChunksDto,
  PutEmbeddingVectorsDto,
} from './dto/embedding.dto';

type SimilarityRow = { id: string; score: number };
type NeighborhoodRow = {
  findingId: string;
  targetHash: string;
  neighborHash: string;
  score: number;
};
type BoilerplateClusterRow = {
  groupHash: string;
  findingCount: bigint | number;
  findingIds: string[];
  meanImportance: number;
};

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capability: EmbeddingCapabilityService,
    private readonly analysis: EmbeddingAnalysisService,
  ) {}

  status() {
    return {
      enabled: true,
      pgvector: this.capability.hasVector(),
      searchStrategy: this.capability.hasVector()
        ? 'hnsw-with-exact-fallback'
        : 'exact-cosine',
    };
  }

  async ensureSpace(input: EmbeddingSpaceDto) {
    const existing = await this.prisma.embeddingSpace.findUnique({
      where: {
        model_revision_pooling_normalized: {
          model: input.model,
          revision: input.revision,
          pooling: input.pooling,
          normalized: input.normalized,
        },
      },
    });
    if (existing && existing.dim !== input.dim) {
      throw new BadRequestException(
        `Embedding space dimension changed from ${existing.dim} to ${input.dim}; use a new revision`,
      );
    }
    if (existing) {
      if (!existing.isActive) {
        await this.prisma.$transaction([
          this.prisma.embeddingSpace.updateMany({ data: { isActive: false } }),
          this.prisma.embeddingSpace.update({
            where: { id: existing.id },
            data: { isActive: true },
          }),
        ]);
      }
      return { ...existing, isActive: true };
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.embeddingSpace.updateMany({ data: { isActive: false } });
      return tx.embeddingSpace.create({ data: { ...input, isActive: true } });
    });
  }

  async missing(spaceInput: EmbeddingSpaceDto, hashes: string[]) {
    const space = await this.ensureSpace(spaceInput);
    const uniqueHashes = [...new Set(hashes)];
    const present = await this.prisma.contentEmbedding.findMany({
      where: { spaceId: space.id, contentHash: { in: uniqueHashes } },
      select: { contentHash: true },
    });
    const presentSet = new Set(present.map((item) => item.contentHash));
    if (presentSet.size) {
      const reusedFindings = await this.prisma.finding.findMany({
        where: { embedContentHash: { in: [...presentSet] } },
        select: { embedContentHash: true },
      });
      const reusedFindingHashes = [
        ...new Set(
          reusedFindings.flatMap((finding) =>
            finding.embedContentHash ? [finding.embedContentHash] : [],
          ),
        ),
      ];
      if (reusedFindingHashes.length) {
        await this.analysis.analyzeHashes(space.id, reusedFindingHashes);
        await this.calibrateNeighborhood(space.id, reusedFindingHashes);
      }
    }
    return {
      spaceId: space.id,
      missing: uniqueHashes.filter((hash) => !presentSet.has(hash)),
    };
  }

  async putVectors(dto: PutEmbeddingVectorsDto) {
    const space = await this.prisma.embeddingSpace.findUnique({
      where: { id: dto.spaceId },
    });
    if (!space)
      throw new NotFoundException(`Embedding space ${dto.spaceId} not found`);
    const invalid = dto.items.find((item) => item.vector.length !== space.dim);
    if (invalid) {
      throw new BadRequestException(
        `Vector ${invalid.contentHash} has ${invalid.vector.length} dimensions; expected ${space.dim}`,
      );
    }
    if (space.normalized) {
      const unnormalized = dto.items.find((item) => {
        const norm = Math.sqrt(
          item.vector.reduce((sum, value) => sum + value * value, 0),
        );
        return Math.abs(norm - 1) > 0.02;
      });
      if (unnormalized) {
        throw new BadRequestException(
          `Vector ${unnormalized.contentHash} is not normalized`,
        );
      }
    }

    const created = await this.prisma.contentEmbedding.createMany({
      data: dto.items.map((item) => ({
        id: randomUUID(),
        spaceId: dto.spaceId,
        contentHash: item.contentHash,
        vecF8: item.vector,
      })),
      skipDuplicates: true,
    });
    if (this.capability.hasVector() && dto.items.length) {
      const hashes = dto.items.map((item) => item.contentHash);
      await this.prisma.$executeRaw`
        UPDATE content_embeddings
        SET vec = (vec_f8::real[])::public.vector
        WHERE space_id = ${dto.spaceId}
          AND content_hash = ANY(${hashes}::text[])
          AND vec IS NULL
      `;
    }
    await this.analysis.analyzeHashes(
      dto.spaceId,
      dto.items.map((item) => item.contentHash),
    );
    await this.calibrateNeighborhood(
      dto.spaceId,
      dto.items.map((item) => item.contentHash),
    );
    return { created: created.count, received: dto.items.length };
  }

  private async calibrateNeighborhood(
    spaceId: string,
    contentHashes: string[],
  ) {
    if (!contentHashes.length) return;
    const rows = this.capability.hasVector()
      ? await this.prisma.$queryRaw<NeighborhoodRow[]>`
      SELECT target.id AS "findingId", target.embed_content_hash AS "targetHash",
        neighbor.content_hash AS "neighborHash",
        1 - (target_embedding.vec <=> neighbor.vec) AS score
      FROM findings target
      JOIN content_embeddings target_embedding
        ON target_embedding.content_hash = target.embed_content_hash
       AND target_embedding.space_id = ${spaceId}
      CROSS JOIN LATERAL (
        SELECT candidate.content_hash, candidate.vec
        FROM content_embeddings candidate
        WHERE candidate.space_id = ${spaceId}
          AND candidate.vec IS NOT NULL
          AND candidate.content_hash != target.embed_content_hash
          AND EXISTS (
            SELECT 1 FROM findings neighbor_finding
            WHERE neighbor_finding.embed_content_hash = candidate.content_hash
              AND neighbor_finding.finding_type = target.finding_type
          )
        ORDER BY candidate.vec <=> target_embedding.vec
        LIMIT 10
      ) neighbor
      WHERE target.embed_content_hash = ANY(${contentHashes}::text[])
    `
      : await this.prisma.$queryRaw<NeighborhoodRow[]>`
      SELECT target.id AS "findingId", target.embed_content_hash AS "targetHash",
        neighbor.content_hash AS "neighborHash", neighbor.score
      FROM findings target
      JOIN content_embeddings target_embedding
        ON target_embedding.content_hash = target.embed_content_hash
       AND target_embedding.space_id = ${spaceId}
      CROSS JOIN LATERAL (
        SELECT sampled.content_hash,
          (SELECT SUM(pair.a * pair.b)
           FROM unnest(sampled.vec_f8, target_embedding.vec_f8) AS pair(a, b)) AS score
        FROM (
          SELECT candidate.content_hash, candidate.vec_f8
          FROM content_embeddings candidate
          WHERE candidate.space_id = ${spaceId}
            AND candidate.content_hash != target.embed_content_hash
            AND EXISTS (
              SELECT 1 FROM findings neighbor_finding
              WHERE neighbor_finding.embed_content_hash = candidate.content_hash
                AND neighbor_finding.finding_type = target.finding_type
            )
          ORDER BY candidate.content_hash
          LIMIT 1000
        ) sampled
        ORDER BY score DESC
        LIMIT 10
      ) neighbor
      WHERE target.embed_content_hash = ANY(${contentHashes}::text[])
    `;
    const grouped = new Map<string, NeighborhoodRow[]>();
    const nearDuplicateComponents = new UnionFind([]);
    for (const row of rows) {
      const normalizedRow = { ...row, score: Number(row.score) };
      const values = grouped.get(row.findingId) ?? [];
      values.push(normalizedRow);
      grouped.set(row.findingId, values);
      if (normalizedRow.score >= 0.95) {
        nearDuplicateComponents.union(row.targetHash, row.neighborHash);
      }
    }
    const componentMembers = new Map<string, string[]>();
    for (const hash of nearDuplicateComponents.ids()) {
      const root = nearDuplicateComponents.find(hash);
      const members = componentMembers.get(root) ?? [];
      members.push(hash);
      componentMembers.set(root, members);
    }
    const duplicateGroupByHash = new Map<string, string>();
    for (const members of componentMembers.values()) {
      const groupHash = [...members].sort()[0];
      for (const hash of members) duplicateGroupByHash.set(hash, groupHash);
    }
    await Promise.all(
      [...grouped.entries()].map(async ([findingId, neighbors]) => {
        const analysis = await this.prisma.findingEvidenceAnalysis.findUnique({
          where: { findingId },
        });
        if (!analysis || !neighbors.length) return;
        const meanSimilarity =
          neighbors.reduce((sum, neighbor) => sum + neighbor.score, 0) /
          neighbors.length;
        const semanticOutlier = Math.max(0, Math.min(1, 1 - meanSimilarity));
        const nearDuplicates = neighbors.filter(
          (neighbor) => neighbor.score >= 0.95,
        );
        const textQuality = analysis.qualityScore;
        const qualityScore = Math.max(
          0,
          Math.min(1, textQuality * 0.8 + meanSimilarity * 0.2),
        );
        const outlierAdjustment =
          textQuality >= 0.55 ? semanticOutlier * 0.12 : -semanticOutlier * 0.2;
        const duplicatePenalty = Math.min(0.15, nearDuplicates.length * 0.025);
        const importanceScore = Math.max(
          0,
          Math.min(
            1,
            analysis.importanceScore + outlierAdjustment - duplicatePenalty,
          ),
        );
        const reasons = Array.isArray(analysis.reasons)
          ? [...analysis.reasons]
          : [];
        if (nearDuplicates.length) {
          reasons.push({
            code: 'near_duplicate',
            label: `${nearDuplicates.length} near-duplicate findings grouped semantically`,
            impact: 'down',
          });
        }
        reasons.push(
          textQuality < 0.55 && semanticOutlier > 0.45
            ? {
                code: 'isolated_ocr',
                label: 'Isolated low-quality text; possible OCR noise',
                impact: 'down',
              }
            : semanticOutlier > 0.35
              ? {
                  code: 'semantic_outlier',
                  label: 'Semantically unusual for its neighbours',
                  impact: 'up',
                }
              : {
                  code: 'semantic_support',
                  label: 'Consistent with its semantic neighbours',
                  impact: 'neutral',
                },
        );
        await this.prisma.findingEvidenceAnalysis.update({
          where: { findingId },
          data: {
            importanceScore,
            qualityScore,
            semanticOutlier,
            similarCount: analysis.similarCount + nearDuplicates.length,
            duplicateGroupHash:
              duplicateGroupByHash.get(neighbors[0].targetHash) ??
              analysis.duplicateGroupHash,
            reasons,
            signals: {
              ...(analysis.signals && typeof analysis.signals === 'object'
                ? (analysis.signals as Record<string, unknown>)
                : {}),
              meanNeighborSimilarity: meanSimilarity,
              ...(nearDuplicates.length
                ? {
                    duplicateSimilarity: Math.max(
                      ...nearDuplicates.map((neighbor) => neighbor.score),
                    ),
                  }
                : {}),
            },
            analyzedAt: new Date(),
          },
        });
      }),
    );
    await Promise.all(
      [...new Set(duplicateGroupByHash.values())].map((groupHash) => {
        const hashes = [...duplicateGroupByHash.entries()]
          .filter(([, value]) => value === groupHash)
          .map(([hash]) => hash);
        return this.prisma.findingEvidenceAnalysis.updateMany({
          where: { finding: { embedContentHash: { in: hashes } } },
          data: { duplicateGroupHash: groupHash },
        });
      }),
    );
  }

  async putChunks(sourceId: string, dto: PutAssetChunksDto) {
    const asset = await this.prisma.asset.findUnique({
      where: { sourceId_hash: { sourceId, hash: dto.assetHash } },
      select: { id: true },
    });
    if (!asset)
      throw new NotFoundException(
        `Asset ${dto.assetHash} not found in source ${sourceId}`,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.assetChunk.deleteMany({ where: { assetId: asset.id } });
      if (dto.chunks.length) {
        await tx.assetChunk.createMany({
          data: dto.chunks.map((chunk) => ({
            id: randomUUID(),
            assetId: asset.id,
            sourceId,
            ...chunk,
          })),
        });
      }
    });
    return { stored: dto.chunks.length };
  }

  private async rowsForVector(
    vector: number[],
    limit: number,
    sourceIds?: string[],
  ) {
    const space = await this.prisma.embeddingSpace.findFirst({
      where: { isActive: true },
    });
    if (!space) return [];
    const sourceFilter = sourceIds?.length ? sourceIds : null;
    if (this.capability.hasVector() && !sourceFilter) {
      return this.prisma.$queryRaw<SimilarityRow[]>`
        SELECT f.id, 1 - (ce.vec <=> ${JSON.stringify(vector)}::public.vector) AS score
        FROM content_embeddings ce
        JOIN findings f ON f.embed_content_hash = ce.content_hash
        WHERE ce.space_id = ${space.id}
          AND ce.vec IS NOT NULL
          AND (${sourceFilter}::text[] IS NULL OR f.source_id = ANY(${sourceFilter}::text[]))
          AND f.status != 'RESOLVED'
        ORDER BY ce.vec <=> ${JSON.stringify(vector)}::public.vector
        LIMIT ${limit}
      `;
    }
    return this.prisma.$queryRaw<SimilarityRow[]>`
      SELECT f.id,
        (SELECT SUM(pair.a * pair.b)
         FROM unnest(ce.vec_f8, ${vector}::float8[]) AS pair(a, b)) AS score
      FROM content_embeddings ce
      JOIN findings f ON f.embed_content_hash = ce.content_hash
      WHERE ce.space_id = ${space.id}
        AND (${sourceFilter}::text[] IS NULL OR f.source_id = ANY(${sourceFilter}::text[]))
        AND f.status != 'RESOLVED'
      ORDER BY score DESC
      LIMIT ${limit}
    `;
  }

  async semanticFindingIds(
    queryVector: number[],
    limit: number,
    sourceIds?: string[],
  ) {
    return this.rowsForVector(queryVector, limit, sourceIds);
  }

  async semanticAssetIds(
    queryVector: number[],
    limit: number,
    sourceId?: string,
  ) {
    const space = await this.prisma.embeddingSpace.findFirst({
      where: { isActive: true },
    });
    if (!space) return [];
    const candidateLimit = Math.max(limit * 5, 200);
    if (this.capability.hasVector() && !sourceId) {
      return this.prisma.$queryRaw<SimilarityRow[]>`
        WITH ranked_chunks AS (
          SELECT ac.asset_id AS id,
            1 - (ce.vec <=> ${JSON.stringify(queryVector)}::public.vector) AS score
          FROM content_embeddings ce
          JOIN asset_chunks ac ON ac.content_hash = ce.content_hash
          WHERE ce.space_id = ${space.id}
            AND ce.vec IS NOT NULL
            AND (${sourceId ?? null}::text IS NULL OR ac.source_id = ${sourceId ?? null})
          ORDER BY ce.vec <=> ${JSON.stringify(queryVector)}::public.vector
          LIMIT ${candidateLimit}
        )
        SELECT id, MAX(score) AS score
        FROM ranked_chunks
        GROUP BY id
        ORDER BY score DESC
        LIMIT ${limit}
      `;
    }
    return this.prisma.$queryRaw<SimilarityRow[]>`
      SELECT ac.asset_id AS id,
        MAX((SELECT SUM(pair.a * pair.b)
             FROM unnest(ce.vec_f8, ${queryVector}::float8[]) AS pair(a, b))) AS score
      FROM content_embeddings ce
      JOIN asset_chunks ac ON ac.content_hash = ce.content_hash
      WHERE ce.space_id = ${space.id}
        AND (${sourceId ?? null}::text IS NULL OR ac.source_id = ${sourceId ?? null})
      GROUP BY ac.asset_id
      ORDER BY score DESC
      LIMIT ${limit}
    `;
  }

  async similarFindings(findingId: string, limit: number) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      select: { embedContentHash: true, sourceId: true },
    });
    if (!finding?.embedContentHash) {
      throw new NotFoundException(`Finding ${findingId} has no embedding`);
    }
    const space = await this.prisma.embeddingSpace.findFirst({
      where: { isActive: true },
    });
    if (!space) throw new NotFoundException('No active embedding space');
    const embedding = await this.prisma.contentEmbedding.findUnique({
      where: {
        spaceId_contentHash: {
          spaceId: space.id,
          contentHash: finding.embedContentHash,
        },
      },
      select: { vecF8: true },
    });
    if (!embedding)
      throw new NotFoundException(`Finding ${findingId} has no stored vector`);
    const rows = (await this.rowsForVector(embedding.vecF8, limit + 1))
      .filter((row) => row.id !== findingId)
      .slice(0, limit);
    const ids = rows.map((row) => row.id);
    const records = await this.prisma.finding.findMany({
      where: { id: { in: ids } },
      include: { asset: true, source: true, evidenceAnalysis: true },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    return rows.flatMap((row) => {
      const record = byId.get(row.id);
      return record
        ? [
            {
              ...record,
              confidence: Number(record.confidence),
              similarity: Number(row.score),
            },
          ]
        : [];
    });
  }

  async boilerplateClusters(sourceId: string, threshold = 0.95, limit = 50) {
    const rows = await this.prisma.$queryRaw<BoilerplateClusterRow[]>`
      SELECT analysis.duplicate_group_hash AS "groupHash",
        COUNT(*) AS "findingCount",
        (ARRAY_AGG(finding.id ORDER BY analysis.importance_score DESC))[1:10] AS "findingIds",
        AVG(analysis.importance_score) AS "meanImportance"
      FROM finding_evidence_analyses analysis
      JOIN findings finding ON finding.id = analysis.finding_id
      WHERE finding.source_id = ${sourceId}
        AND analysis.duplicate_group_hash IS NOT NULL
        AND COALESCE(
          (analysis.signals->>'duplicateSimilarity')::double precision,
          0
        ) >= ${threshold}
      GROUP BY analysis.duplicate_group_hash
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, AVG(analysis.importance_score) DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      ...row,
      findingCount: Number(row.findingCount),
      meanImportance: Number(row.meanImportance),
      threshold,
    }));
  }
}
