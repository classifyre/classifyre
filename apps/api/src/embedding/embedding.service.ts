import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FindingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { UnionFind } from '../utils/union-find';
import { EmbeddingCapabilityService } from './embedding-capability.service';
import { EmbeddingAnalysisService } from './embedding-analysis.service';
import { PutAssetChunksDto } from './dto/embedding.dto';
import { EmbeddingConfigService } from './embedding-config.service';
import { embeddingContentHash } from './embedding-text';

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

// Outlier/quality adjustments need at least this many same-type neighbours to
// mean anything; below it the neighbourhood signal is treated as unavailable.
const MIN_NEIGHBORHOOD = 5;
// "Semantically unusual" must be rare to mean anything. On MiniLM over diverse
// evidence text the corpus-median outlier strength is ~0.3, so the reason/bonus
// bar sits at the top decile (~0.55) rather than the old 0.35, which flagged
// half the corpus.
const OUTLIER_BONUS_THRESHOLD = 0.55;
const RECALIBRATE_BATCH_SIZE = 500;

@Injectable()
export class EmbeddingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly config: EmbeddingConfigService;
  private configuredSpacePromise?: ReturnType<EmbeddingService['ensureSpace']>;
  private configuredSpaceId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly capability: EmbeddingCapabilityService,
    private readonly analysis: EmbeddingAnalysisService,
    config?: EmbeddingConfigService,
  ) {
    this.config = config ?? new EmbeddingConfigService();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.capability.ensureReady();
    await this.configuredSpace();
  }

  status() {
    return {
      enabled: this.config.enabled,
      pgvector: true,
      pgvectorVersion: this.capability.version(),
      searchStrategy: 'per-space-hnsw',
      provider: this.config.provider,
      model: this.config.model,
      dimensions: this.config.dimensions,
      spaceId: this.configuredSpaceId,
    };
  }

  configuredSpace() {
    if (!this.configuredSpacePromise) {
      this.configuredSpacePromise = this.ensureSpace(this.config.space()).then(
        (space) => {
          this.configuredSpaceId = space.id;
          return space;
        },
      );
    }
    return this.configuredSpacePromise;
  }

  async ensureSpace(
    input: Omit<ReturnType<EmbeddingConfigService['space']>, 'provider'> & {
      provider?: ReturnType<EmbeddingConfigService['space']>['provider'];
    },
  ) {
    const provider = input.provider ?? this.config.provider;
    const space = await this.prisma.$transaction(async (tx) => {
      // All replicas in a rollout serialize space creation/activation. Without
      // this lock, two new pods can race the unique key or leave two spaces
      // active after interleaved updateMany/create transactions.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('classifyre.embedding-space-activation')
        )
      `;
      const existing = await tx.embeddingSpace.findUnique({
        where: {
          provider_model_revision_dim_pooling_normalized: {
            provider,
            model: input.model,
            revision: input.revision,
            dim: input.dim,
            pooling: input.pooling,
            normalized: input.normalized,
          },
        },
      });
      if (existing) {
        if (!existing.isActive) {
          await tx.embeddingSpace.updateMany({ data: { isActive: false } });
          return tx.embeddingSpace.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
        }
        return existing;
      }

      await tx.embeddingSpace.updateMany({ data: { isActive: false } });
      return tx.embeddingSpace.create({
        data: { ...input, provider, isActive: true },
      });
    });
    await this.ensureHnswIndex(space.id, space.dim);
    return space;
  }

  private async activeSpace() {
    // Bind every operation in this process to the model it booted with.
    // During a rolling deployment, an older pod must never start reading or
    // writing the newer pod's globally active coordinate space.
    return this.configuredSpace();
  }

  private async ensureHnswIndex(spaceId: string, dim: number): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(spaceId)) {
      throw new Error(`Invalid embedding space id ${spaceId}`);
    }
    const indexName = `content_embeddings_${spaceId.replaceAll('-', '')}_hnsw`;
    await this.prisma.$executeRaw(
      Prisma.raw(
        `CREATE INDEX IF NOT EXISTS "${indexName}"
         ON "content_embeddings"
         USING hnsw (("vec"::public.vector(${dim})) public.vector_cosine_ops)
         WITH (m = ${this.config.hnswM}, ef_construction = ${this.config.hnswEfConstruction})
         WHERE "space_id" = '${spaceId}'`,
      ),
    );
    this.logger.log(
      `Embedding space ${spaceId} ready (${this.config.provider}:${this.config.model}, ${dim} dimensions)`,
    );
  }

  async missingHashes(hashes: string[], spaceId?: string) {
    const resolvedSpaceId = spaceId ?? (await this.activeSpace()).id;
    const uniqueHashes = [...new Set(hashes)];
    const present = await this.prisma.contentEmbedding.findMany({
      where: { spaceId: resolvedSpaceId, contentHash: { in: uniqueHashes } },
      select: { contentHash: true },
    });
    const presentSet = new Set(present.map((item) => item.contentHash));
    return uniqueHashes.filter((hash) => !presentSet.has(hash));
  }

  async missing(
    spaceInput: Omit<
      ReturnType<EmbeddingConfigService['space']>,
      'provider'
    > & {
      provider?: ReturnType<EmbeddingConfigService['space']>['provider'];
    },
    hashes: string[],
  ) {
    const space = await this.ensureSpace({
      ...spaceInput,
      provider: spaceInput.provider ?? this.config.provider,
    });
    const present = await this.prisma.contentEmbedding.findMany({
      where: {
        spaceId: space.id,
        contentHash: { in: [...new Set(hashes)] },
      },
      select: { contentHash: true },
    });
    const presentSet = new Set(present.map((item) => item.contentHash));
    // Self-heal: a vector that is already stored but whose finding lost its
    // evidence analysis (manual deletion, partial failure) is re-analyzed as
    // part of negotiation, so scans repair ranking coverage as they run.
    if (presentSet.size) {
      const unanalyzed = await this.prisma.finding.findMany({
        where: {
          embedContentHash: { in: [...presentSet] },
          evidenceAnalysis: null,
        },
        select: { embedContentHash: true },
        distinct: ['embedContentHash'],
      });
      const healHashes = unanalyzed
        .map((row) => row.embedContentHash)
        .filter((hash): hash is string => hash !== null);
      if (healHashes.length) {
        await this.analysis.analyzeHashes(space.id, healHashes);
        await this.calibrateNeighborhood(space.id, healHashes);
      }
    }
    return {
      spaceId: space.id,
      missing: [...new Set(hashes)].filter((hash) => !presentSet.has(hash)),
    };
  }

  async putVectors(
    input:
      | Array<{ contentHash: string; vector: number[] }>
      | {
          spaceId: string;
          items: Array<{ contentHash: string; vector: number[] }>;
        },
  ) {
    const items = Array.isArray(input) ? input : input.items;
    const space = Array.isArray(input)
      ? await this.activeSpace()
      : await this.prisma.embeddingSpace.findUnique({
          where: { id: input.spaceId },
        });
    if (!space) {
      throw new NotFoundException(`Embedding space not found`);
    }
    const invalid = items.find((item) => item.vector.length !== space.dim);
    if (invalid) {
      throw new BadRequestException(
        `Vector ${invalid.contentHash} has ${invalid.vector.length} dimensions; expected ${space.dim}`,
      );
    }
    if (space.normalized) {
      const unnormalized = items.find((item) => {
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

    let created = 0;
    for (const item of items) {
      created += await this.prisma.$executeRaw`
        INSERT INTO content_embeddings (id, space_id, content_hash, vec)
        VALUES (
          ${randomUUID()},
          ${space.id},
          ${item.contentHash},
          ${JSON.stringify(item.vector)}::public.vector
        )
        ON CONFLICT (space_id, content_hash) DO NOTHING
      `;
    }
    await this.analysis.analyzeHashes(
      space.id,
      items.map((item) => item.contentHash),
    );
    await this.calibrateNeighborhood(
      space.id,
      items.map((item) => item.contentHash),
    );
    return { created, received: items.length };
  }

  /**
   * Re-run evidence analysis and neighbourhood calibration for every finding
   * that has an embedding hash. Insert-time calibration is order-dependent —
   * the first vectors stored see a nearly empty space — so this pass must run
   * once the space is stable (after a backfill or scan drains the queue) to
   * make importance scores corpus-relative instead of insert-order-relative.
   */
  async recalibrateSpace(spaceId?: string): Promise<{ analyzed: number }> {
    const resolvedSpaceId = spaceId ?? (await this.activeSpace()).id;
    let cursor: string | undefined;
    let analyzed = 0;
    do {
      const findings = await this.prisma.finding.findMany({
        where: { embedContentHash: { not: null } },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: RECALIBRATE_BATCH_SIZE,
        select: { id: true, embedContentHash: true },
      });
      if (!findings.length) break;
      const hashes = [
        ...new Set(
          findings.map((finding) => finding.embedContentHash as string),
        ),
      ];
      await this.analysis.analyzeHashes(resolvedSpaceId, hashes);
      await this.calibrateNeighborhood(resolvedSpaceId, hashes);
      analyzed += findings.length;
      cursor = findings.at(-1)?.id;
      await new Promise((resolve) => setImmediate(resolve));
    } while (cursor);
    this.logger.log(
      `Recalibrated evidence analyses for ${analyzed} findings in space ${resolvedSpaceId}`,
    );
    return { analyzed };
  }

  private async calibrateNeighborhood(
    spaceId: string,
    contentHashes: string[],
  ) {
    if (!contentHashes.length) return;
    const rows = await this.prisma.$queryRaw<NeighborhoodRow[]>`
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
        const nearDuplicates = neighbors.filter(
          (neighbor) => neighbor.score >= 0.95,
        );
        // A sparse neighbourhood (fewer than MIN_NEIGHBORHOOD same-type
        // vectors in the space) says nothing about how unusual the evidence
        // is — the first vectors analyzed would otherwise all read as extreme
        // outliers and keep that bonus forever.
        const neighborhoodReliable = neighbors.length >= MIN_NEIGHBORHOOD;
        const semanticOutlier = neighborhoodReliable
          ? Math.max(0, Math.min(1, 1 - meanSimilarity))
          : 0;
        const textQuality = analysis.qualityScore;
        const qualityScore = neighborhoodReliable
          ? Math.max(0, Math.min(1, textQuality * 0.8 + meanSimilarity * 0.2))
          : textQuality;
        // A tiny matched value ("LOCH", "=") is weak evidence however unusual
        // its embedding looks; the outlier bonus needs substance to reward.
        const valueLength = Number(
          (analysis.signals as Record<string, unknown> | null)?.[
            'valueLength'
          ] ?? Number.MAX_SAFE_INTEGER,
        );
        const outlierAdjustment = !neighborhoodReliable
          ? 0
          : textQuality < 0.55
            ? -semanticOutlier * 0.2
            : semanticOutlier >= OUTLIER_BONUS_THRESHOLD && valueLength >= 5
              ? semanticOutlier * 0.12
              : 0;
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
          !neighborhoodReliable
            ? {
                code: 'insufficient_neighborhood',
                label: 'Too few comparable findings for semantic analysis',
                impact: 'neutral',
              }
            : textQuality < 0.55 && semanticOutlier > 0.45
              ? {
                  code: 'isolated_ocr',
                  label: 'Isolated low-quality text; possible OCR noise',
                  impact: 'down',
                }
              : semanticOutlier >= OUTLIER_BONUS_THRESHOLD
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
    const chunks = dto.chunks.map((chunk) => ({
      ...chunk,
      contentHash: embeddingContentHash(chunk.text),
    }));
    await this.prisma.$transaction(async (tx) => {
      await tx.assetChunk.deleteMany({ where: { assetId: asset.id } });
      if (chunks.length) {
        await tx.assetChunk.createMany({
          data: chunks.map((chunk) => ({
            id: randomUUID(),
            assetId: asset.id,
            sourceId,
            ...chunk,
          })),
        });
      }
    });
    return {
      stored: chunks.length,
      contents: chunks.map((chunk) => ({
        hash: chunk.contentHash,
        text: chunk.text,
      })),
    };
  }

  private async rowsForVector(
    vector: number[],
    limit: number,
    sourceIds?: string[],
    statuses?: FindingStatus[],
    includeResolved = false,
  ) {
    const space = await this.activeSpace();
    if (vector.length !== space.dim) {
      throw new BadRequestException(
        `Query vector has ${vector.length} dimensions; active space requires ${space.dim}`,
      );
    }
    const sourceFilter = sourceIds?.length ? sourceIds : null;
    const statusFilter = statuses?.length ? statuses : null;
    const dim = Prisma.raw(String(space.dim));
    const queryVector = JSON.stringify(vector);
    const statusScope = statusFilter
      ? Prisma.sql`AND f.status = ANY(${statusFilter}::"FindingStatus"[])`
      : includeResolved
        ? Prisma.empty
        : Prisma.sql`AND f.status <> ${FindingStatus.RESOLVED}::"FindingStatus"`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.raw(`SET LOCAL hnsw.ef_search = ${this.config.hnswEfSearch}`),
      );
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = strict_order`;
      return tx.$queryRaw<SimilarityRow[]>(Prisma.sql`
        SELECT f.id, 1 - (
          ce.vec::public.vector(${dim}) <=>
          ${queryVector}::public.vector(${dim})
        ) AS score
        FROM content_embeddings ce
        JOIN findings f ON f.embed_content_hash = ce.content_hash
        WHERE ce.space_id = ${space.id}
          AND (${sourceFilter}::text[] IS NULL OR f.source_id = ANY(${sourceFilter}::text[]))
          ${statusScope}
        ORDER BY ce.vec::public.vector(${dim}) <=>
          ${queryVector}::public.vector(${dim})
        LIMIT ${limit}
      `);
    });
  }

  async semanticFindingIds(
    queryVector: number[],
    limit: number,
    sourceIds?: string[],
    statuses?: FindingStatus[],
    includeResolved = false,
  ) {
    return this.rowsForVector(
      queryVector,
      limit,
      sourceIds,
      statuses,
      includeResolved,
    );
  }

  async semanticAssetIds(
    queryVector: number[],
    limit: number,
    sourceId?: string,
  ) {
    const space = await this.activeSpace();
    if (queryVector.length !== space.dim) {
      throw new BadRequestException(
        `Query vector has ${queryVector.length} dimensions; active space requires ${space.dim}`,
      );
    }
    const candidateLimit = Math.max(limit * 5, 200);
    const dim = Prisma.raw(String(space.dim));
    const vector = JSON.stringify(queryVector);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.raw(`SET LOCAL hnsw.ef_search = ${this.config.hnswEfSearch}`),
      );
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = strict_order`;
      return tx.$queryRaw<SimilarityRow[]>(Prisma.sql`
        WITH ranked_chunks AS (
          SELECT ac.asset_id AS id,
            1 - (
              ce.vec::public.vector(${dim}) <=>
              ${vector}::public.vector(${dim})
            ) AS score
          FROM content_embeddings ce
          JOIN asset_chunks ac ON ac.content_hash = ce.content_hash
          WHERE ce.space_id = ${space.id}
            AND (${sourceId ?? null}::text IS NULL OR ac.source_id = ${sourceId ?? null})
          ORDER BY ce.vec::public.vector(${dim}) <=>
            ${vector}::public.vector(${dim})
          LIMIT ${candidateLimit}
        )
        SELECT id, MAX(score) AS score
        FROM ranked_chunks
        GROUP BY id
        ORDER BY score DESC
        LIMIT ${limit}
      `);
    });
  }

  async similarFindings(findingId: string, limit: number) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      select: { embedContentHash: true, sourceId: true },
    });
    if (!finding?.embedContentHash) {
      throw new NotFoundException(`Finding ${findingId} has no embedding`);
    }
    const space = await this.activeSpace();
    const vectors = await this.prisma.$queryRaw<Array<{ vector: string }>>`
      SELECT vec::text AS vector
      FROM content_embeddings
      WHERE space_id = ${space.id}
        AND content_hash = ${finding.embedContentHash}
      LIMIT 1
    `;
    if (!vectors[0])
      throw new NotFoundException(`Finding ${findingId} has no stored vector`);
    const vector = JSON.parse(vectors[0].vector) as number[];
    const rows = (
      await this.rowsForVector(vector, limit + 1, undefined, undefined, true)
    )
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
