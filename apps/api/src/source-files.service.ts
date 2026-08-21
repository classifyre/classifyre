import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AssetStatus,
  AssetType,
  FindingStatus,
  Prisma,
  RunnerStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import * as path from 'path';
import { PrismaService } from './prisma.service';
import { HistoryEventType } from './types/finding-history.types';
import { CorrelationJobScheduler } from './correlation/correlation-job-scheduler.service';

// Uploads are not size-capped by the API; the transport (Fastify bodyLimit /
// @fastify/multipart) is unbounded too, so a large uploaded file is stored
// rather than rejected with 413.

/**
 * Source types that can hold uploaded files.
 *
 * SANDBOX turns each file into an asset directly. CUSTOM hands them to its
 * notebook as `ctx.files`, which is how a connector gets at a dump in a
 * Kubernetes deployment, where there is no local folder to point at. The two
 * differ in the guards below: a sandbox with no files has nothing to scan, a
 * notebook with no files is perfectly normal.
 */
const FILE_CAPABLE_SOURCE_TYPES = [
  AssetType.SANDBOX,
  AssetType.CUSTOM,
] as const;

const fileMetadataSelect = {
  id: true,
  sourceId: true,
  fileName: true,
  declaredMimeType: true,
  fileExtension: true,
  fileSizeBytes: true,
  contentHash: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UploadedSourceFileSelect;

@Injectable()
export class SourceFilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly correlationJobs?: CorrelationJobScheduler,
  ) {}

  async list(sourceId: string) {
    await this.assertFileCapableSource(sourceId);
    return this.prisma.uploadedSourceFile.findMany({
      where: { sourceId },
      select: fileMetadataSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  async create(params: {
    sourceId: string;
    fileName: string;
    declaredMimeType: string;
    data: Buffer;
  }) {
    const source = await this.assertFileCapableSource(params.sourceId);
    this.assertSourceIdle(source);
    if (params.data.length === 0) {
      throw new BadRequestException('No file uploaded');
    }

    const contentHash = createHash('sha256').update(params.data).digest('hex');
    const existing = await this.prisma.uploadedSourceFile.findUnique({
      where: {
        sourceId_contentHash: { sourceId: params.sourceId, contentHash },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message: 'This source already contains a file with identical content.',
        existingFileId: existing.id,
      });
    }

    try {
      return await this.prisma.uploadedSourceFile.create({
        data: {
          sourceId: params.sourceId,
          fileName: path.basename(params.fileName || 'upload'),
          declaredMimeType:
            params.declaredMimeType || 'application/octet-stream',
          fileExtension: path.extname(params.fileName || '').toLowerCase(),
          fileSizeBytes: params.data.length,
          contentHash,
          data: new Uint8Array(params.data),
        },
        select: fileMetadataSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This source already contains a file with identical content.',
        );
      }
      throw error;
    }
  }

  async content(sourceId: string, fileId: string) {
    await this.assertFileCapableSource(sourceId);
    const file = await this.prisma.uploadedSourceFile.findFirst({
      where: { id: fileId, sourceId },
      select: {
        fileName: true,
        declaredMimeType: true,
        data: true,
      },
    });
    if (!file) {
      throw new NotFoundException(`Source file ${fileId} not found`);
    }
    return file;
  }

  async delete(sourceId: string, fileId: string): Promise<void> {
    const source = await this.assertFileCapableSource(sourceId);
    this.assertSourceIdle(source);
    const isSandbox = source.type === AssetType.SANDBOX;

    let graphAffected = false;
    await this.prisma.$transaction(async (tx) => {
      const [file, count] = await Promise.all([
        tx.uploadedSourceFile.findFirst({
          where: { id: fileId, sourceId },
          select: { id: true },
        }),
        tx.uploadedSourceFile.count({ where: { sourceId } }),
      ]);
      if (!file) {
        throw new NotFoundException(`Source file ${fileId} not found`);
      }
      // Only for SANDBOX: its files *are* the source, so removing the last one
      // leaves nothing to scan. A CUSTOM notebook owns its own assets and is
      // free to have no files at all.
      if (isSandbox && count <= 1) {
        throw new ConflictException(
          'The final file cannot be deleted; delete the source instead.',
        );
      }

      const externalUrl = this.externalUrl(sourceId, fileId);
      // A sandbox asset is addressed by `sandbox://<source>/<file>`, so deleting
      // the file identifies exactly the assets to retire. A notebook chooses its
      // own asset ids, and nothing here can know which of them came from this
      // file -- the next scan is what reconciles that.
      const assets = isSandbox
        ? await tx.asset.findMany({
            where: {
              sourceId,
              status: { not: AssetStatus.DELETED },
              OR: [
                { externalUrl },
                { externalUrl: { startsWith: `${externalUrl}#` } },
              ],
            },
            select: { id: true },
          })
        : [];
      const assetIds = assets.map((asset) => asset.id);
      if (assetIds.length > 0) {
        graphAffected = true;
        await tx.asset.updateMany({
          where: { id: { in: assetIds } },
          data: { status: AssetStatus.DELETED },
        });
        const findings = await tx.finding.findMany({
          where: {
            assetId: { in: assetIds },
            status: FindingStatus.OPEN,
          },
        });
        const now = new Date();
        for (const finding of findings) {
          const history = Array.isArray(finding.history) ? finding.history : [];
          await tx.finding.update({
            where: { id: finding.id },
            data: {
              status: FindingStatus.RESOLVED,
              resolvedAt: now,
              resolutionReason: 'Uploaded source file deleted',
              history: [
                ...history,
                {
                  timestamp: now,
                  runnerId: 'source-file-delete',
                  eventType: HistoryEventType.STATUS_CHANGED,
                  status: FindingStatus.RESOLVED,
                  changeReason: 'Uploaded source file deleted',
                },
              ],
            },
          });
        }
      }

      await tx.uploadedSourceFile.delete({ where: { id: fileId } });
    });
    if (graphAffected) {
      await this.correlationJobs?.scheduleFull('uploaded source file deleted');
    }
  }

  async assertHasFiles(sourceId: string): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { type: true },
    });
    if (source?.type !== AssetType.SANDBOX) return;
    const count = await this.prisma.uploadedSourceFile.count({
      where: { sourceId },
    });
    if (count === 0) {
      throw new BadRequestException(
        'Sandbox sources require at least one uploaded file.',
      );
    }
  }

  externalUrl(sourceId: string, fileId: string): string {
    return `sandbox://${sourceId}/${fileId}`;
  }

  private async assertFileCapableSource(sourceId: string) {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, type: true, runnerStatus: true },
    });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }
    if (
      !(FILE_CAPABLE_SOURCE_TYPES as readonly AssetType[]).includes(source.type)
    ) {
      throw new BadRequestException(
        `Source ${sourceId} does not support uploaded files`,
      );
    }
    return source;
  }

  private assertSourceIdle(source: {
    id: string;
    runnerStatus: RunnerStatus | null;
  }) {
    if (source.runnerStatus === RunnerStatus.RUNNING) {
      throw new ConflictException(
        `Files cannot be changed while source ${source.id} has an active runner`,
      );
    }
  }
}
