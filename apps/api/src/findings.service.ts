import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CreateFindingDto } from './dto/create-finding.dto';
import { UpdateFindingDto } from './dto/update-finding.dto';
import {
  BulkUpdateFindingsDto,
  BulkUpdateFindingsResponseDto,
} from './dto/bulk-update-findings.dto';
import {
  QueryFindingsAssetsDto,
  AssetFindingsSort,
} from './dto/query-findings-assets.dto';
import { DetectorType, FindingStatus, Prisma, Severity } from '@prisma/client';
import { HistoryEventType } from './types/finding-history.types';
import { generateDetectionIdentity } from './utils/detection-identity';
import { QueryFindingsDiscoveryDto } from './dto/query-findings-discovery.dto';
import { SearchFindingsRequestDto } from './dto/search-findings-request.dto';
import { SearchFindingsChartsRequestDto } from './dto/search-findings-charts-request.dto';
import { SearchFindingsChartsResponseDto } from './dto/search-findings-charts-response.dto';

@Injectable()
export class FindingsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly searchFindingSelect = {
    id: true,
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
    detectionIdentity: true,
    location: true,
    status: true,
    resolvedAt: true,
    resolutionReason: true,
    comment: true,
    detectedAt: true,
    firstDetectedAt: true,
    lastDetectedAt: true,
    createdAt: true,
    updatedAt: true,
    asset: {
      select: {
        id: true,
        name: true,
        hash: true,
        externalUrl: true,
        links: true,
        assetType: true,
        sourceType: true,
      },
    },
    source: {
      select: {
        id: true,
        name: true,
        type: true,
      },
    },
  } satisfies Prisma.FindingSelect;

  private normalizeFilterValues(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.length > 0,
      );
    }
    if (typeof value === 'string' && value.length > 0) {
      return [value];
    }
    return [];
  }

  private buildSearchFindingsWhere(
    filters?: SearchFindingsRequestDto['filters'],
  ): Prisma.FindingWhereInput {
    const where: Prisma.FindingWhereInput = {};
    const includeResolved = filters?.includeResolved ?? false;

    // normalizeFilterValues handles both string[] and plain string inputs
    // (the MCP server passes raw JSON without class-transformer coercions)
    const detectorTypes = this.normalizeFilterValues(filters?.detectorType).map(
      (v) => v.toUpperCase(),
    ) as DetectorType[];
    if (detectorTypes.length) {
      where.detectorType = { in: detectorTypes };
    }
    const customDetectorKeys = this.normalizeFilterValues(
      filters?.customDetectorKey,
    );
    if (customDetectorKeys.length) {
      where.customDetectorKey = { in: customDetectorKeys };
    }
    const sourceIds = this.normalizeFilterValues(filters?.sourceId);
    if (sourceIds.length) {
      where.sourceId = { in: sourceIds };
    }
    const assetIds = this.normalizeFilterValues(filters?.assetId);
    if (assetIds.length) {
      where.assetId = { in: assetIds };
    }
    const runnerIds = this.normalizeFilterValues(filters?.runnerId);
    if (runnerIds.length) {
      where.runnerId = { in: runnerIds };
    }
    const findingTypes = this.normalizeFilterValues(filters?.findingType);
    if (findingTypes.length) {
      where.findingType = { in: findingTypes };
    }
    const categories = this.normalizeFilterValues(filters?.category);
    if (categories.length) {
      where.category = { in: categories };
    }
    const severities = this.normalizeFilterValues(filters?.severity).map((v) =>
      v.toUpperCase(),
    ) as Severity[];
    if (severities.length) {
      where.severity = { in: severities };
    }
    const statuses = this.normalizeFilterValues(filters?.status).map((v) =>
      v.toUpperCase(),
    ) as FindingStatus[];
    if (statuses.length) {
      where.status = { in: statuses };
    }
    const detectionIdentities = this.normalizeFilterValues(
      filters?.detectionIdentity,
    );
    if (detectionIdentities.length) {
      where.detectionIdentity = { in: detectionIdentities };
    }
    if (filters?.firstDetectedAfter) {
      where.firstDetectedAt = { gte: filters.firstDetectedAfter };
    }
    if (filters?.lastDetectedBefore) {
      where.lastDetectedAt = { lte: filters.lastDetectedBefore };
    }

    if (!includeResolved && !where.status) {
      where.status = { not: FindingStatus.RESOLVED };
    }

    const search = filters?.search?.trim();
    if (!search) {
      return where;
    }

    const upperSearch = search.toUpperCase();
    const textOr: Prisma.FindingWhereInput[] = [
      { id: { contains: search, mode: 'insensitive' } },
      { assetId: { contains: search, mode: 'insensitive' } },
      { sourceId: { contains: search, mode: 'insensitive' } },
      { runnerId: { contains: search, mode: 'insensitive' } },
      { findingType: { contains: search, mode: 'insensitive' } },
      { customDetectorKey: { contains: search, mode: 'insensitive' } },
      { customDetectorName: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
      { detectionIdentity: { contains: search, mode: 'insensitive' } },
      {
        asset: {
          is: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { externalUrl: { contains: search, mode: 'insensitive' } },
              { hash: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      },
      {
        source: {
          is: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      },
    ];

    if (
      Object.values(DetectorType).includes(upperSearch as DetectorType) &&
      !where.detectorType
    ) {
      textOr.push({ detectorType: upperSearch as DetectorType });
    }
    if (
      Object.values(Severity).includes(upperSearch as Severity) &&
      !where.severity
    ) {
      textOr.push({ severity: upperSearch as Severity });
    }
    if (
      Object.values(FindingStatus).includes(upperSearch as FindingStatus) &&
      !where.status
    ) {
      textOr.push({ status: upperSearch as FindingStatus });
    }

    return {
      ...where,
      AND: [{ OR: textOr }],
    };
  }

  private shouldRecordFeedbackStatus(status: FindingStatus): boolean {
    return (
      status === FindingStatus.FALSE_POSITIVE ||
      status === FindingStatus.IGNORED ||
      status === FindingStatus.RESOLVED
    );
  }

  private extractFeedbackLabel(findingType?: string | null): string | null {
    if (!findingType || typeof findingType !== 'string') {
      return null;
    }

    const normalized = findingType.trim();
    if (!normalized.toLowerCase().startsWith('class:')) {
      return null;
    }

    const label = normalized.slice('class:'.length).trim();
    return label.length > 0 ? label : null;
  }

  private async recordCustomDetectorFeedback(
    findings: Array<{
      id: string;
      sourceId: string;
      detectorType: DetectorType;
      customDetectorId: string | null;
      customDetectorKey: string | null;
      customDetectorName: string | null;
      findingType: string;
      matchedContent: string;
    }>,
    status: FindingStatus,
  ): Promise<void> {
    if (!this.shouldRecordFeedbackStatus(status)) {
      return;
    }

    const rows = findings
      .filter(
        (finding) =>
          finding.detectorType === DetectorType.CUSTOM &&
          typeof finding.customDetectorKey === 'string' &&
          finding.customDetectorKey.length > 0 &&
          finding.matchedContent.trim().length > 0,
      )
      .map((finding) => ({
        customDetectorId: finding.customDetectorId ?? null,
        sourceId: finding.sourceId,
        customDetectorKey: finding.customDetectorKey as string,
        customDetectorName: finding.customDetectorName ?? null,
        findingId: finding.id,
        findingType: finding.findingType,
        label: this.extractFeedbackLabel(finding.findingType),
        matchedContent: finding.matchedContent,
        status,
      }));

    if (rows.length === 0) {
      return;
    }

    await this.prisma.customDetectorFeedback.createMany({ data: rows });
  }

  private startOfDay(date: Date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private formatDateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private startOfWeek(date: Date) {
    const copy = this.startOfDay(date);
    const day = copy.getDay();
    const diff = (day + 6) % 7; // Monday as start of week
    copy.setDate(copy.getDate() - diff);
    return copy;
  }

  private startOfMonth(date: Date) {
    const copy = this.startOfDay(date);
    copy.setDate(1);
    return copy;
  }

  async create(createDto: CreateFindingDto) {
    const { location, ...rest } = createDto;
    let customDetectorId = createDto.customDetectorId;
    let customDetectorName = createDto.customDetectorName;
    if (
      createDto.detectorType === DetectorType.CUSTOM &&
      !customDetectorId &&
      createDto.customDetectorKey
    ) {
      const customDetector = await this.prisma.customDetector.findUnique({
        where: { key: createDto.customDetectorKey },
        select: { id: true, name: true },
      });
      if (customDetector) {
        customDetectorId = customDetector.id;
        if (!customDetectorName) {
          customDetectorName = customDetector.name;
        }
      }
    }

    // Generate detection identity
    const detectionIdentity = generateDetectionIdentity({
      assetId: createDto.assetId,
      detectorType: createDto.detectorType,
      findingType: createDto.findingType,
      matchedContent: createDto.matchedContent,
      customDetectorKey: createDto.customDetectorKey,
    });

    const now = new Date();

    return this.prisma.finding.create({
      data: {
        ...rest,
        customDetectorId,
        customDetectorName,
        detectionIdentity,
        location: location ? (location as any) : undefined,
        firstDetectedAt: now,
        lastDetectedAt: now,
        history: [
          {
            timestamp: now,
            runnerId: createDto.runnerId || 'manual',
            eventType: HistoryEventType.DETECTED,
            status: FindingStatus.OPEN,
            severity: createDto.severity,
            confidence: createDto.confidence,
            location: location ? (location as any) : undefined,
          },
        ] as any,
      },
    });
  }

  async searchFindings(params: SearchFindingsRequestDto) {
    const filters = params?.filters ?? {};
    const page = params?.page ?? {};

    const rawSkip =
      typeof page.skip === 'number' ? page.skip : Number(page.skip ?? 0);
    const rawLimit =
      typeof page.limit === 'number' ? page.limit : Number(page.limit ?? 50);
    const skip = Number.isFinite(rawSkip) ? Math.max(0, rawSkip) : 0;
    const limit = Number.isFinite(rawLimit) ? Math.max(1, rawLimit) : 50;
    const where = this.buildSearchFindingsWhere(filters);

    const [findings, total] = await this.prisma.$transaction([
      this.prisma.finding.findMany({
        where,
        select: this.searchFindingSelect,
        skip,
        take: limit,
        orderBy: [
          { severity: 'asc' },
          { lastDetectedAt: 'desc' },
          { detectedAt: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
      this.prisma.finding.count({ where }),
    ]);

    return {
      findings: findings.map((finding) => ({
        ...finding,
        confidence: Number(finding.confidence),
        asset: finding.asset
          ? {
              ...finding.asset,
              type: finding.asset.assetType,
            }
          : finding.asset,
      })),
      total,
      skip,
      limit,
    };
  }

  async searchCustomDetectorOptions(params: SearchFindingsRequestDto) {
    const filters = params?.filters ?? {};
    const where = this.buildSearchFindingsWhere({
      ...filters,
      customDetectorKey: undefined,
      detectorType: [DetectorType.CUSTOM],
    });

    const grouped = await this.prisma.finding.groupBy({
      by: ['customDetectorKey', 'customDetectorName'],
      where: {
        ...where,
        detectorType: DetectorType.CUSTOM,
        customDetectorKey: { not: null },
      },
      _count: { _all: true },
    });

    return grouped
      .filter(
        (entry): entry is typeof entry & { customDetectorKey: string } =>
          typeof entry.customDetectorKey === 'string' &&
          entry.customDetectorKey.length > 0,
      )
      .map((entry) => ({
        key: entry.customDetectorKey,
        name: entry.customDetectorName ?? entry.customDetectorKey,
        count: entry._count._all,
      }))
      .sort((left, right) => right.count - left.count);
  }

  async listAssetSummaries(query: QueryFindingsAssetsDto) {
    const where: any = {};

    if (query.detectorType) where.detectorType = query.detectorType;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.assetId) where.assetId = query.assetId;
    if (query.runnerId) where.runnerId = query.runnerId;
    if (query.findingType) where.findingType = query.findingType;
    if (query.severity) where.severity = query.severity;
    if (query.status) where.status = query.status;

    if (!query.includeResolved && !query.status) {
      where.status = { not: FindingStatus.RESOLVED };
    }

    if (query.detectionIdentity) {
      where.detectionIdentity = query.detectionIdentity;
    }

    if (query.firstDetectedAfter) {
      where.firstDetectedAt = { gte: query.firstDetectedAfter };
    }

    if (query.lastDetectedBefore) {
      where.lastDetectedAt = { lte: query.lastDetectedBefore };
    }

    const findings = await this.prisma.finding.findMany({
      where,
      include: {
        asset: {
          select: {
            id: true,
            name: true,
            hash: true,
            externalUrl: true,
            links: true,
            assetType: true,
            sourceType: true,
          },
        },
        source: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: { lastDetectedAt: 'desc' },
    });

    const severityRank: Record<string, number> = {
      CRITICAL: 5,
      HIGH: 4,
      MEDIUM: 3,
      LOW: 2,
      INFO: 1,
    };

    const summaryMap = new Map<
      string,
      {
        assetId: string;
        asset?: any;
        source?: any;
        totalFindings: number;
        lastDetectedAt: Date;
        highestSeverity: string;
        detectorCounts: Map<string, number>;
        severityCounts: Map<string, number>;
        statusCounts: Map<string, number>;
        findingTypeCounts: Map<string, number>;
      }
    >();

    findings.forEach((finding) => {
      const assetId = finding.assetId;
      const detectedAt =
        finding.lastDetectedAt || finding.detectedAt || new Date();
      const severity = finding.severity || 'INFO';
      const detectorType = finding.detectorType || 'UNKNOWN';
      const status = finding.status || 'OPEN';
      const findingType = finding.findingType || 'Unknown';

      if (!summaryMap.has(assetId)) {
        summaryMap.set(assetId, {
          assetId,
          asset: finding.asset,
          source: finding.source,
          totalFindings: 0,
          lastDetectedAt: detectedAt,
          highestSeverity: severity,
          detectorCounts: new Map(),
          severityCounts: new Map(),
          statusCounts: new Map(),
          findingTypeCounts: new Map(),
        });
      }

      const summary = summaryMap.get(assetId);
      if (!summary) return;

      summary.totalFindings += 1;
      summary.detectorCounts.set(
        detectorType,
        (summary.detectorCounts.get(detectorType) || 0) + 1,
      );
      summary.severityCounts.set(
        severity,
        (summary.severityCounts.get(severity) || 0) + 1,
      );
      summary.statusCounts.set(
        status,
        (summary.statusCounts.get(status) || 0) + 1,
      );
      summary.findingTypeCounts.set(
        findingType,
        (summary.findingTypeCounts.get(findingType) || 0) + 1,
      );

      if (detectedAt > summary.lastDetectedAt) {
        summary.lastDetectedAt = detectedAt;
      }

      if (
        (severityRank[severity] || 0) >
        (severityRank[summary.highestSeverity] || 0)
      ) {
        summary.highestSeverity = severity;
      }
    });

    const summaries = Array.from(summaryMap.values());

    switch (query.sort) {
      case AssetFindingsSort.Latest:
        summaries.sort(
          (a, b) => b.lastDetectedAt.getTime() - a.lastDetectedAt.getTime(),
        );
        break;
      case AssetFindingsSort.HighestSeverity:
        summaries.sort((a, b) => {
          const severityDelta =
            (severityRank[b.highestSeverity] || 0) -
            (severityRank[a.highestSeverity] || 0);
          if (severityDelta !== 0) return severityDelta;

          const criticalDelta =
            (b.severityCounts.get('CRITICAL') || 0) -
            (a.severityCounts.get('CRITICAL') || 0);
          if (criticalDelta !== 0) return criticalDelta;

          const findingsDelta = b.totalFindings - a.totalFindings;
          if (findingsDelta !== 0) return findingsDelta;

          return b.lastDetectedAt.getTime() - a.lastDetectedAt.getTime();
        });
        break;
      default:
        summaries.sort((a, b) => {
          const criticalDelta =
            (b.severityCounts.get('CRITICAL') || 0) -
            (a.severityCounts.get('CRITICAL') || 0);
          if (criticalDelta !== 0) return criticalDelta;

          const findingsDelta = b.totalFindings - a.totalFindings;
          if (findingsDelta !== 0) return findingsDelta;

          const severityDelta =
            (severityRank[b.highestSeverity] || 0) -
            (severityRank[a.highestSeverity] || 0);
          if (severityDelta !== 0) return severityDelta;

          return b.lastDetectedAt.getTime() - a.lastDetectedAt.getTime();
        });
    }

    const totalAssets = summaries.length;
    const totalFindings = summaries.reduce(
      (sum, item) => sum + item.totalFindings,
      0,
    );

    const skip = query.skip ? Number(query.skip) : 0;
    const limit = query.limit ? Number(query.limit) : 50;

    const items = summaries.slice(skip, skip + limit).map((summary) => ({
      assetId: summary.assetId,
      asset: summary.asset,
      source: summary.source,
      totalFindings: summary.totalFindings,
      lastDetectedAt: summary.lastDetectedAt,
      highestSeverity: summary.highestSeverity,
      detectorCounts: Array.from(summary.detectorCounts.entries())
        .map(([detectorType, count]) => ({ detectorType, count }))
        .sort((a, b) => b.count - a.count),
      severityCounts: Array.from(summary.severityCounts.entries())
        .map(([severity, count]) => ({ severity, count }))
        .sort((a, b) => b.count - a.count),
      statusCounts: Array.from(summary.statusCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      findingTypeCounts: Array.from(summary.findingTypeCounts.entries())
        .map(([findingType, count]) => ({ findingType, count }))
        .sort((a, b) => b.count - a.count),
    }));

    return {
      items,
      totalAssets,
      totalFindings,
      skip,
      limit,
    };
  }

  findOne(id: string) {
    return this.prisma.finding.findUnique({
      where: { id },
      include: {
        source: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        asset: {
          select: {
            id: true,
            name: true,
            hash: true,
            externalUrl: true,
            links: true,
            assetType: true,
            sourceType: true,
          },
        },
      },
    });
  }

  async update(id: string, updateDto: UpdateFindingDto, userId?: string) {
    const finding = await this.prisma.finding.findUnique({ where: { id } });
    if (!finding) throw new NotFoundException();

    const data: any = {};
    const currentHistory = Array.isArray(finding.history)
      ? finding.history
      : [];
    const historyEntries: any[] = [];
    const now = new Date();
    const nextStatus = updateDto.status ?? finding.status;
    const nextSeverity = updateDto.severity ?? finding.severity;

    if (updateDto.status) {
      data.status = updateDto.status;
    }

    if (updateDto.severity) {
      data.severity = updateDto.severity;
    }

    // Track manual status changes
    if (updateDto.status && updateDto.status !== finding.status) {
      historyEntries.push({
        timestamp: now,
        runnerId: finding.runnerId || 'manual',
        eventType: HistoryEventType.STATUS_CHANGED,
        status: updateDto.status,
        severity: nextSeverity,
        changedBy: userId || 'system',
        changeReason: updateDto.changeReason || 'Manual status change',
      });

      if (
        updateDto.status === FindingStatus.RESOLVED ||
        updateDto.status === FindingStatus.FALSE_POSITIVE
      ) {
        data.resolvedAt = now;
      } else if (updateDto.status === FindingStatus.OPEN) {
        data.resolvedAt = null;
      }

      if (updateDto.changeReason) {
        data.resolutionReason = updateDto.changeReason;
      }
    }

    if (updateDto.severity && updateDto.severity !== finding.severity) {
      historyEntries.push({
        timestamp: now,
        runnerId: finding.runnerId || 'manual',
        eventType: HistoryEventType.SEVERITY_CHANGED,
        status: nextStatus,
        severity: updateDto.severity,
        changedBy: userId || 'system',
        changeReason: updateDto.changeReason || 'Manual severity change',
      });
    }

    if (historyEntries.length > 0) {
      data.history = [...currentHistory, ...historyEntries];
    }

    const updatedFinding = await this.prisma.finding.update({
      where: { id },
      data,
    });

    if (
      updateDto.status &&
      updateDto.status !== finding.status &&
      this.shouldRecordFeedbackStatus(updateDto.status)
    ) {
      await this.recordCustomDetectorFeedback(
        [
          {
            id: updatedFinding.id,
            sourceId: updatedFinding.sourceId,
            detectorType: updatedFinding.detectorType,
            customDetectorId: updatedFinding.customDetectorId,
            customDetectorKey: updatedFinding.customDetectorKey,
            customDetectorName: updatedFinding.customDetectorName,
            findingType: updatedFinding.findingType,
            matchedContent: updatedFinding.matchedContent,
          },
        ],
        updateDto.status,
      );
    }

    return updatedFinding;
  }

  async bulkUpdate(
    dto: BulkUpdateFindingsDto,
    userId?: string,
  ): Promise<BulkUpdateFindingsResponseDto> {
    const { ids, filters, status, severity, comment } = dto;

    if (!status && !severity && comment === undefined) {
      return { updatedCount: 0, ids: [] };
    }

    // ── Filter-based mode (select-all): use updateMany for efficiency ──────────
    if (filters && !ids?.length) {
      const where = this.buildSearchFindingsWhere(filters);
      const data: Prisma.FindingUpdateManyMutationInput = {};
      if (status) data.status = status;
      if (severity) data.severity = severity;
      if (comment !== undefined) data.comment = comment;
      const feedbackCandidates =
        status && this.shouldRecordFeedbackStatus(status)
          ? await this.prisma.finding.findMany({
              where: {
                AND: [where, { status: { not: status } }],
              },
              select: {
                id: true,
                sourceId: true,
                detectorType: true,
                customDetectorId: true,
                customDetectorKey: true,
                customDetectorName: true,
                findingType: true,
                matchedContent: true,
              },
            })
          : [];
      const now = new Date();
      if (
        status === FindingStatus.RESOLVED ||
        status === FindingStatus.FALSE_POSITIVE
      ) {
        data.resolvedAt = now;
        if (comment) data.resolutionReason = comment;
      } else if (status === FindingStatus.OPEN) {
        data.resolvedAt = null;
      }
      const result = await this.prisma.finding.updateMany({ where, data });
      if (status && feedbackCandidates.length > 0) {
        await this.recordCustomDetectorFeedback(feedbackCandidates, status);
      }
      return { updatedCount: result.count, ids: [] };
    }

    // ── ID-based mode: update with per-finding history tracking ───────────────
    if (!ids?.length) return { updatedCount: 0, ids: [] };

    const findings = await this.prisma.finding.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        sourceId: true,
        detectorType: true,
        customDetectorId: true,
        customDetectorKey: true,
        customDetectorName: true,
        findingType: true,
        matchedContent: true,
        status: true,
        severity: true,
        runnerId: true,
        history: true,
      },
    });

    const now = new Date();

    const updates = findings.map((finding) => {
      const data: Prisma.FindingUpdateInput = {};
      const currentHistory = Array.isArray(finding.history)
        ? (finding.history as object[])
        : [];
      const historyEntries: object[] = [];
      const nextStatus = status ?? finding.status;
      const nextSeverity = severity ?? finding.severity;

      if (status) data.status = status;
      if (severity) data.severity = severity;
      if (comment !== undefined) data.comment = comment;

      if (status && status !== finding.status) {
        historyEntries.push({
          timestamp: now,
          runnerId: finding.runnerId ?? 'manual',
          eventType: HistoryEventType.STATUS_CHANGED,
          status,
          severity: nextSeverity,
          changedBy: userId ?? 'system',
          changeReason: comment ?? 'Bulk status change',
        });
        if (
          status === FindingStatus.RESOLVED ||
          status === FindingStatus.FALSE_POSITIVE
        ) {
          data.resolvedAt = now;
          if (comment) data.resolutionReason = comment;
        } else if (status === FindingStatus.OPEN) {
          data.resolvedAt = null;
        }
      }

      if (severity && severity !== finding.severity) {
        historyEntries.push({
          timestamp: now,
          runnerId: finding.runnerId ?? 'manual',
          eventType: HistoryEventType.SEVERITY_CHANGED,
          status: nextStatus,
          severity,
          changedBy: userId ?? 'system',
          changeReason: comment ?? 'Bulk severity change',
        });
      }

      if (historyEntries.length > 0)
        data.history = [...currentHistory, ...historyEntries];
      return this.prisma.finding.update({ where: { id: finding.id }, data });
    });

    const updated = await this.prisma.$transaction(updates);
    if (status && this.shouldRecordFeedbackStatus(status)) {
      const feedbackFindings = findings
        .filter((finding) => finding.status !== status)
        .map((finding) => ({
          id: finding.id,
          sourceId: finding.sourceId,
          detectorType: finding.detectorType,
          customDetectorId: finding.customDetectorId,
          customDetectorKey: finding.customDetectorKey,
          customDetectorName: finding.customDetectorName,
          findingType: finding.findingType,
          matchedContent: finding.matchedContent,
        }));
      await this.recordCustomDetectorFeedback(feedbackFindings, status);
    }
    return { updatedCount: updated.length, ids: updated.map((f) => f.id) };
  }

  async getStats(sourceId?: string) {
    const where = sourceId ? { sourceId } : {};

    const [total, critical, high, medium, low, open] = await Promise.all([
      this.prisma.finding.count({ where }),
      this.prisma.finding.count({
        where: { ...where, severity: 'CRITICAL' },
      }),
      this.prisma.finding.count({
        where: { ...where, severity: 'HIGH' },
      }),
      this.prisma.finding.count({
        where: { ...where, severity: 'MEDIUM' },
      }),
      this.prisma.finding.count({
        where: { ...where, severity: 'LOW' },
      }),
      this.prisma.finding.count({
        where: { ...where, status: FindingStatus.OPEN },
      }),
    ]);

    return {
      total,
      bySeverity: {
        critical,
        high,
        medium,
        low,
      },
      byStatus: {
        open,
      },
    };
  }

  async getDiscoveryOverview(query: QueryFindingsDiscoveryDto) {
    const windowDays = query.windowDays ?? 30;
    const includeResolved = query.includeResolved ?? false;

    const statusFilter = includeResolved ? {} : { status: FindingStatus.OPEN };

    const now = new Date();
    const todayStart = this.startOfDay(now);
    const windowStart = new Date(todayStart);
    windowStart.setDate(windowStart.getDate() - (windowDays - 1));

    const weekStart = this.startOfWeek(todayStart);
    const monthStart = this.startOfMonth(todayStart);

    const windowWhere = {
      ...statusFilter,
      detectedAt: { gte: windowStart },
    };

    // topAssets always reflects OPEN findings regardless of includeResolved
    const topAssetsWhere = {
      status: FindingStatus.OPEN,
      detectedAt: { gte: windowStart },
    };

    const totals = {
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byStatus: { open: 0, falsePositive: 0, resolved: 0, ignored: 0 },
    };

    const [
      findingGroups,
      todayCount,
      weekCount,
      monthCount,
      assetCounts,
      recentRunsRaw,
    ] = await Promise.all([
      this.prisma.finding.groupBy({
        by: ['severity', 'status'],
        where: windowWhere,
        _count: { _all: true },
      }),
      this.prisma.finding.count({
        where: { ...statusFilter, detectedAt: { gte: todayStart } },
      }),
      this.prisma.finding.count({
        where: { ...statusFilter, detectedAt: { gte: weekStart } },
      }),
      this.prisma.finding.count({
        where: { ...statusFilter, detectedAt: { gte: monthStart } },
      }),
      this.prisma.finding.groupBy({
        by: ['assetId'],
        where: topAssetsWhere,
        _count: { _all: true },
        _max: { detectedAt: true },
      }),
      this.prisma.runner.findMany({
        orderBy: { triggeredAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          triggerType: true,
          triggeredAt: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          totalFindings: true,
          assetsCreated: true,
          assetsUpdated: true,
          errorMessage: true,
          source: {
            select: { id: true, name: true, type: true },
          },
        },
      }),
    ]);

    for (const group of findingGroups) {
      const count = group._count._all;
      totals.total += count;
      switch (group.severity) {
        case 'CRITICAL':
          totals.bySeverity.critical += count;
          break;
        case 'HIGH':
          totals.bySeverity.high += count;
          break;
        case 'MEDIUM':
          totals.bySeverity.medium += count;
          break;
        case 'LOW':
          totals.bySeverity.low += count;
          break;
        default:
          totals.bySeverity.info += count;
          break;
      }
      switch (group.status) {
        case FindingStatus.FALSE_POSITIVE:
          totals.byStatus.falsePositive += count;
          break;
        case FindingStatus.RESOLVED:
          totals.byStatus.resolved += count;
          break;
        case FindingStatus.IGNORED:
          totals.byStatus.ignored += count;
          break;
        default:
          totals.byStatus.open += count;
          break;
      }
    }

    const assetIds = assetCounts.map((item) => item.assetId);

    const [assets, assetSeverityCounts] = assetIds.length
      ? await Promise.all([
          this.prisma.asset.findMany({
            where: { id: { in: assetIds } },
            select: {
              id: true,
              name: true,
              hash: true,
              externalUrl: true,
              links: true,
              assetType: true,
              sourceType: true,
              source: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                },
              },
            },
          }),
          this.prisma.finding.groupBy({
            by: ['assetId', 'severity'],
            where: {
              ...topAssetsWhere,
              assetId: { in: assetIds },
            },
            _count: { _all: true },
          }),
        ])
      : [[], []];

    const severityRank: Record<string, number> = {
      CRITICAL: 5,
      HIGH: 4,
      MEDIUM: 3,
      LOW: 2,
      INFO: 1,
    };
    const severityOrder = [
      'CRITICAL',
      'HIGH',
      'MEDIUM',
      'LOW',
      'INFO',
    ] as const;

    const highestSeverityByAsset = new Map<string, string>();
    const severityCountsByAsset = new Map<
      string,
      Record<(typeof severityOrder)[number], number>
    >();
    assetSeverityCounts.forEach((entry) => {
      const severity = (entry.severity ??
        'INFO') as (typeof severityOrder)[number];
      const bucket = severityCountsByAsset.get(entry.assetId) ?? {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      };
      bucket[severity] += entry._count?._all ?? 0;
      severityCountsByAsset.set(entry.assetId, bucket);

      const current = highestSeverityByAsset.get(entry.assetId);
      const currentRank = current ? severityRank[current] : 0;
      const nextRank = severityRank[entry.severity] ?? 0;
      if (nextRank > currentRank) {
        highestSeverityByAsset.set(entry.assetId, entry.severity);
      }
    });

    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

    const topAssets = assetCounts.map((item) => {
      const asset = assetMap.get(item.assetId);
      return {
        assetId: item.assetId,
        assetName: asset?.name || asset?.externalUrl || 'Unknown asset',
        assetType: asset?.assetType || 'OTHER',
        sourceId: asset?.source?.id ?? null,
        sourceName: asset?.source?.name ?? null,
        sourceType: asset?.source?.type ?? null,
        totalFindings: item._count?._all ?? 0,
        highestSeverity: (highestSeverityByAsset.get(item.assetId) ||
          'INFO') as any,
        lastDetectedAt: item._max?.detectedAt ?? null,
      };
    });

    topAssets.sort((a, b) => {
      for (const severity of severityOrder) {
        const severityDelta =
          (severityCountsByAsset.get(b.assetId)?.[severity] ?? 0) -
          (severityCountsByAsset.get(a.assetId)?.[severity] ?? 0);
        if (severityDelta !== 0) return severityDelta;
      }

      const findingsDelta = b.totalFindings - a.totalFindings;
      if (findingsDelta !== 0) return findingsDelta;

      const highestSeverityDelta =
        (severityRank[b.highestSeverity] ?? 0) -
        (severityRank[a.highestSeverity] ?? 0);
      if (highestSeverityDelta !== 0) return highestSeverityDelta;

      return (
        (b.lastDetectedAt?.getTime() ?? 0) - (a.lastDetectedAt?.getTime() ?? 0)
      );
    });

    const rankedTopAssets = topAssets.slice(0, 12);

    const recentRuns = recentRunsRaw.map((run) => ({
      id: run.id,
      status: run.status,
      triggerType: run.triggerType,
      triggeredAt: run.triggeredAt,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      durationMs: run.durationMs ?? null,
      totalFindings: run.totalFindings,
      assetsCreated: run.assetsCreated,
      assetsUpdated: run.assetsUpdated,
      errorMessage: run.errorMessage ?? null,
      source: run.source
        ? {
            id: run.source.id,
            name: run.source.name ?? null,
            type: run.source.type ?? null,
          }
        : null,
    }));

    return {
      windowDays,
      includeResolved,
      totals,
      activity: {
        today: todayCount,
        week: weekCount,
        month: monthCount,
      },
      topAssets: rankedTopAssets,
      recentRuns,
    };
  }

  async searchFindingsCharts(
    request: SearchFindingsChartsRequestDto,
  ): Promise<SearchFindingsChartsResponseDto> {
    const windowDays = request.windowDays ?? 7;
    const topAssetsLimit = Math.min(
      50,
      Math.max(1, request.options?.topAssetsLimit ?? 10),
    );

    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - (windowDays - 1));
    windowStart.setHours(0, 0, 0, 0);

    // Build where clause from filters, then apply window on top
    const baseWhere = this.buildSearchFindingsWhere(request.filters);
    const where: Prisma.FindingWhereInput = {
      ...baseWhere,
      firstDetectedAt: { gte: windowStart },
    };

    // Parallel: (1) light projection for totals+timeline, (2) groupBy for top assets
    const [findings, topAssetGroups] = await Promise.all([
      this.prisma.finding.findMany({
        where,
        select: {
          severity: true,
          status: true,
          firstDetectedAt: true,
          assetId: true,
        },
      }),
      this.prisma.finding.groupBy({
        by: ['assetId'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: topAssetsLimit,
      }),
    ]);

    // Compute totals and dense timeline in one pass
    const severityRank: Record<string, number> = {
      CRITICAL: 5,
      HIGH: 4,
      MEDIUM: 3,
      LOW: 2,
      INFO: 1,
    };

    const totals = {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      open: 0,
      resolved: 0,
    };

    // Pre-fill all days in window so timeline has no gaps
    const dayMap = new Map<
      string,
      {
        total: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
      }
    >();
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(windowStart);
      d.setDate(d.getDate() + i);
      dayMap.set(this.formatDateKey(d), {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      });
    }

    for (const f of findings) {
      if (!f.firstDetectedAt) continue;
      const sev = (f.severity ?? 'INFO') as string;
      const st = (f.status ?? 'OPEN') as string;

      totals.total++;
      if (sev === 'CRITICAL') totals.critical++;
      else if (sev === 'HIGH') totals.high++;
      else if (sev === 'MEDIUM') totals.medium++;
      else if (sev === 'LOW') totals.low++;
      else totals.info++;

      if (st === 'OPEN') totals.open++;
      else if (st === 'RESOLVED') totals.resolved++;

      const key = this.formatDateKey(this.startOfDay(f.firstDetectedAt));
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.total++;
        if (sev === 'CRITICAL') bucket.critical++;
        else if (sev === 'HIGH') bucket.high++;
        else if (sev === 'MEDIUM') bucket.medium++;
        else if (sev === 'LOW') bucket.low++;
        else bucket.info++;
      }
    }

    const timeline = Array.from(dayMap.entries()).map(([date, bucket]) => ({
      date,
      ...bucket,
    }));

    // Resolve top asset details
    const topAssetIds = topAssetGroups.map((g) => g.assetId);
    let topAssets: SearchFindingsChartsResponseDto['topAssets'] = [];

    if (topAssetIds.length > 0) {
      const [assetRecords, severityGroups] = await Promise.all([
        this.prisma.asset.findMany({
          where: { id: { in: topAssetIds } },
          select: {
            id: true,
            name: true,
            externalUrl: true,
            source: { select: { id: true, name: true } },
          },
        }),
        this.prisma.finding.groupBy({
          by: ['assetId', 'severity'],
          where: { ...where, assetId: { in: topAssetIds } },
          _count: { id: true },
        }),
      ]);

      const assetMap = new Map(assetRecords.map((a) => [a.id, a]));
      const highestSev = new Map<string, string>();
      for (const sg of severityGroups) {
        const current = highestSev.get(sg.assetId);
        if (
          !current ||
          (severityRank[sg.severity] ?? 0) > (severityRank[current] ?? 0)
        ) {
          highestSev.set(sg.assetId, sg.severity);
        }
      }

      topAssets = topAssetGroups.map((g) => {
        const asset = assetMap.get(g.assetId);
        return {
          assetId: g.assetId,
          assetName: asset?.name ?? asset?.externalUrl ?? 'Unknown',
          sourceId: asset?.source?.id ?? '',
          sourceName: asset?.source?.name ?? null,
          totalFindings: g._count.id,
          highestSeverity: highestSev.get(g.assetId) ?? 'INFO',
        };
      });
    }

    return { totals, timeline, topAssets };
  }
}
