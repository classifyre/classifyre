import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  Asset,
  Prisma,
  AssetType,
  AssetContentType,
  AssetStatus,
  DetectorType,
  FindingStatus,
  Severity,
} from '@prisma/client';
import { generateDetectionIdentity } from './utils/detection-identity';
import {
  HistoryEventType,
  type FindingHistoryEntry,
} from './types/finding-history.types';
import {
  SearchAssetsRequestDto,
  SearchAssetsSortBy,
} from './dto/search-assets-request.dto';
import { SearchAssetsChartsRequestDto } from './dto/search-assets-charts-request.dto';
import { SearchAssetsChartsResponseDto } from './dto/search-assets-charts-response.dto';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';

const findingForAssetSelect = {
  id: true,
  detectionIdentity: true,
  assetId: true,
  sourceId: true,
  runnerId: true,
  detectorType: true,
  customDetectorId: true,
  customDetectorKey: true,
  customDetectorName: true,
  findingType: true,
  category: true,
  severity: true,
  confidence: true,
  matchedContent: true,
  redactedContent: true,
  contextBefore: true,
  contextAfter: true,
  location: true,
  status: true,
  resolutionReason: true,
  detectedAt: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FindingSelect;

type NormalizedAsset = Omit<Asset, 'links'> & { links: string[] };

type RawFindingForAssetListItem = Prisma.FindingGetPayload<{
  select: typeof findingForAssetSelect;
}>;

type NormalizedFindingLocation = {
  path: string;
  description?: string;
};

type FindingForAssetListItem = Omit<
  RawFindingForAssetListItem,
  | 'confidence'
  | 'runnerId'
  | 'redactedContent'
  | 'contextBefore'
  | 'contextAfter'
  | 'location'
  | 'resolutionReason'
  | 'firstDetectedAt'
  | 'lastDetectedAt'
  | 'resolvedAt'
  | 'customDetectorId'
  | 'customDetectorKey'
  | 'customDetectorName'
> & {
  confidence: number;
  runnerId?: string;
  customDetectorId?: string;
  customDetectorKey?: string;
  customDetectorName?: string;
  redactedContent?: string;
  contextBefore?: string;
  contextAfter?: string;
  location?: NormalizedFindingLocation;
  resolutionReason?: string;
  firstDetectedAt?: Date;
  lastDetectedAt?: Date;
  resolvedAt?: Date;
};

type RawChartsTotals = {
  totalAssets?: number | string | null;
  newAssets?: number | string | null;
  updatedAssets?: number | string | null;
  unchangedAssets?: number | string | null;
};

type RawChartsTopAsset = {
  assetId: string;
  assetName: string;
  sourceId?: string | null;
  findingsCount: number | string;
  severityScore: number | string;
};

type RawChartsTopSource = {
  sourceId: string;
  sourceName: string;
  assetCount: number | string;
};

type RawAssetsChartsQueryRow = {
  totals: RawChartsTotals | string | null;
  topAssetsByFindings: RawChartsTopAsset[] | string | null;
  topSourcesByAssetVolume: RawChartsTopSource[] | string | null;
};

@Injectable()
export class AssetService {
  constructor(
    private prisma: PrismaService,
    private readonly customDetectorExtractionsService: CustomDetectorExtractionsService,
  ) {}

  private async assertSourceAndRunner(sourceId: string, runnerId: string) {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      throw new NotFoundException(`Source with ID ${sourceId} not found`);
    }

    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
    });

    if (!runner) {
      throw new NotFoundException(`Runner with ID ${runnerId} not found`);
    }

    if (runner.sourceId !== sourceId) {
      throw new BadRequestException(
        `Runner ${runnerId} does not belong to source ${sourceId}`,
      );
    }

    return { source, runner };
  }

  private normalizeAssetType(value: unknown): AssetContentType {
    if (typeof value !== 'string') {
      return AssetContentType.OTHER;
    }

    const normalized = value.trim().toUpperCase();
    if (
      normalized === AssetContentType.TXT ||
      normalized === AssetContentType.IMAGE ||
      normalized === AssetContentType.VIDEO ||
      normalized === AssetContentType.AUDIO ||
      normalized === AssetContentType.URL ||
      normalized === AssetContentType.TABLE ||
      normalized === AssetContentType.BINARY ||
      normalized === AssetContentType.OTHER
    ) {
      return normalized;
    }

    return AssetContentType.OTHER;
  }

  private normalizeLinks(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
  }

  private normalizeBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1';
    }

    return false;
  }

  private normalizeSortOrder(value: unknown): Prisma.SortOrder {
    if (typeof value === 'string' && value.toUpperCase() === 'ASC') {
      return 'asc';
    }

    return 'desc';
  }

  private normalizeSortBy(value: unknown): SearchAssetsSortBy | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      return undefined;
    }

    if (
      !Object.values(SearchAssetsSortBy).includes(
        normalized as SearchAssetsSortBy,
      )
    ) {
      return undefined;
    }

    return normalized as SearchAssetsSortBy;
  }

  private buildSearchAssetsOrderBy(params: {
    sortBy?: unknown;
    sortOrder?: unknown;
  }): Prisma.AssetOrderByWithRelationInput[] {
    const normalizedSortBy = this.normalizeSortBy(params.sortBy);
    if (!normalizedSortBy) {
      return [{ lastScannedAt: 'desc' }, { updatedAt: 'desc' }];
    }

    const direction = this.normalizeSortOrder(params.sortOrder);

    let primary: Prisma.AssetOrderByWithRelationInput;
    switch (normalizedSortBy) {
      case SearchAssetsSortBy.NAME:
        primary = { name: direction };
        break;
      case SearchAssetsSortBy.SOURCE_ID:
        primary = { sourceId: direction };
        break;
      case SearchAssetsSortBy.ASSET_TYPE:
        primary = { assetType: direction };
        break;
      case SearchAssetsSortBy.STATUS:
        primary = { status: direction };
        break;
      case SearchAssetsSortBy.UPDATED_AT:
        primary = { updatedAt: direction };
        break;
      case SearchAssetsSortBy.CREATED_AT:
        primary = { createdAt: direction };
        break;
      case SearchAssetsSortBy.LAST_SCANNED_AT:
      default:
        primary = { lastScannedAt: direction };
        break;
    }

    const withStableFallback: Prisma.AssetOrderByWithRelationInput[] = [
      primary,
    ];

    if (!('updatedAt' in primary)) {
      withStableFallback.push({ updatedAt: 'desc' });
    }

    withStableFallback.push({ id: 'asc' });

    return withStableFallback;
  }

  private normalizeDate(value: unknown): Date | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value !== 'string' && typeof value !== 'number') {
      return undefined;
    }

    const candidate = new Date(value);
    if (Number.isNaN(candidate.getTime())) {
      return undefined;
    }

    return candidate;
  }

  private normalizeChartLimit(
    value: unknown,
    defaultValue: number,
    maxValue: number,
  ): number {
    const numericValue =
      typeof value === 'number' ? value : Number(value ?? defaultValue);
    if (!Number.isFinite(numericValue)) {
      return defaultValue;
    }

    return Math.min(maxValue, Math.max(1, Math.trunc(numericValue)));
  }

  private toInt(value: unknown): number {
    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'bigint'
          ? Number(value)
          : Number(value ?? 0);

    if (!Number.isFinite(numericValue)) {
      return 0;
    }

    return Math.trunc(numericValue);
  }

  private parseJsonField<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) {
      return fallback;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }

    return value as T;
  }

  private severityFromScore(score: number): Severity {
    switch (score) {
      case 5:
        return Severity.CRITICAL;
      case 4:
        return Severity.HIGH;
      case 3:
        return Severity.MEDIUM;
      case 2:
        return Severity.LOW;
      default:
        return Severity.INFO;
    }
  }

  private normalizeFindingLocation(
    value: Prisma.JsonValue | null,
  ): NormalizedFindingLocation | undefined {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;

    if (typeof record.path !== 'string' || record.path.trim().length === 0) {
      return undefined;
    }

    const location: NormalizedFindingLocation = {
      path: record.path.trim(),
    };

    if (
      typeof record.description === 'string' &&
      record.description.trim().length > 0
    ) {
      location.description = record.description.trim();
    }

    return location;
  }

  private normalizeSourceTypes(value: unknown): AssetType[] | undefined {
    const rawValues = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [];

    const normalized = rawValues
      .map((entry) => String(entry).trim().toUpperCase())
      .filter((entry): entry is AssetType =>
        Object.values(AssetType).includes(entry as AssetType),
      );

    if (normalized.length === 0) {
      return undefined;
    }

    return Array.from(new Set(normalized));
  }

  private normalizeStringArray(
    value: unknown,
    options?: { uppercase?: boolean },
  ): string[] | undefined {
    const values = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];

    const normalized = values
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .map((entry) => (options?.uppercase ? entry.toUpperCase() : entry));

    if (normalized.length === 0) {
      return undefined;
    }

    return Array.from(new Set(normalized));
  }

  private normalizeEnumArray<TEnum extends string>(
    value: unknown,
    enumValues: readonly TEnum[],
  ): TEnum[] | undefined {
    const normalized = this.normalizeStringArray(value, { uppercase: true });
    if (!normalized) {
      return undefined;
    }

    const filtered = normalized.filter((entry): entry is TEnum =>
      enumValues.includes(entry as TEnum),
    );

    if (filtered.length === 0) {
      return undefined;
    }

    return Array.from(new Set(filtered));
  }

  private buildFindingWhere(params: {
    detectorType?: unknown;
    customDetectorKey?: unknown;
    findingType?: unknown;
    category?: unknown;
    severity?: unknown;
    status?: unknown;
    includeResolved?: unknown;
    detectionIdentity?: unknown;
    firstDetectedAfter?: unknown;
    lastDetectedBefore?: unknown;
    runnerId?: unknown;
  }): Prisma.FindingWhereInput {
    const where: Prisma.FindingWhereInput = {};

    const detectorTypes = this.normalizeEnumArray(
      params.detectorType,
      Object.values(DetectorType),
    );
    if (detectorTypes) {
      where.detectorType = { in: detectorTypes };
    }

    const customDetectorKeys = this.normalizeStringArray(
      params.customDetectorKey,
    );
    if (customDetectorKeys) {
      where.customDetectorKey = { in: customDetectorKeys };
    }

    const findingTypes = this.normalizeStringArray(params.findingType);
    if (findingTypes) {
      where.findingType = { in: findingTypes };
    }

    const categories = this.normalizeStringArray(params.category);
    if (categories) {
      where.category = { in: categories };
    }

    const severities = this.normalizeEnumArray(
      params.severity,
      Object.values(Severity),
    );
    if (severities) {
      where.severity = { in: severities };
    }

    const statuses = this.normalizeEnumArray(
      params.status,
      Object.values(FindingStatus),
    );
    if (statuses) {
      where.status = { in: statuses };
    }

    const includeResolved = this.normalizeBoolean(params.includeResolved);
    if (!includeResolved && !where.status) {
      where.status = { not: FindingStatus.RESOLVED };
    }

    const detectionIdentities = this.normalizeStringArray(
      params.detectionIdentity,
    );
    if (detectionIdentities) {
      where.detectionIdentity = { in: detectionIdentities };
    }

    const runnerIds = this.normalizeStringArray(params.runnerId);
    if (runnerIds) {
      where.runnerId = { in: runnerIds };
    }

    const firstDetectedAfter = this.normalizeDate(params.firstDetectedAfter);
    if (firstDetectedAfter) {
      where.firstDetectedAt = { gte: firstDetectedAfter };
    }

    const lastDetectedBefore = this.normalizeDate(params.lastDetectedBefore);
    if (lastDetectedBefore) {
      where.lastDetectedAt = { lte: lastDetectedBefore };
    }

    return where;
  }

  private hasActiveFindingFilters(params: {
    detectorType?: unknown;
    customDetectorKey?: unknown;
    findingType?: unknown;
    category?: unknown;
    severity?: unknown;
    status?: unknown;
    detectionIdentity?: unknown;
    firstDetectedAfter?: unknown;
    lastDetectedBefore?: unknown;
    runnerId?: unknown;
  }): boolean {
    return Boolean(
      this.normalizeEnumArray(params.detectorType, Object.values(DetectorType))
        ?.length ||
      this.normalizeStringArray(params.customDetectorKey)?.length ||
      this.normalizeStringArray(params.findingType)?.length ||
      this.normalizeStringArray(params.category)?.length ||
      this.normalizeEnumArray(params.severity, Object.values(Severity))
        ?.length ||
      this.normalizeEnumArray(params.status, Object.values(FindingStatus))
        ?.length ||
      this.normalizeStringArray(params.detectionIdentity)?.length ||
      this.normalizeStringArray(params.runnerId)?.length ||
      this.normalizeDate(params.firstDetectedAfter) ||
      this.normalizeDate(params.lastDetectedBefore),
    );
  }

  asset(
    assetWhereUniqueInput: Prisma.AssetWhereUniqueInput,
  ): Promise<Asset | null> {
    return this.prisma.asset.findUnique({
      where: assetWhereUniqueInput,
    });
  }

  async getAssetById(assetId: string): Promise<NormalizedAsset | null> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return null;
    }

    return {
      ...asset,
      links: this.normalizeLinks(asset.links),
    };
  }

  assets(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.AssetWhereUniqueInput;
    where?: Prisma.AssetWhereInput;
    orderBy?: Prisma.AssetOrderByWithRelationInput;
  }): Promise<Asset[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.asset.findMany({
      skip,
      take,
      cursor,
      where,
      orderBy,
    });
  }

  async listAssets(params: {
    skip?: number;
    limit?: number;
    search?: string;
    sourceId?: string;
    runnerId?: string;
    status?: AssetStatus[];
    sourceTypes?: AssetType[];
  }): Promise<{
    items: Array<Omit<Asset, 'links'> & { links: string[] }>;
    total: number;
    skip: number;
    limit: number;
  }> {
    const {
      skip = 0,
      limit = 50,
      search,
      sourceId,
      runnerId,
      status,
      sourceTypes,
    } = params;

    const rawSkip = typeof skip === 'number' ? skip : Number(skip ?? 0);
    const rawLimit = typeof limit === 'number' ? limit : Number(limit ?? 50);
    const safeSkip = Number.isFinite(rawSkip) ? Math.max(0, rawSkip) : 0;
    const safeLimit = Number.isFinite(rawLimit)
      ? Math.min(200, Math.max(1, rawLimit))
      : 50;

    const where: Prisma.AssetWhereInput = {};

    if (search?.trim()) {
      where.name = {
        contains: search.trim(),
        mode: 'insensitive',
      };
    }

    if (sourceId) {
      where.sourceId = sourceId;
    }

    if (runnerId) {
      where.runnerId = runnerId;
    }

    const normalizedStatuses = this.normalizeEnumArray(
      status,
      Object.values(AssetStatus),
    );
    if (normalizedStatuses && normalizedStatuses.length > 0) {
      where.status = { in: normalizedStatuses };
    }

    if (sourceTypes && sourceTypes.length > 0) {
      where.sourceType = { in: sourceTypes };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        skip: safeSkip,
        take: safeLimit,
        orderBy: [{ lastScannedAt: 'desc' }, { updatedAt: 'desc' }],
      }),
      this.prisma.asset.count({ where }),
    ]);

    const normalizedItems = items.map((item) => ({
      ...item,
      links: this.normalizeLinks(item.links),
    }));

    return {
      items: normalizedItems,
      total,
      skip: safeSkip,
      limit: safeLimit,
    };
  }

  async searchAssets(params: SearchAssetsRequestDto): Promise<{
    items: Array<{
      asset: NormalizedAsset;
      findings: FindingForAssetListItem[];
    }>;
    total: number;
    skip: number;
    limit: number;
  }> {
    const assetFilters = params.assets ?? {};
    const findingFilters = params.findings ?? {};
    const page = params.page ?? {};
    const options = params.options ?? {};

    const skip = page.skip ?? 0;
    const limit = page.limit ?? 50;
    const sortBy = page.sortBy;
    const sortOrder = page.sortOrder;
    const search = assetFilters.search;
    const sourceId = assetFilters.sourceId;
    const runnerId = assetFilters.runnerId;
    const assetStatus = assetFilters.status;
    const sourceTypes = assetFilters.sourceTypes;
    const excludeFindings = this.normalizeBoolean(options.excludeFindings);
    const includeAssetsWithoutFindings = this.normalizeBoolean(
      options.includeAssetsWithoutFindings,
    );

    const detectorType = findingFilters.detectorType;
    const customDetectorKey = findingFilters.customDetectorKey;
    const findingType = findingFilters.findingType;
    const category = findingFilters.category;
    const severity = findingFilters.severity;
    const status = findingFilters.status;
    const includeResolved = findingFilters.includeResolved;
    const detectionIdentity = findingFilters.detectionIdentity;
    const firstDetectedAfter = findingFilters.firstDetectedAfter;
    const lastDetectedBefore = findingFilters.lastDetectedBefore;
    const findingRunnerId = findingFilters.runnerId;

    const rawSkip = typeof skip === 'number' ? skip : Number(skip ?? 0);
    const rawLimit = typeof limit === 'number' ? limit : Number(limit ?? 50);
    const safeSkip = Number.isFinite(rawSkip) ? Math.max(0, rawSkip) : 0;
    const safeLimit = Number.isFinite(rawLimit)
      ? Math.min(200, Math.max(1, rawLimit))
      : 50;

    const where: Prisma.AssetWhereInput = {};
    const orderBy = this.buildSearchAssetsOrderBy({ sortBy, sortOrder });

    if (typeof search === 'string' && search.trim()) {
      where.name = {
        contains: search.trim(),
        mode: 'insensitive',
      };
    }

    if (typeof sourceId === 'string' && sourceId.trim()) {
      where.sourceId = sourceId.trim();
    }

    if (typeof runnerId === 'string' && runnerId.trim()) {
      where.runnerId = runnerId.trim();
    }

    const normalizedAssetStatuses = this.normalizeEnumArray(
      assetStatus,
      Object.values(AssetStatus),
    );
    if (normalizedAssetStatuses && normalizedAssetStatuses.length > 0) {
      where.status = { in: normalizedAssetStatuses };
    }

    const normalizedSourceTypes = this.normalizeSourceTypes(sourceTypes);
    if (normalizedSourceTypes && normalizedSourceTypes.length > 0) {
      where.sourceType = { in: normalizedSourceTypes };
    }

    const findingWhere = excludeFindings
      ? undefined
      : this.buildFindingWhere({
          detectorType,
          customDetectorKey,
          findingType,
          category,
          severity,
          status,
          includeResolved,
          detectionIdentity,
          firstDetectedAfter,
          lastDetectedBefore,
          runnerId: findingRunnerId,
        });

    const hasActiveFindingFilters = this.hasActiveFindingFilters({
      detectorType,
      customDetectorKey,
      findingType,
      category,
      severity,
      status,
      detectionIdentity,
      firstDetectedAfter,
      lastDetectedBefore,
      runnerId: findingRunnerId,
    });

    if (
      findingWhere &&
      (!includeAssetsWithoutFindings || hasActiveFindingFilters)
    ) {
      where.findings = { some: findingWhere };
    }

    const [assets, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        skip: safeSkip,
        take: safeLimit,
        orderBy,
      }),
      this.prisma.asset.count({ where }),
    ]);

    if (assets.length === 0) {
      return {
        items: [],
        total,
        skip: safeSkip,
        limit: safeLimit,
      };
    }

    if (excludeFindings) {
      return {
        items: assets.map((asset) => ({
          asset: {
            ...asset,
            links: this.normalizeLinks(asset.links),
          },
          findings: [],
        })),
        total,
        skip: safeSkip,
        limit: safeLimit,
      };
    }

    const findings = await this.prisma.finding.findMany({
      where: {
        ...(findingWhere ?? {}),
        assetId: {
          in: assets.map((asset) => asset.id),
        },
      },
      orderBy: [
        { assetId: 'asc' },
        { lastDetectedAt: 'desc' },
        { detectedAt: 'desc' },
      ],
      select: findingForAssetSelect,
    });

    const findingsByAssetId = new Map<string, FindingForAssetListItem[]>();

    for (const finding of findings) {
      const normalizedFinding: FindingForAssetListItem = {
        ...finding,
        confidence: Number(finding.confidence),
        runnerId: finding.runnerId ?? undefined,
        customDetectorId: finding.customDetectorId ?? undefined,
        customDetectorKey: finding.customDetectorKey ?? undefined,
        customDetectorName: finding.customDetectorName ?? undefined,
        redactedContent: finding.redactedContent ?? undefined,
        contextBefore: finding.contextBefore ?? undefined,
        contextAfter: finding.contextAfter ?? undefined,
        location: this.normalizeFindingLocation(finding.location),
        resolutionReason: finding.resolutionReason ?? undefined,
        firstDetectedAt: finding.firstDetectedAt ?? undefined,
        lastDetectedAt: finding.lastDetectedAt ?? undefined,
        resolvedAt: finding.resolvedAt ?? undefined,
      };

      const existing = findingsByAssetId.get(finding.assetId);
      if (!existing) {
        findingsByAssetId.set(finding.assetId, [normalizedFinding]);
        continue;
      }

      existing.push(normalizedFinding);
    }

    return {
      items: assets.map((asset) => ({
        asset: {
          ...asset,
          links: this.normalizeLinks(asset.links),
        },
        findings: findingsByAssetId.get(asset.id) ?? [],
      })),
      total,
      skip: safeSkip,
      limit: safeLimit,
    };
  }

  async searchAssetsCharts(
    params: SearchAssetsChartsRequestDto,
  ): Promise<SearchAssetsChartsResponseDto> {
    const assetFilters = params?.assets ?? {};
    const findingFilters = params?.findings ?? {};
    const options = params?.options ?? {};

    const topAssetsLimit = this.normalizeChartLimit(
      options.topAssetsLimit,
      15,
      50,
    );
    const topSourcesLimit = this.normalizeChartLimit(
      options.topSourcesLimit,
      10,
      50,
    );

    const assetConditions: Prisma.Sql[] = [];
    const search = assetFilters.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      assetConditions.push(
        Prisma.sql`(
          a.name ILIKE ${pattern}
          OR a.external_url ILIKE ${pattern}
          OR a.hash ILIKE ${pattern}
          OR a.id ILIKE ${pattern}
        )`,
      );
    }

    if (typeof assetFilters.sourceId === 'string' && assetFilters.sourceId) {
      assetConditions.push(Prisma.sql`a.source_id = ${assetFilters.sourceId}`);
    }

    if (typeof assetFilters.runnerId === 'string' && assetFilters.runnerId) {
      assetConditions.push(Prisma.sql`a.runner_id = ${assetFilters.runnerId}`);
    }

    const assetStatuses = this.normalizeEnumArray(
      assetFilters.status,
      Object.values(AssetStatus),
    );
    if (assetStatuses?.length) {
      assetConditions.push(
        Prisma.sql`a.status IN (${Prisma.join(assetStatuses)})`,
      );
    }

    const sourceTypes = this.normalizeSourceTypes(assetFilters.sourceTypes);
    if (sourceTypes?.length) {
      assetConditions.push(
        Prisma.sql`a.source_type IN (${Prisma.join(sourceTypes)})`,
      );
    }

    const findingConditions: Prisma.Sql[] = [];

    const detectorTypes = this.normalizeEnumArray(
      findingFilters.detectorType,
      Object.values(DetectorType),
    );
    if (detectorTypes?.length) {
      findingConditions.push(
        Prisma.sql`f.detector_type IN (${Prisma.join(detectorTypes)})`,
      );
    }

    const customDetectorKeys = this.normalizeStringArray(
      findingFilters.customDetectorKey,
    );
    if (customDetectorKeys?.length) {
      findingConditions.push(
        Prisma.sql`f.custom_detector_key IN (${Prisma.join(customDetectorKeys)})`,
      );
    }

    const findingTypes = this.normalizeStringArray(findingFilters.findingType);
    if (findingTypes?.length) {
      findingConditions.push(
        Prisma.sql`f.finding_type IN (${Prisma.join(findingTypes)})`,
      );
    }

    const categories = this.normalizeStringArray(findingFilters.category);
    if (categories?.length) {
      findingConditions.push(
        Prisma.sql`f.category IN (${Prisma.join(categories)})`,
      );
    }

    const severities = this.normalizeEnumArray(
      findingFilters.severity,
      Object.values(Severity),
    );
    if (severities?.length) {
      findingConditions.push(
        Prisma.sql`f.severity IN (${Prisma.join(severities)})`,
      );
    }

    const statuses = this.normalizeEnumArray(
      findingFilters.status,
      Object.values(FindingStatus),
    );
    if (statuses?.length) {
      findingConditions.push(
        Prisma.sql`f.status IN (${Prisma.join(statuses)})`,
      );
    }

    const detectionIdentities = this.normalizeStringArray(
      findingFilters.detectionIdentity,
    );
    if (detectionIdentities?.length) {
      findingConditions.push(
        Prisma.sql`f.detection_identity IN (${Prisma.join(detectionIdentities)})`,
      );
    }

    const findingRunnerIds = this.normalizeStringArray(findingFilters.runnerId);
    if (findingRunnerIds?.length) {
      findingConditions.push(
        Prisma.sql`f.runner_id IN (${Prisma.join(findingRunnerIds)})`,
      );
    }

    const firstDetectedAfter = this.normalizeDate(
      findingFilters.firstDetectedAfter,
    );
    if (firstDetectedAfter) {
      findingConditions.push(
        Prisma.sql`f.first_detected_at >= ${firstDetectedAfter}`,
      );
    }

    const lastDetectedBefore = this.normalizeDate(
      findingFilters.lastDetectedBefore,
    );
    if (lastDetectedBefore) {
      findingConditions.push(
        Prisma.sql`f.last_detected_at <= ${lastDetectedBefore}`,
      );
    }

    const includeResolved = this.normalizeBoolean(
      findingFilters.includeResolved,
    );
    if (!includeResolved && !statuses?.length) {
      findingConditions.push(Prisma.sql`f.status <> ${FindingStatus.RESOLVED}`);
    }

    const assetWhereSql = assetConditions.length
      ? Prisma.sql`WHERE ${Prisma.join(assetConditions, ' AND ')}`
      : Prisma.empty;
    const findingWhereSql = findingConditions.length
      ? Prisma.sql`WHERE ${Prisma.join(findingConditions, ' AND ')}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      RawAssetsChartsQueryRow[]
    >(Prisma.sql`
      WITH filtered_assets AS (
        SELECT
          a.id,
          a.name,
          a.external_url,
          a.status,
          a.source_id
        FROM assets a
        ${assetWhereSql}
      ),
      filtered_findings AS (
        SELECT
          f.asset_id,
          f.severity
        FROM findings f
        INNER JOIN filtered_assets fa ON fa.id = f.asset_id
        ${findingWhereSql}
      ),
      totals AS (
        SELECT
          COUNT(*)::int AS "totalAssets",
          COUNT(*) FILTER (WHERE status = 'NEW')::int AS "newAssets",
          COUNT(*) FILTER (WHERE status = 'UPDATED')::int AS "updatedAssets",
          COUNT(*) FILTER (WHERE status = 'UNCHANGED')::int AS "unchangedAssets"
        FROM filtered_assets
      ),
      top_assets AS (
        SELECT
          fa.id AS "assetId",
          COALESCE(NULLIF(fa.name, ''), NULLIF(fa.external_url, ''), fa.id) AS "assetName",
          fa.source_id AS "sourceId",
          COUNT(ff.asset_id)::int AS "findingsCount",
          COALESCE(
            MAX(
              CASE ff.severity
                WHEN 'CRITICAL' THEN 5
                WHEN 'HIGH' THEN 4
                WHEN 'MEDIUM' THEN 3
                WHEN 'LOW' THEN 2
                ELSE 1
              END
            ),
            1
          )::int AS "severityScore"
        FROM filtered_assets fa
        INNER JOIN filtered_findings ff ON ff.asset_id = fa.id
        GROUP BY fa.id, fa.name, fa.external_url, fa.source_id
        ORDER BY "severityScore" DESC, "findingsCount" DESC, "assetName" ASC
        LIMIT ${topAssetsLimit}
      ),
      top_sources AS (
        SELECT
          fa.source_id AS "sourceId",
          COALESCE(NULLIF(s.name, ''), fa.source_id) AS "sourceName",
          COUNT(*)::int AS "assetCount"
        FROM filtered_assets fa
        LEFT JOIN sources s ON s.id = fa.source_id
        GROUP BY fa.source_id, s.name
        ORDER BY "assetCount" DESC, "sourceName" ASC
        LIMIT ${topSourcesLimit}
      )
      SELECT
        COALESCE((SELECT row_to_json(t) FROM totals t), '{}'::json) AS "totals",
        COALESCE((SELECT json_agg(ta) FROM top_assets ta), '[]'::json) AS "topAssetsByFindings",
        COALESCE((SELECT json_agg(ts) FROM top_sources ts), '[]'::json) AS "topSourcesByAssetVolume"
    `);

    const row = rows[0];
    const totals = this.parseJsonField<RawChartsTotals>(row?.totals, {});
    const topAssets = this.parseJsonField<RawChartsTopAsset[]>(
      row?.topAssetsByFindings,
      [],
    );
    const topSources = this.parseJsonField<RawChartsTopSource[]>(
      row?.topSourcesByAssetVolume,
      [],
    );

    return {
      totals: {
        totalAssets: this.toInt(totals.totalAssets),
        newAssets: this.toInt(totals.newAssets),
        updatedAssets: this.toInt(totals.updatedAssets),
        unchangedAssets: this.toInt(totals.unchangedAssets),
      },
      topAssetsByFindings: topAssets.map((item) => {
        const severityScore = Math.min(
          5,
          Math.max(1, this.toInt(item.severityScore)),
        );
        return {
          assetId: item.assetId,
          assetName: item.assetName,
          sourceId: item.sourceId ?? null,
          findingsCount: this.toInt(item.findingsCount),
          severityScore,
          highestSeverity: this.severityFromScore(severityScore),
        };
      }),
      topSourcesByAssetVolume: topSources.map((item) => ({
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        assetCount: this.toInt(item.assetCount),
      })),
    };
  }

  createAsset(data: Prisma.AssetCreateInput): Promise<Asset> {
    return this.prisma.asset.create({
      data,
    });
  }

  updateAsset(params: {
    where: Prisma.AssetWhereUniqueInput;
    data: Prisma.AssetUpdateInput;
  }): Promise<Asset> {
    const { where, data } = params;
    return this.prisma.asset.update({
      data,
      where,
    });
  }

  deleteAsset(where: Prisma.AssetWhereUniqueInput): Promise<Asset> {
    return this.prisma.asset.delete({
      where,
    });
  }

  async bulkIngest(
    sourceId: string,
    runnerId: string,
    assets: Record<string, any>[],
    options?: {
      finalizeRun?: boolean;
      isFullScan?: boolean;
    },
  ) {
    const finalizeRun = options?.finalizeRun ?? true;
    const isFullScan = options?.isFullScan ?? true;
    const { source } = await this.assertSourceAndRunner(sourceId, runnerId);

    // Process in batches to avoid transaction timeout
    // Reduced to 25 to handle finding updates efficiently
    const BATCH_SIZE = 25;
    const batches: Record<string, any>[][] = [];

    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      batches.push(assets.slice(i, i + BATCH_SIZE));
    }

    // Get all existing assets once (outside transactions)
    const existingAssets = await this.prisma.asset.findMany({
      where: { sourceId },
    });

    const existingAssetsMap = new Map(
      existingAssets.map((asset) => [asset.hash, asset]),
    );

    // Track overall statistics
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;
    let totalFindings = 0;

    // Process each batch in its own transaction
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      const result = await this.processBatch(
        batch,
        sourceId,
        runnerId,
        source.type,
        existingAssetsMap,
        isFullScan,
      );

      totalCreated += result.created;
      totalUpdated += result.updated;
      totalUnchanged += result.unchanged;
      totalFindings += result.findings;

      // Log progress
      console.log(
        `Processed batch ${batchIndex + 1}/${batches.length}: ` +
          `${result.created} created, ${result.updated} updated, ` +
          `${result.unchanged} unchanged, ${result.findings} findings`,
      );
    }

    if (!finalizeRun) {
      return {
        ingested: assets.length,
        created: totalCreated,
        updated: totalUpdated,
        unchanged: totalUnchanged,
        deleted: 0,
        findings: totalFindings,
      };
    }

    // Update final runner stats
    await this.prisma.$transaction(
      async (tx) => {
        await tx.runner.update({
          where: { id: runnerId },
          data: {
            assetsCreated: totalCreated,
            assetsUpdated: totalUpdated,
            assetsUnchanged: totalUnchanged,
            totalFindings: totalFindings,
          },
        });
      },
      {
        timeout: 15000,
      },
    );

    return {
      ingested: assets.length,
      created: totalCreated,
      updated: totalUpdated,
      unchanged: totalUnchanged,
      deleted: 0,
      findings: totalFindings,
    };
  }

  async finalizeIngestRun(
    sourceId: string,
    runnerId: string,
    seenHashes: string[],
    isFullScan: boolean,
  ): Promise<{ deleted: number }> {
    await this.assertSourceAndRunner(sourceId, runnerId);

    if (!isFullScan) {
      // Sampling means not all assets appear in every run — no deletion logic.
      return { deleted: 0 };
    }

    // Full scan (strategy=ALL): every asset in the source was visited.
    // Assets absent from seenHashes no longer exist in the source → mark DELETED
    // and auto-resolve their open findings.
    const missingAssets = await this.prisma.asset.findMany({
      where: {
        sourceId,
        status: { not: AssetStatus.DELETED },
        ...(seenHashes.length > 0 ? { hash: { notIn: seenHashes } } : {}),
      },
    });

    if (missingAssets.length === 0) {
      return { deleted: 0 };
    }

    const missingAssetIds = missingAssets.map((a) => a.id);

    const hasManualStatusOverride = (finding: any): boolean => {
      const history = Array.isArray(finding.history) ? finding.history : [];
      const lastStatusChange = [...history]
        .reverse()
        .find(
          (entry: any) => entry.eventType === HistoryEventType.STATUS_CHANGED,
        );
      return lastStatusChange
        ? lastStatusChange.status !== FindingStatus.OPEN
        : false;
    };

    await this.prisma.$transaction(
      async (tx) => {
        // Mark assets as DELETED
        await tx.asset.updateMany({
          where: { id: { in: missingAssetIds } },
          data: { status: AssetStatus.DELETED, runnerId },
        });

        // Resolve open findings on deleted assets
        const openFindings = await tx.finding.findMany({
          where: {
            assetId: { in: missingAssetIds },
            status: FindingStatus.OPEN,
          },
        });

        const findingsToResolve = openFindings.filter(
          (f) => !hasManualStatusOverride(f),
        );

        const now = new Date();
        for (const finding of findingsToResolve) {
          const currentHistory = Array.isArray(finding.history)
            ? finding.history
            : [];
          await tx.finding.update({
            where: { id: finding.id },
            data: {
              status: FindingStatus.RESOLVED,
              runnerId,
              resolvedAt: now,
              resolutionReason: 'Asset deleted from source (full scan)',
              history: [
                ...currentHistory,
                {
                  timestamp: now,
                  runnerId,
                  eventType: HistoryEventType.STATUS_CHANGED,
                  status: FindingStatus.RESOLVED,
                  changeReason: 'Asset deleted from source (full scan)',
                },
              ],
            },
          });
        }

        // Update runner stats with deleted count
        await tx.runner.update({
          where: { id: runnerId },
          data: { assetsDeleted: missingAssetIds.length },
        });
      },
      { timeout: 30000 },
    );

    return { deleted: missingAssetIds.length };
  }

  private processBatch(
    batch: Record<string, any>[],
    sourceId: string,
    runnerId: string,
    sourceType: AssetType,
    existingAssetsMap: Map<string, Asset>,
    isFullScan: boolean = true,
  ): Promise<{
    created: number;
    updated: number;
    unchanged: number;
    findings: number;
  }> {
    return this.prisma.$transaction(
      async (tx) => {
        const scannedAt = new Date();
        // Categorize assets for bulk operations
        const assetsToCreate: Prisma.AssetCreateManyInput[] = [];
        const assetsToUpdate: { id: string; data: any }[] = [];
        const assetsUnchanged: string[] = [];

        for (const asset of batch) {
          const { hash, checksum, name, external_url, links, asset_type } =
            asset;

          const assetHash = String(hash);
          const existingAsset = existingAssetsMap.get(assetHash);

          const assetData = {
            checksum: String(checksum),
            name: String(name),
            externalUrl: String(external_url),
            links: this.normalizeLinks(links),
            assetType: this.normalizeAssetType(asset_type),
            sourceType,
            runnerId,
            sourceId,
            lastScannedAt: scannedAt,
          };

          if (!existingAsset) {
            // Asset is NEW - prepare for bulk create
            assetsToCreate.push({
              hash: assetHash,
              ...assetData,
              status: AssetStatus.NEW,
            });
          } else if (existingAsset.checksum !== String(checksum)) {
            // Asset is UPDATED - prepare for individual update
            assetsToUpdate.push({
              id: existingAsset.id,
              data: {
                ...assetData,
                status: AssetStatus.UPDATED,
              },
            });

            // Update map
            existingAssetsMap.set(assetHash, {
              ...existingAsset,
              ...assetData,
              status: AssetStatus.UPDATED,
            });
          } else {
            // Asset is UNCHANGED
            assetsUnchanged.push(existingAsset.id);
            existingAssetsMap.set(assetHash, {
              ...existingAsset,
              ...assetData,
              status: AssetStatus.UNCHANGED,
            });
          }
        }

        // Bulk create NEW assets
        if (assetsToCreate.length > 0) {
          await tx.asset.createMany({
            data: assetsToCreate,
          });

          const createdAssets = await tx.asset.findMany({
            where: {
              sourceId,
              hash: { in: assetsToCreate.map((a) => a.hash) },
            },
          });

          for (const createdAsset of createdAssets) {
            existingAssetsMap.set(createdAsset.hash, createdAsset);
          }
        }

        // Individual updates for UPDATED assets (Prisma limitation - no bulk update with different data)
        for (const { id, data } of assetsToUpdate) {
          await tx.asset.update({
            where: { id },
            data,
          });
        }

        // Bulk update UNCHANGED assets (same data for all)
        if (assetsUnchanged.length > 0) {
          await tx.asset.updateMany({
            where: { id: { in: assetsUnchanged } },
            data: {
              runnerId,
              status: AssetStatus.UNCHANGED,
              lastScannedAt: scannedAt,
            },
          });
        }

        // Collect ALL scanned asset IDs — needed to resolve findings on assets
        // that were scanned clean (zero findings) in this batch.
        const allScannedAssetIds = new Set<string>();
        for (const asset of batch) {
          const mappedAsset = existingAssetsMap.get(String(asset.hash));
          if (mappedAsset) allScannedAssetIds.add(mappedAsset.id);
        }

        // Collect individual detections with identity
        const incomingDetections: Map<string, any> = new Map();

        for (const asset of batch) {
          if (asset.findings?.length > 0) {
            const assetHash = String(asset.hash);
            const mappedAsset = existingAssetsMap.get(assetHash);

            if (!mappedAsset) {
              continue;
            }

            const assetId = mappedAsset.id;

            for (const finding of asset.findings) {
              const identity = generateDetectionIdentity({
                assetId,
                detectorType: finding.detector_type,
                findingType: finding.finding_type,
                matchedContent: finding.matched_content,
                customDetectorKey: finding.custom_detector_key,
              });

              // Deduplicate within same scan
              if (!incomingDetections.has(identity)) {
                incomingDetections.set(identity, {
                  detectionIdentity: identity,
                  assetId,
                  sourceId,
                  runnerId,
                  detectorType: finding.detector_type,
                  customDetectorId: finding.custom_detector_id || null,
                  customDetectorKey: finding.custom_detector_key || null,
                  customDetectorName: finding.custom_detector_name || null,
                  findingType: finding.finding_type,
                  category: finding.category,
                  severity: finding.severity.toUpperCase(),
                  confidence: finding.confidence,
                  matchedContent: finding.matched_content,
                  redactedContent: finding.redacted_content || null,
                  contextBefore: finding.context_before || null,
                  contextAfter: finding.context_after || null,
                  location: finding.location || null,
                  detectedAt: new Date(finding.detected_at || Date.now()),
                  pipelineResult: finding.pipeline_result || finding.extracted_data || null,
                });
              }
            }
          }
        }

        const customDetectorKeys = Array.from(
          new Set(
            Array.from(incomingDetections.values())
              .map((d) => d.customDetectorKey)
              .filter(
                (key): key is string =>
                  typeof key === 'string' && key.trim().length > 0,
              )
              .map((key) => key.trim()),
          ),
        );
        if (customDetectorKeys.length > 0) {
          const customDetectors = await tx.customDetector.findMany({
            where: {
              key: { in: customDetectorKeys },
            },
            select: {
              id: true,
              key: true,
              name: true,
            },
          });
          const customDetectorByKey = new Map(
            customDetectors.map((detector) => [detector.key, detector]),
          );
          for (const detection of incomingDetections.values()) {
            const key = detection.customDetectorKey;
            if (typeof key !== 'string' || key.trim().length === 0) {
              continue;
            }
            const mapped = customDetectorByKey.get(key.trim());
            if (!mapped) {
              continue;
            }
            detection.customDetectorId = mapped.id;
            if (!detection.customDetectorName) {
              detection.customDetectorName = mapped.name;
            }
          }
        }

        // Fetch existing findings for ALL scanned assets (not just those with
        // findings in this batch) so we can resolve findings on assets that
        // came back clean.
        const existingFindings = await tx.finding.findMany({
          where: { assetId: { in: Array.from(allScannedAssetIds) } },
        });

        const existingMap = new Map(
          existingFindings.map((f) => [f.detectionIdentity, f]),
        );

        const toCreate: any[] = [];
        const toUpdate: any[] = [];
        let newFindings = 0;

        // Process each detection
        for (const [identity, detection] of incomingDetections) {
          const existing = existingMap.get(identity);

          if (!existing) {
            // NEW DETECTION
            // Strip extraction-only fields that don't belong on the Finding model
            const findingData = Object.fromEntries(
              Object.entries(detection as Record<string, unknown>).filter(
                ([k]) => k !== 'pipelineResult',
              ),
            );
            toCreate.push({
              ...findingData,
              status: FindingStatus.OPEN,
              firstDetectedAt: detection.detectedAt,
              lastDetectedAt: detection.detectedAt,
              history: [
                {
                  timestamp: detection.detectedAt,
                  runnerId,
                  eventType: HistoryEventType.DETECTED,
                  status: FindingStatus.OPEN,
                  severity: detection.severity,
                  confidence: detection.confidence,
                  location: detection.location,
                },
              ],
            });
            newFindings++;
          } else {
            // EXISTING DETECTION
            const currentHistory: FindingHistoryEntry[] = Array.isArray(
              existing.history,
            )
              ? (existing.history as unknown as FindingHistoryEntry[])
              : [];
            const lastStatusChange = [...currentHistory]
              .reverse()
              .find(
                (entry: any) =>
                  entry.eventType === HistoryEventType.STATUS_CHANGED,
              );
            const lastSeverityChange = [...currentHistory]
              .reverse()
              .find(
                (entry: any) =>
                  entry.eventType === HistoryEventType.SEVERITY_CHANGED,
              );
            const statusOverride = lastStatusChange
              ? lastStatusChange.status !== FindingStatus.OPEN
              : false;
            const severityOverride = Boolean(lastSeverityChange);
            const wasResolved = existing.status === FindingStatus.RESOLVED;
            const shouldReopen = wasResolved && !statusOverride;
            const statusToApply = shouldReopen
              ? FindingStatus.OPEN
              : existing.status;
            const severityToApply = severityOverride
              ? existing.severity
              : detection.severity;

            // Check if finding content has changed
            const hasChanged =
              shouldReopen ||
              (!severityOverride && existing.severity !== detection.severity) ||
              Number(existing.confidence) !== detection.confidence ||
              existing.matchedContent !== detection.matchedContent;

            if (hasChanged) {
              // Finding changed - add history entry
              const eventType = shouldReopen
                ? HistoryEventType.RE_OPENED
                : HistoryEventType.RE_DETECTED;

              // When re-opening, also append STATUS_CHANGED(OPEN) so that
              // hasManualStatusOverride correctly reflects the current state.
              // Without this, a previous STATUS_CHANGED(RESOLVED) in history
              // would prevent future auto-resolution when the finding disappears.
              const extraHistoryEntries: object[] = shouldReopen
                ? [
                    {
                      timestamp: detection.detectedAt,
                      runnerId,
                      eventType: HistoryEventType.STATUS_CHANGED,
                      status: FindingStatus.OPEN,
                      severity: severityToApply,
                      changeReason:
                        'Re-opened: detection found again after resolution',
                    },
                  ]
                : [];

              toUpdate.push({
                id: existing.id,
                data: {
                  runnerId,
                  severity: severityToApply,
                  confidence: detection.confidence,
                  matchedContent: detection.matchedContent,
                  redactedContent: detection.redactedContent,
                  contextBefore: detection.contextBefore,
                  contextAfter: detection.contextAfter,
                  location: detection.location,
                  customDetectorId: detection.customDetectorId,
                  customDetectorKey: detection.customDetectorKey,
                  customDetectorName: detection.customDetectorName,
                  status: statusToApply,
                  detectedAt: detection.detectedAt,
                  lastDetectedAt: detection.detectedAt,
                  resolvedAt: shouldReopen ? null : existing.resolvedAt,
                  resolutionReason: shouldReopen
                    ? null
                    : existing.resolutionReason,
                  history: [
                    ...currentHistory,
                    {
                      timestamp: detection.detectedAt,
                      runnerId,
                      eventType,
                      status: statusToApply,
                      severity: severityToApply,
                      confidence: detection.confidence,
                      location: detection.location,
                    },
                    ...extraHistoryEntries,
                  ],
                },
              });
            } else {
              // Finding unchanged - just update lastDetectedAt without history entry
              toUpdate.push({
                id: existing.id,
                data: {
                  runnerId,
                  lastDetectedAt: detection.detectedAt,
                  detectedAt: detection.detectedAt,
                  // Update context and location in case they changed
                  contextBefore: detection.contextBefore,
                  contextAfter: detection.contextAfter,
                  location: detection.location,
                  customDetectorId: detection.customDetectorId,
                  customDetectorKey: detection.customDetectorKey,
                  customDetectorName: detection.customDetectorName,
                },
              });
            }

            existingMap.delete(identity); // Mark as processed
          }
        }

        // Bulk create new findings
        if (toCreate.length > 0) {
          await tx.finding.createMany({ data: toCreate });
        }

        // Update existing findings
        for (const update of toUpdate) {
          await tx.finding.update({
            where: { id: update.id },
            data: update.data,
          });
        }

        // Save extraction data for findings that have it
        // We need to look up the finding IDs after createMany since Prisma doesn't return them
        const detectionsWithExtraction = Array.from(
          incomingDetections.values(),
        ).filter((d) => d.pipelineResult != null && d.customDetectorKey);
        if (detectionsWithExtraction.length > 0) {
          const identities = detectionsWithExtraction.map(
            (d) => d.detectionIdentity,
          );
          const savedFindings = await tx.finding.findMany({
            where: { detectionIdentity: { in: identities } },
            select: { id: true, detectionIdentity: true },
          });
          const savedFindingByIdentity = new Map(
            savedFindings.map((f) => [f.detectionIdentity, f]),
          );
          for (const detection of detectionsWithExtraction) {
            const savedFinding = savedFindingByIdentity.get(
              detection.detectionIdentity,
            );
            if (!savedFinding) continue;
            await this.customDetectorExtractionsService.createFromIngestion({
              findingId: savedFinding.id,
              customDetectorId: detection.customDetectorId ?? null,
              customDetectorKey: detection.customDetectorKey,
              sourceId: detection.sourceId,
              assetId: detection.assetId,
              runnerId: detection.runnerId ?? null,
              detectorVersion: 1,
              pipelineResult: detection.pipelineResult,
              extractedAt: detection.detectedAt ?? new Date(),
            });
          }
        }

        // For full scans (strategy=ALL), resolve findings that were not re-detected
        // on scanned assets — absence means the finding is genuinely gone.
        // For partial scans (RANDOM/LATEST), skip this: only matched findings are
        // updated; unmatched findings on sampled assets are left open because the
        // sampling may not cover every detection on every run.
        if (isFullScan) {
          const hasManualStatusOverride = (finding: any) => {
            const history = Array.isArray(finding.history)
              ? finding.history
              : [];
            const lastStatusChange = [...history]
              .reverse()
              .find(
                (entry: any) =>
                  entry.eventType === HistoryEventType.STATUS_CHANGED,
              );
            return lastStatusChange
              ? lastStatusChange.status !== FindingStatus.OPEN
              : false;
          };

          const toResolve = Array.from(existingMap.values()).filter(
            (f: any) =>
              f.status === FindingStatus.OPEN && !hasManualStatusOverride(f),
          );

          for (const finding of toResolve) {
            const currentHistory = Array.isArray(finding.history)
              ? finding.history
              : [];

            await tx.finding.update({
              where: { id: finding.id },
              data: {
                status: FindingStatus.RESOLVED,
                runnerId,
                resolvedAt: new Date(),
                resolutionReason: 'Detection no longer present in scan',
                history: [
                  ...currentHistory,
                  {
                    timestamp: new Date(),
                    runnerId,
                    eventType: HistoryEventType.RESOLVED,
                    status: FindingStatus.RESOLVED,
                    changeReason: 'Detection no longer present in scan',
                  },
                ],
              },
            });
          }
        }

        return {
          created: assetsToCreate.length,
          updated: assetsToUpdate.length,
          unchanged: assetsUnchanged.length,
          findings: newFindings,
        };
      },
      {
        timeout: 30000, // 30 seconds timeout for batch processing with findings updates
      },
    );
  }
}
