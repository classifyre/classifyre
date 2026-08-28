import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AssetType, Source, Prisma, RunnerStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import { mergeMaskedConfig, stableStringify } from './utils/masked-config.utils';
import { normalizeSourceConfig } from './utils/source-config-normalizer';
import { RunnerLogStorageService } from './cli-runner/runner-log-storage.service';
import { CorrelationJobScheduler } from './correlation/correlation-job-scheduler.service';
import {
  SearchSourcesRequestDto,
  SearchSourcesSortBy,
  SearchSourcesSortOrder,
} from './dto/search-sources-request.dto';
import {
  LatestRunnerSummaryDto,
  SearchSourceItemDto,
  SearchSourcesResponseDto,
} from './dto/search-sources-response.dto';

/**
 * Round-trip the config through JSON serialization to:
 *  1. Produce a plain, structurally clean object (no undefined values, etc.)
 *  2. Validate the object is fully serializable before it reaches the Prisma
 *     query engine — guarding against the rare Bun/Prisma-engine issue where
 *     large JSONB parameter values arrive truncated at PostgreSQL (P2028-adjacent).
 *
 * Throws InternalServerErrorException if the config cannot be cleanly
 * serialized, rather than letting a cryptic "invalid input syntax for type json"
 * propagate from PostgreSQL.
 */
function assertSerializableConfig(
  config: Record<string, unknown>,
): Prisma.InputJsonObject {
  let serialized: string;
  try {
    serialized = JSON.stringify(config);
  } catch (err) {
    throw new InternalServerErrorException(
      `Source config could not be serialized to JSON: ${String(err)}`,
    );
  }
  try {
    return JSON.parse(serialized) as Prisma.InputJsonObject;
  } catch (err) {
    throw new InternalServerErrorException(
      `Source config produced invalid JSON during serialization — this is a bug: ${String(err)}`,
    );
  }
}

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(
    private prisma: PrismaService,
    private maskedConfigCryptoService: MaskedConfigCryptoService,
    private runnerLogStorage: RunnerLogStorageService,
    private correlationJobs: CorrelationJobScheduler,
  ) {}

  generateId(data: any): string {
    const { config, type } = data;
    // Generate stable hash from canonical source config payload
    const connectionInfo = {
      config,
      type,
    };

    const sortedStr = JSON.stringify(
      connectionInfo,
      Object.keys(connectionInfo).sort(),
    );
    const hash = crypto.createHash('sha256').update(sortedStr).digest();
    return hash
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  source(
    sourceWhereUniqueInput: Prisma.SourceWhereUniqueInput,
  ): Promise<Source | null> {
    return this.prisma.source.findUnique({
      where: sourceWhereUniqueInput,
    });
  }

  sources(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.SourceWhereUniqueInput;
    where?: Prisma.SourceWhereInput;
    orderBy?: Prisma.SourceOrderByWithRelationInput;
  }): Promise<Source[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.source.findMany({
      skip,
      take,
      cursor,
      where,
      orderBy,
    });
  }

  createSource(data: Prisma.SourceCreateInput): Promise<Source> {
    return this.prisma.source.create({
      data,
    });
  }

  async createFromConfig(createSourceDto: {
    config: Record<string, unknown>;
    type: string;
    name?: string;
    description?: string;
  }): Promise<Source> {
    const { config, type, name: providedName, description } = createSourceDto;
    const assetType = this.asAssetType(type);
    const fallbackSuffix = crypto.randomUUID().split('-')[0];
    const name = providedName || `${type}_${fallbackSuffix}`;
    const normalizedConfigForStorage = normalizeSourceConfig(type, config);

    const normalizedIncomingConfig =
      this.maskedConfigCryptoService.decryptMaskedConfig(
        normalizedConfigForStorage,
      );
    const encryptedConfig = this.maskedConfigCryptoService.encryptMaskedConfig(
      normalizedIncomingConfig,
    );
    const existingSource =
      assetType === AssetType.SANDBOX
        ? null
        : await this.findExistingSourceByConfig(
            assetType,
            normalizedIncomingConfig,
          );

    if (existingSource) {
      return existingSource;
    }

    return this.prisma.source.create({
      data: {
        name,
        description: description ?? null,
        type: assetType,
        config: assertSerializableConfig(encryptedConfig),
      },
    });
  }

  async updateFromConfig(
    sourceId: string,
    updateSourceDto: {
      name?: string;
      description?: string;
      type?: string;
      config?: Record<string, any>;
    },
  ): Promise<Source> {
    const updateData: Prisma.SourceUpdateInput = {};

    if (updateSourceDto.name !== undefined) {
      updateData.name = updateSourceDto.name;
    }

    if (updateSourceDto.description !== undefined) {
      updateData.description = updateSourceDto.description;
    }

    if (updateSourceDto.type !== undefined) {
      updateData.type = this.asAssetType(updateSourceDto.type);
    }

    if (updateSourceDto.config !== undefined) {
      // A full-config update (this endpoint, and the web UI's generic "Edit
      // Source" save) never receives existing secret/credential VALUES back
      // -- they are write-only -- so it can only resupply a leaf it actually
      // has a fresh value for. Merge onto the stored `masked` section rather
      // than replacing it outright, or saving anything about a source wipes
      // every credential on it. See mergeMaskedConfig's docstring.
      const existing = await this.prisma.source.findUnique({
        where: { id: sourceId },
        select: { config: true },
      });
      const mergedConfig: Record<string, unknown> = {
        ...updateSourceDto.config,
        masked: mergeMaskedConfig(
          (existing?.config as Record<string, unknown> | undefined)?.masked,
          updateSourceDto.config.masked,
        ),
      };
      const encryptedConfig =
        this.maskedConfigCryptoService.encryptMaskedConfig(mergedConfig);
      updateData.config = assertSerializableConfig(encryptedConfig);
    }

    const source = await this.prisma.source.update({
      where: { id: sourceId },
      data: updateData,
    });
    if (updateSourceDto.name !== undefined) {
    }
    return source;
  }

  async updateSource(params: {
    where: Prisma.SourceWhereUniqueInput;
    data: Prisma.SourceUpdateInput;
  }): Promise<Source> {
    const { where, data } = params;
    const source = await this.prisma.source.update({
      data,
      where,
    });
    if (data.name !== undefined) {
    }
    return source;
  }

  decryptSourceConfig(config: unknown): Record<string, unknown> {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return {};
    }
    return this.maskedConfigCryptoService.decryptMaskedConfig(
      config as Record<string, unknown>,
    );
  }

  /**
   * Persist the opaque AUTOMATIC sampling cursor for a source. The value is
   * source-defined and never interpreted here; it is injected into the next
   * run so extraction resumes where it left off.
   */
  updateSamplingCursor(
    sourceId: string,
    samplingCursor: Record<string, unknown> | null | undefined,
  ): Promise<Source> {
    return this.prisma.source.update({
      where: { id: sourceId },
      data: {
        samplingCursor:
          samplingCursor === undefined
            ? Prisma.DbNull
            : (samplingCursor as Prisma.InputJsonValue),
      },
    });
  }

  async deleteSource(where: Prisma.SourceWhereUniqueInput): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where,
      select: { id: true },
    });
    const sourceId = existing?.id;
    if (!sourceId) {
      return this.prisma.source.delete({ where });
    }

    const sourceRunners = await this.prisma.runner.findMany({
      where: { sourceId },
      select: { id: true },
    });

    for (const { id } of sourceRunners) {
      try {
        await this.runnerLogStorage.deleteRunnerLogs(sourceId, id);
      } catch (error) {
        this.logger.error(
          `Failed to delete runner logs for runner ${id} before deleting source ${sourceId}: ${String(error)}`,
        );
        throw error;
      }
    }

    const deleted = await this.prisma.source.delete({ where });
    await this.correlationJobs.scheduleFull('source deleted');
    return deleted;
  }

  /**
   * Permanently delete every finding of a source (all statuses). Evidence
   * analyses and extractions cascade via FK; case-evidence snapshots survive
   * by design. Correlation fingerprints are derived from findings, so a full
   * background recompute is scheduled afterwards — content embeddings are
   * content-addressed and need no rebalancing.
   */
  async purgeFindings(sourceId: string): Promise<{ purgedFindings: number }> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true },
    });
    if (!source) {
      throw new NotFoundException(`Source with ID ${sourceId} not found`);
    }

    const result = await this.prisma.finding.deleteMany({
      where: { sourceId },
    });

    this.logger.warn(
      `Purged ${result.count} finding(s) from source ${sourceId}; scheduling correlation recompute.`,
    );

    await this.correlationJobs.scheduleFull('source findings purged');

    return { purgedFindings: result.count };
  }

  /**
   * Permanently delete every asset of a source. Findings, extractions,
   * correlation values, signatures, cluster memberships and chunks all
   * cascade via FK (onDelete: Cascade from Asset). Correlation fingerprints
   * are derived from findings, so a full background recompute is scheduled
   * afterwards.
   */
  async purgeAssets(sourceId: string): Promise<{ purgedAssets: number }> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true },
    });
    if (!source) {
      throw new NotFoundException(`Source with ID ${sourceId} not found`);
    }

    const result = await this.prisma.asset.deleteMany({
      where: { sourceId },
    });

    this.logger.warn(
      `Purged ${result.count} asset(s) (with findings) from source ${sourceId}; scheduling correlation recompute.`,
    );

    await this.correlationJobs.scheduleFull('source assets purged');

    return { purgedAssets: result.count };
  }

  async searchSources(
    request: SearchSourcesRequestDto,
  ): Promise<SearchSourcesResponseDto> {
    const { filters, page } = request;
    const skip = page?.skip ?? 0;
    const limit = page?.limit ?? 25;
    const sortBy = page?.sortBy ?? SearchSourcesSortBy.CREATED_AT;
    const sortOrder = (
      page?.sortOrder ?? SearchSourcesSortOrder.DESC
    ).toLowerCase() as Prisma.SortOrder;

    const where: Prisma.SourceWhereInput = {};

    if (filters?.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    if (filters?.type?.length) {
      where.type = { in: filters.type };
    }

    if (filters?.status?.length) {
      where.runnerStatus = { in: filters.status };
    }

    const orderBy: Prisma.SourceOrderByWithRelationInput = {};
    switch (sortBy) {
      case SearchSourcesSortBy.NAME:
        orderBy.name = sortOrder;
        break;
      case SearchSourcesSortBy.TYPE:
        orderBy.type = sortOrder;
        break;
      case SearchSourcesSortBy.STATUS:
        orderBy.runnerStatus = sortOrder;
        break;
      case SearchSourcesSortBy.CREATED_AT:
        orderBy.createdAt = sortOrder;
        break;
      case SearchSourcesSortBy.UPDATED_AT:
        orderBy.updatedAt = sortOrder;
        break;
      case SearchSourcesSortBy.LAST_RUN_AT:
        orderBy.lastRunAt = sortOrder;
        break;
      default:
        orderBy.createdAt = 'desc';
    }

    const [sources, filteredTotal, allStatusGroups] = await Promise.all([
      this.prisma.source.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          runners: {
            orderBy: { triggeredAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.source.count({ where }),
      this.prisma.source.groupBy({
        by: ['runnerStatus'],
        _count: { id: true },
      }),
    ]);

    let healthy = 0;
    let errors = 0;
    let running = 0;
    let grandTotal = 0;

    for (const group of allStatusGroups) {
      grandTotal += group._count.id;
      if (group.runnerStatus === RunnerStatus.COMPLETED) {
        healthy += group._count.id;
      } else if (group.runnerStatus === RunnerStatus.ERROR) {
        errors += group._count.id;
      } else if (
        group.runnerStatus === RunnerStatus.RUNNING ||
        group.runnerStatus === RunnerStatus.PENDING
      ) {
        running += group._count.id;
      }
    }

    const items: SearchSourceItemDto[] = sources.map((source) => {
      const runner = source.runners[0] ?? null;
      const latestRunner: LatestRunnerSummaryDto | null = runner
        ? {
            id: runner.id,
            status: runner.status,
            startedAt: runner.startedAt,
            completedAt: runner.completedAt,
            durationMs: runner.durationMs,
            assetsCreated: runner.assetsCreated,
            assetsUpdated: runner.assetsUpdated,
            assetsUnchanged: runner.assetsUnchanged,
            assetsDeleted: runner.assetsDeleted,
            totalFindings: runner.totalFindings,
            errorMessage: runner.errorMessage,
            triggeredAt: runner.triggeredAt,
          }
        : null;

      // Requesting a run claims the source as RUNNING so nothing else can
      // start it, but the run itself waits in the queue as PENDING until a
      // concurrency slot frees up. Report what the run is actually doing so a
      // queued scan is not shown as running.
      const runnerStatus =
        source.runnerStatus === RunnerStatus.RUNNING &&
        runner?.status === RunnerStatus.PENDING
          ? RunnerStatus.PENDING
          : source.runnerStatus;

      return {
        id: source.id,
        name: source.name,
        description: source.description,
        type: source.type,
        runnerStatus,
        latestRunner,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        scheduleEnabled: source.scheduleEnabled,
        scheduleCron: source.scheduleCron,
        scheduleTimezone: source.scheduleTimezone,
        scheduleNextAt: source.scheduleNextAt,
        scheduleMode: source.scheduleMode,
        autoPhase: source.autoPhase,
        autoReason: source.autoReason,
      };
    });

    return {
      items,
      total: filteredTotal,
      skip,
      limit,
      totals: {
        total: grandTotal,
        healthy,
        errors,
        running,
      },
    };
  }

  private async findExistingSourceByConfig(
    type: AssetType,
    config: Record<string, unknown>,
  ): Promise<Source | null> {
    const candidates = await this.prisma.source.findMany({
      where: { type },
    });

    const targetSignature = stableStringify(config);
    for (const candidate of candidates) {
      if (
        !candidate.config ||
        typeof candidate.config !== 'object' ||
        Array.isArray(candidate.config)
      ) {
        continue;
      }

      let decryptedConfig: Record<string, unknown>;
      try {
        decryptedConfig = this.maskedConfigCryptoService.decryptMaskedConfig(
          candidate.config,
        );
      } catch (error: any) {
        this.logger.warn(
          `Skipping source ${candidate.id} during config de-duplication: ${error.message}`,
        );
        continue;
      }

      if (stableStringify(decryptedConfig) === targetSignature) {
        return candidate;
      }
    }

    return null;
  }

  private asAssetType(type: string): AssetType {
    if ((Object.values(AssetType) as string[]).includes(type)) {
      return type as AssetType;
    }
    throw new BadRequestException(`Unsupported source type: ${type}`);
  }
}
