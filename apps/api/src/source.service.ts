import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AssetType, Source, Prisma, RunnerStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import { stableStringify } from './utils/masked-config.utils';
import { normalizeSourceConfig } from './utils/source-config-normalizer';
import { RunnerLogStorageService } from './cli-runner/runner-log-storage.service';
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
import { getSourceCategory } from './dto/source-type-schema';

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(
    private prisma: PrismaService,
    private maskedConfigCryptoService: MaskedConfigCryptoService,
    private runnerLogStorage: RunnerLogStorageService,
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
  }): Promise<Source> {
    const { config, type, name: providedName } = createSourceDto;
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
    const existingSource = await this.findExistingSourceByConfig(
      assetType,
      normalizedIncomingConfig,
    );

    if (existingSource) {
      return existingSource;
    }

    return this.prisma.source.create({
      data: {
        name,
        type: assetType,
        sourceCategory: getSourceCategory(type),
        config: encryptedConfig as Prisma.JsonObject,
      },
    });
  }

  updateFromConfig(
    sourceId: string,
    updateSourceDto: {
      name?: string;
      type?: string;
      config?: Record<string, any>;
    },
  ): Promise<Source> {
    const updateData: Prisma.SourceUpdateInput = {};

    if (updateSourceDto.name !== undefined) {
      updateData.name = updateSourceDto.name;
    }

    if (updateSourceDto.type !== undefined) {
      updateData.type = this.asAssetType(updateSourceDto.type);
    }

    if (updateSourceDto.config !== undefined) {
      const encryptedConfig =
        this.maskedConfigCryptoService.encryptMaskedConfig(
          updateSourceDto.config,
        );
      updateData.config = encryptedConfig as Prisma.JsonObject;
    }

    return this.prisma.source.update({
      where: { id: sourceId },
      data: updateData,
    });
  }

  updateSource(params: {
    where: Prisma.SourceWhereUniqueInput;
    data: Prisma.SourceUpdateInput;
  }): Promise<Source> {
    const { where, data } = params;
    return this.prisma.source.update({
      data,
      where,
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
        await this.runnerLogStorage.deleteRunnerLogs(id);
      } catch (error) {
        this.logger.error(
          `Failed to delete runner logs for runner ${id} before deleting source ${sourceId}: ${String(error)}`,
        );
        throw error;
      }
    }

    return this.prisma.source.delete({ where });
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
      where.type = { in: filters.type as any };
    }

    if (filters?.status?.length) {
      where.runnerStatus = { in: filters.status as any };
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

      return {
        id: source.id,
        name: source.name,
        type: source.type,
        runnerStatus: source.runnerStatus,
        latestRunner,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        scheduleEnabled: source.scheduleEnabled,
        scheduleCron: source.scheduleCron,
        scheduleTimezone: source.scheduleTimezone,
        scheduleNextAt: source.scheduleNextAt,
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
          candidate.config as Record<string, unknown>,
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
