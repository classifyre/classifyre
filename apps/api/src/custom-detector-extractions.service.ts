import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  CustomDetectorExtractionDto,
  SearchExtractionsQueryDto,
} from './dto/custom-detector-extraction.dto';
import { stableJsonHash } from './utils/stable-json';
import { Prisma } from '@prisma/client';

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
    detectorVersion: number;
    payload?: { pipelineResult: unknown };
    pipelineResult?: unknown;
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
      detectorVersion: row.detectorVersion,
      pipelineResult: (row.payload?.pipelineResult ??
        row.pipelineResult) as Record<string, unknown>,
      extractedAt: row.extractedAt,
      createdAt: row.createdAt,
    };
  }

  async getByFinding(
    findingId: string,
  ): Promise<CustomDetectorExtractionDto | null> {
    const row = await this.prisma.customDetectorExtraction.findUnique({
      where: { findingId },
      include: { payload: true },
    });
    return row ? this.toDto(row) : null;
  }

  async search(
    query: SearchExtractionsQueryDto,
  ): Promise<{ items: CustomDetectorExtractionDto[]; total: number }> {
    const where: Record<string, unknown> = {};

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

    const take = Math.min(query.take ?? 50, 200);
    const skip = query.skip ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.customDetectorExtraction.findMany({
        where,
        include: { payload: true },
        orderBy: { extractedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.customDetectorExtraction.count({ where }),
    ]);

    return { items: items.map((r) => this.toDto(r as any)), total };
  }

  async getCoverage(customDetectorId: string): Promise<{
    customDetectorId: string;
    customDetectorKey: string;
    totalFindings: number;
    findingsWithExtraction: number;
    coverageRate: number;
  }> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: customDetectorId },
      select: { id: true, key: true },
    });
    if (!detector) {
      throw new NotFoundException(
        `Custom detector ${customDetectorId} not found`,
      );
    }

    const [totalFindings, findingsWithExtraction] = await Promise.all([
      this.prisma.finding.count({ where: { customDetectorId } }),
      this.prisma.customDetectorExtraction.count({
        where: { customDetectorId },
      }),
    ]);

    const coverageRate =
      totalFindings > 0 ? findingsWithExtraction / totalFindings : 0;

    return {
      customDetectorId,
      customDetectorKey: detector.key,
      totalFindings,
      findingsWithExtraction,
      coverageRate,
    };
  }

  async createFromIngestion(
    data: {
      findingId: string;
      customDetectorId: string | null;
      customDetectorKey: string;
      sourceId: string;
      assetId: string;
      runnerId: string | null;
      detectorVersion: number;
      pipelineResult: Record<string, unknown>;
      extractedAt: Date;
    },
    // When called from within a transaction, pass the transaction client so the
    // extraction row is inserted in the same transaction as its parent finding —
    // otherwise the finding is still uncommitted and the FK constraint fails (P2003).
    client: Pick<
      PrismaService,
      'customDetectorExtraction' | 'extractionPayload'
    > = this.prisma,
  ): Promise<void> {
    if (!(client as any).extractionPayload) {
      await (client.customDetectorExtraction.upsert as any)({
        where: { findingId: data.findingId },
        create: { ...data },
        update: {
          detectorVersion: data.detectorVersion,
          pipelineResult: data.pipelineResult,
          extractedAt: data.extractedAt,
        },
      });
      return;
    }
    const existingPayload = await client.extractionPayload.findFirst({
      where: {
        pipelineResult: {
          equals: data.pipelineResult as Prisma.InputJsonValue,
        },
      },
      select: { contentHash: true },
    });
    const payloadHash =
      existingPayload?.contentHash ?? stableJsonHash(data.pipelineResult);
    if (!existingPayload) {
      await client.extractionPayload.upsert({
        where: { contentHash: payloadHash },
        create: {
          contentHash: payloadHash,
          pipelineResult: data.pipelineResult as Prisma.InputJsonValue,
        },
        update: {},
      });
    }
    await (client.customDetectorExtraction.upsert as any)({
      where: { findingId: data.findingId },
      create: {
        findingId: data.findingId,
        customDetectorId: data.customDetectorId,
        customDetectorKey: data.customDetectorKey,
        sourceId: data.sourceId,
        assetId: data.assetId,
        runnerId: data.runnerId,
        detectorVersion: data.detectorVersion,
        payloadHash,
        extractedAt: data.extractedAt,
      },
      update: {
        detectorVersion: data.detectorVersion,
        payloadHash,
        extractedAt: data.extractedAt,
      },
    });
  }
}
