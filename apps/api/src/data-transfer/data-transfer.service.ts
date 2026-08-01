import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DataTransferConflict,
  DataTransferKind,
  DataTransferStatus,
  type DataTransferJob,
} from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { ArchiveStoreService } from './archive-store.service';
import { NamespaceImportService } from './namespace-import.service';
import { DATA_TRANSFER_QUEUE } from './data-transfer.constants';
import {
  isTransferScopeId,
  missingDependencies,
  TRANSFER_SCOPES,
  TRANSFER_TABLES,
  type TransferScopeId,
} from './transfer-scopes';
import { ArchiveFormatError, type ArchiveManifest } from './archive';

export interface StartExportInput {
  scopes: string[];
  createdBy?: string;
}

export interface StartImportInput {
  /** Id of the STAGED job created by {@link DataTransferService.previewUpload}. */
  uploadId: string;
  scopes: string[];
  conflictMode?: DataTransferConflict;
  createdBy?: string;
}

/** What an uploaded archive holds, before anything is imported from it. */
export interface ArchivePreview {
  uploadId: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  appVersion: string;
  sourceNamespace: string;
  /** Scopes present in the archive — the only ones importable from it. */
  scopes: TransferScopeId[];
  /** Rows per scope, from the archive's manifest. */
  rowsByScope: Record<string, number>;
  totalRows: number;
}

/**
 * Job lifecycle for namespace exports and imports: validation, enqueue, status
 * and cleanup. The actual walking of tables happens on the namespace's pg-boss
 * worker (see DataTransferWorker) so a transfer survives an API pod restart and
 * cannot block a request.
 */
@Injectable()
export class DataTransferService {
  private readonly logger = new Logger(DataTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly store: ArchiveStoreService,
    private readonly importer: NamespaceImportService,
  ) {}

  /** The scope catalogue the UI renders, with live row counts per scope. */
  async scopeCatalogue(): Promise<
    Array<{
      id: TransferScopeId;
      label: string;
      description: string;
      dependsOn: readonly TransferScopeId[];
      heavy: boolean;
      redactsSecrets: boolean;
      rows: number;
    }>
  > {
    const counts = new Map<TransferScopeId, number>();
    for (const table of TRANSFER_TABLES) {
      let rows = 0;
      try {
        rows = await (
          this.prisma as unknown as Record<string, { count(): Promise<number> }>
        )[table.model].count();
      } catch {
        rows = 0;
      }
      counts.set(table.scope, (counts.get(table.scope) ?? 0) + rows);
    }

    return TRANSFER_SCOPES.map((scope) => ({
      id: scope.id,
      label: scope.label,
      description: scope.description,
      dependsOn: scope.dependsOn,
      heavy: scope.heavy ?? false,
      redactsSecrets: scope.redactsSecrets ?? false,
      rows: counts.get(scope.id) ?? 0,
    }));
  }

  async startExport(input: StartExportInput): Promise<DataTransferJob> {
    const scopes = this.validateScopes(input.scopes);
    await this.assertNoActiveJob();

    const job = await this.prisma.dataTransferJob.create({
      data: {
        kind: DataTransferKind.EXPORT,
        scopes,
        createdBy: input.createdBy ?? null,
        warnings: this.dependencyWarnings(scopes),
      },
    });

    await this.enqueue(job.id);
    return job;
  }

  /**
   * Stage an uploaded archive and read its manifest. Nothing is written to the
   * database yet — the operator reviews the contents, picks the scopes to take,
   * and only then starts the import with {@link startImport}.
   */
  async previewUpload(
    fileName: string,
    bytes: Buffer,
  ): Promise<ArchivePreview> {
    if (bytes.length === 0) {
      throw new BadRequestException('The uploaded archive is empty');
    }
    if (bytes.length > this.store.maxArchiveBytes) {
      throw new BadRequestException(
        `Archive is larger than the ${Math.round(
          this.store.maxArchiveBytes / 1024 / 1024,
        )} MB limit`,
      );
    }

    // Validate before storing anything: a file that is not one of our archives
    // should not leave rows behind.
    let manifest: ArchiveManifest;
    try {
      manifest = await this.importer.inspect(bytes);
    } catch (error) {
      throw new BadRequestException(
        error instanceof ArchiveFormatError
          ? error.message
          : `Could not read the archive: ${String(error)}`,
      );
    }

    // The job row *is* the upload handle: the archive's chunks hang off it, so
    // discarding the upload is a single delete and nothing can be orphaned.
    // STAGED means uploaded but not queued — the operator still has to choose
    // what to take.
    const job = await this.prisma.dataTransferJob.create({
      data: {
        kind: DataTransferKind.IMPORT,
        status: DataTransferStatus.STAGED,
        fileName,
        fileSize: BigInt(bytes.length),
        archived: true,
        expiresAt: this.store.expiryFromNow(),
      },
    });
    await this.store.writeAll(job.id, bytes);

    const rowsByScope: Record<string, number> = {};
    let totalRows = 0;
    for (const [model, count] of Object.entries(manifest.estimatedCounts)) {
      const table = TRANSFER_TABLES.find((t) => t.model === model);
      if (!table) continue;
      rowsByScope[table.scope] = (rowsByScope[table.scope] ?? 0) + count;
      totalRows += count;
    }

    return {
      uploadId: job.id,
      fileName,
      fileSize: bytes.length,
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      sourceNamespace: manifest.namespace?.name ?? 'unknown',
      scopes: manifest.scopes ?? [],
      rowsByScope,
      totalRows,
    };
  }

  async startImport(input: StartImportInput): Promise<DataTransferJob> {
    const scopes = this.validateScopes(input.scopes);

    const staged = await this.prisma.dataTransferJob.findUnique({
      where: { id: input.uploadId },
    });
    if (
      !staged ||
      staged.kind !== DataTransferKind.IMPORT ||
      staged.status !== DataTransferStatus.STAGED ||
      !(await this.store.exists(staged.id))
    ) {
      throw new BadRequestException(
        'The uploaded archive is no longer available — upload it again',
      );
    }
    await this.assertNoActiveJob();

    const job = await this.prisma.dataTransferJob.update({
      where: { id: staged.id },
      data: {
        status: DataTransferStatus.PENDING,
        scopes,
        conflictMode: input.conflictMode ?? DataTransferConflict.SKIP,
        createdBy: input.createdBy ?? null,
        warnings: this.dependencyWarnings(scopes),
      },
    });

    await this.enqueue(job.id);
    return job;
  }

  async list(limit = 20): Promise<DataTransferJob[]> {
    return this.prisma.dataTransferJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async get(id: string): Promise<DataTransferJob> {
    const job = await this.prisma.dataTransferJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`Unknown transfer job '${id}'`);
    return job;
  }

  /**
   * Ask a running job to stop. The worker notices at its next batch boundary
   * and finishes cleanly; a job that has not started yet is cancelled outright.
   */
  async cancel(id: string): Promise<DataTransferJob> {
    const job = await this.get(id);
    if (isTerminal(job.status)) return job;

    if (
      job.status === DataTransferStatus.PENDING ||
      job.status === DataTransferStatus.STAGED
    ) {
      await this.store.remove(id);
      return this.prisma.dataTransferJob.update({
        where: { id },
        data: {
          status: DataTransferStatus.CANCELLED,
          cancelRequested: true,
          archived: false,
          finishedAt: new Date(),
        },
      });
    }

    return this.prisma.dataTransferJob.update({
      where: { id },
      data: { cancelRequested: true },
    });
  }

  /** Delete a finished job and its archive. Chunks cascade with the row. */
  async remove(id: string): Promise<void> {
    const job = await this.get(id);
    if (!isTerminal(job.status) && job.status !== DataTransferStatus.STAGED) {
      throw new BadRequestException('Cancel the transfer before deleting it');
    }
    await this.prisma.dataTransferJob.delete({ where: { id } });
  }

  /** Everything the download endpoint needs to stream a completed export. */
  async downloadable(
    id: string,
  ): Promise<{ jobId: string; fileName: string; size: number }> {
    const job = await this.get(id);
    if (job.kind !== DataTransferKind.EXPORT) {
      throw new BadRequestException('Only exports produce a downloadable file');
    }
    if (job.status !== DataTransferStatus.COMPLETED) {
      throw new BadRequestException('This export has not finished');
    }
    if (!job.archived || !(await this.store.exists(id))) {
      throw new NotFoundException(
        'The archive has expired and been removed — run the export again',
      );
    }

    return {
      jobId: id,
      fileName: job.fileName ?? 'workspace-archive.cfyre',
      // Trust the stored total over the recorded one: they agree, and a
      // mismatched Content-Length truncates the download.
      size: await this.store.size(id),
    };
  }

  /**
   * Drop archives past their retention. The job rows stay as history; only the
   * bytes go. Runs on worker startup and on a timer.
   */
  async purgeExpired(): Promise<number> {
    return this.store.purgeExpired();
  }

  /**
   * Mark jobs that were mid-flight when the worker died as failed. A transfer
   * is not resumable — it would have to reconcile a half-written archive — so
   * it is surfaced as failed and the operator restarts it.
   */
  async recoverStaleJobs(): Promise<void> {
    const stale = await this.prisma.dataTransferJob.findMany({
      where: { status: DataTransferStatus.RUNNING },
      select: { id: true, kind: true },
    });

    for (const job of stale) {
      // A half-written export archive is garbage. An import's archive was
      // uploaded by the operator, so it is kept and the run can be retried.
      if (job.kind === DataTransferKind.EXPORT) {
        await this.store.remove(job.id);
      }
      await this.prisma.dataTransferJob.update({
        where: { id: job.id },
        data: {
          status: DataTransferStatus.FAILED,
          errorMessage:
            'The transfer was interrupted when the service restarted. Start it again.',
          finishedAt: new Date(),
        },
      });
    }

    if (stale.length > 0) {
      this.logger.warn(`Failed ${stale.length} interrupted transfer job(s)`);
    }
  }

  private async enqueue(jobId: string): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(DATA_TRANSFER_QUEUE);
    await boss.send(DATA_TRANSFER_QUEUE, { jobId }, { retryLimit: 0 });
  }

  private validateScopes(scopes: string[]): TransferScopeId[] {
    const unique = [...new Set(scopes ?? [])];
    if (unique.length === 0) {
      throw new BadRequestException('Select at least one kind of data');
    }
    const invalid = unique.filter((scope) => !isTransferScopeId(scope));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Unknown data scope: ${invalid.join(', ')}`,
      );
    }
    return unique as TransferScopeId[];
  }

  /**
   * One namespace runs one transfer at a time. Two concurrent exports would
   * double the read load for no benefit, and a concurrent import would race the
   * export it is being read into.
   */
  private async assertNoActiveJob(): Promise<void> {
    const active = await this.prisma.dataTransferJob.findFirst({
      where: {
        // STAGED is deliberately absent: an uploaded archive nobody has
        // committed to yet is not work in progress.
        status: {
          in: [DataTransferStatus.PENDING, DataTransferStatus.RUNNING],
        },
      },
      select: { id: true, kind: true },
    });
    if (active) {
      throw new BadRequestException(
        `A ${active.kind.toLowerCase()} is already running in this namespace. Wait for it to finish or cancel it.`,
      );
    }
  }

  private dependencyWarnings(scopes: TransferScopeId[]): string[] {
    return missingDependencies(scopes).map(
      ({ scope, missing }) =>
        `'${scope}' references ${missing.join(', ')}, which are not included. Rows that point at missing data will be skipped.`,
    );
  }
}

function isTerminal(status: DataTransferStatus): boolean {
  return (
    status === DataTransferStatus.COMPLETED ||
    status === DataTransferStatus.FAILED ||
    status === DataTransferStatus.CANCELLED
  );
}
