import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  CustomDetectorExtractionDto,
  ExtractionCoverageDto,
  ExtractionFieldCoverageDto,
  SearchExtractionsQueryDto,
} from './dto/custom-detector-extraction.dto';

@Injectable()
export class CustomDetectorExtractionsService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(row: {
    id: string;
    findingId: string;
    customDetectorId: string | null;
    customDetectorKey: string;
    sourceId: string;
    assetId: string;
    runnerId: string | null;
    extractionMethod: string;
    detectorVersion: number;
    fieldCount: number;
    populatedFields: string[];
    extractedData: unknown;
    extractedAt: Date;
    createdAt: Date;
  }): CustomDetectorExtractionDto {
    return {
      id: row.id,
      findingId: row.findingId,
      customDetectorId: row.customDetectorId,
      customDetectorKey: row.customDetectorKey,
      sourceId: row.sourceId,
      assetId: row.assetId,
      runnerId: row.runnerId,
      extractionMethod: row.extractionMethod,
      detectorVersion: row.detectorVersion,
      fieldCount: row.fieldCount,
      populatedFields: row.populatedFields,
      extractedData: row.extractedData as Record<string, unknown>,
      extractedAt: row.extractedAt,
      createdAt: row.createdAt,
    };
  }

  async getByFinding(
    findingId: string,
  ): Promise<CustomDetectorExtractionDto | null> {
    const row = await this.prisma.customDetectorExtraction.findUnique({
      where: { findingId },
    });
    return row ? this.toDto(row) : null;
  }

  async search(
    query: SearchExtractionsQueryDto,
  ): Promise<{ items: CustomDetectorExtractionDto[]; total: number }> {
    const where: Prisma.CustomDetectorExtractionWhereInput = {};

    if (query.customDetectorKey) {
      where.customDetectorKey = query.customDetectorKey;
    }
    if (query.customDetectorId) {
      where.customDetectorId = query.customDetectorId;
    }
    if (query.sourceId) {
      where.sourceId = query.sourceId;
    }
    if (query.assetId) {
      where.assetId = query.assetId;
    }
    if (query.populatedField) {
      where.populatedFields = { has: query.populatedField };
    }
    if (query.fieldFilter && Object.keys(query.fieldFilter).length > 0) {
      where.extractedData = {
        path: [],
        equals: query.fieldFilter as Prisma.InputJsonValue,
      };
    }

    const take = Math.min(query.take ?? 50, 200);
    const skip = query.skip ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.customDetectorExtraction.findMany({
        where,
        orderBy: { extractedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.customDetectorExtraction.count({ where }),
    ]);

    return { items: items.map((r) => this.toDto(r)), total };
  }

  async getCoverage(customDetectorId: string): Promise<ExtractionCoverageDto> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: customDetectorId },
      select: { id: true, key: true },
    });
    if (!detector) {
      throw new NotFoundException(
        `Custom detector ${customDetectorId} not found`,
      );
    }

    const [totalFindings, extractions] = await Promise.all([
      this.prisma.finding.count({ where: { customDetectorId } }),
      this.prisma.customDetectorExtraction.findMany({
        where: { customDetectorId },
        select: { populatedFields: true },
      }),
    ]);

    const findingsWithExtraction = extractions.length;
    const coverageRate =
      totalFindings > 0 ? findingsWithExtraction / totalFindings : 0;

    // Tally per-field population counts
    const fieldCounts = new Map<string, number>();
    for (const row of extractions) {
      for (const field of row.populatedFields) {
        fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      }
    }

    const fieldCoverage: ExtractionFieldCoverageDto[] = Array.from(
      fieldCounts.entries(),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([f, count]) => ({
        field: f,
        populated: count,
        total: findingsWithExtraction,
        rate: findingsWithExtraction > 0 ? count / findingsWithExtraction : 0,
      }));

    return {
      customDetectorId,
      customDetectorKey: detector.key,
      totalFindings,
      findingsWithExtraction,
      coverageRate,
      fieldCoverage,
    };
  }

  async createFromIngestion(data: {
    findingId: string;
    customDetectorId: string | null;
    customDetectorKey: string;
    sourceId: string;
    assetId: string;
    runnerId: string | null;
    extractionMethod: string;
    detectorVersion: number;
    extractedData: Record<string, unknown>;
    extractedAt: Date;
  }): Promise<void> {
    const populatedFields = Object.entries(data.extractedData)
      .filter(
        ([, v]) =>
          v !== null &&
          v !== undefined &&
          v !== '' &&
          !(Array.isArray(v) && v.length === 0),
      )
      .map(([k]) => k);

    await this.prisma.customDetectorExtraction.upsert({
      where: { findingId: data.findingId },
      create: {
        findingId: data.findingId,
        customDetectorId: data.customDetectorId,
        customDetectorKey: data.customDetectorKey,
        sourceId: data.sourceId,
        assetId: data.assetId,
        runnerId: data.runnerId,
        extractionMethod: data.extractionMethod,
        detectorVersion: data.detectorVersion,
        fieldCount: Object.keys(data.extractedData).length,
        populatedFields,
        extractedData: data.extractedData as Prisma.InputJsonValue,
        extractedAt: data.extractedAt,
      },
      update: {
        extractionMethod: data.extractionMethod,
        detectorVersion: data.detectorVersion,
        fieldCount: Object.keys(data.extractedData).length,
        populatedFields,
        extractedData: data.extractedData as Prisma.InputJsonValue,
        extractedAt: data.extractedAt,
      },
    });
  }
}
