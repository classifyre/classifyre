import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import * as path from 'path';
import { PrismaService } from './prisma.service';
import { isCodeDetectorSchema } from './custom-detector-code';

/** A detector file is a list, a model or a table, not a corpus. */
export const MAX_DETECTOR_FILE_BYTES = 100 * 1024 * 1024;

const fileMetadataSelect = {
  id: true,
  customDetectorId: true,
  fileName: true,
  declaredMimeType: true,
  fileSizeBytes: true,
  contentHash: true,
  createdAt: true,
} as const;

/**
 * Files a code detector (CODE_DETECTOR) reads with `ctx.file(name)`: a
 * screening list, a scikit-learn model, a reference table.
 *
 * Stored in Postgres like source files, one per name: uploading a file with a
 * name the detector already has replaces it, which is how a list is updated.
 * Every change bumps the detector's version, and the content hash reaches the
 * scan-cache fingerprint through the runtime manifest, so a new list re-runs
 * the rule across the corpus.
 */
@Injectable()
export class CustomDetectorFilesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCodeDetector(customDetectorId: string): Promise<void> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: customDetectorId },
      select: { id: true, pipelineSchema: true },
    });
    if (!detector) {
      throw new NotFoundException(
        `Custom detector ${customDetectorId} not found`,
      );
    }
    if (!isCodeDetectorSchema(detector.pipelineSchema)) {
      throw new BadRequestException(
        'Files can only be uploaded to code detectors (pipeline type CODE_DETECTOR).',
      );
    }
  }

  async list(customDetectorId: string) {
    await this.assertCodeDetector(customDetectorId);
    return this.prisma.customDetectorFile.findMany({
      where: { customDetectorId },
      select: fileMetadataSelect,
      orderBy: [{ fileName: 'asc' }],
    });
  }

  async create(params: {
    customDetectorId: string;
    fileName: string;
    declaredMimeType: string;
    data: Buffer;
  }) {
    await this.assertCodeDetector(params.customDetectorId);
    if (params.data.length === 0) {
      throw new BadRequestException('No file uploaded');
    }
    if (params.data.length > MAX_DETECTOR_FILE_BYTES) {
      throw new BadRequestException(
        `A detector file may be at most ${MAX_DETECTOR_FILE_BYTES / (1024 * 1024)} MB.`,
      );
    }
    const fileName = path.basename(params.fileName || 'upload').slice(0, 200);
    const contentHash = createHash('sha256').update(params.data).digest('hex');
    const data = {
      declaredMimeType: params.declaredMimeType || 'application/octet-stream',
      fileSizeBytes: params.data.length,
      contentHash,
      data: new Uint8Array(params.data),
    };
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.customDetectorFile.upsert({
        where: {
          customDetectorId_fileName: {
            customDetectorId: params.customDetectorId,
            fileName,
          },
        },
        create: {
          customDetectorId: params.customDetectorId,
          fileName,
          ...data,
        },
        update: data,
        select: fileMetadataSelect,
      });
      await tx.customDetector.update({
        where: { id: params.customDetectorId },
        data: { version: { increment: 1 } },
      });
      return file;
    });
  }

  async content(customDetectorId: string, fileId: string) {
    const file = await this.prisma.customDetectorFile.findFirst({
      where: { id: fileId, customDetectorId },
    });
    if (!file) {
      throw new NotFoundException(`Detector file ${fileId} not found`);
    }
    return file;
  }

  async delete(customDetectorId: string, fileId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.customDetectorFile.deleteMany({
        where: { id: fileId, customDetectorId },
      });
      if (removed.count === 0) {
        throw new NotFoundException(`Detector file ${fileId} not found`);
      }
      await tx.customDetector.update({
        where: { id: customDetectorId },
        data: { version: { increment: 1 } },
      });
    });
  }

  /** Every file of a detector, for a local notebook run's files directory. */
  async readAll(customDetectorId: string) {
    return this.prisma.customDetectorFile.findMany({
      where: { customDetectorId },
      select: { id: true, fileName: true, data: true },
      orderBy: { fileName: 'asc' },
    });
  }
}
