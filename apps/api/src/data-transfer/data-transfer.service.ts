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

import { ClsService } from 'nestjs-cls';

import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { PgBossService } from '../scheduler/pg-boss.service';
import { ArchiveStorageService } from './archive-storage.service';
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
  /** Tenant schema the upload was staged under. */
  schema: string;
  /** Opaque handle returned by {@link DataTransferService.previewUpload}. */
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
    private readonly storage: ArchiveStorageService,
    private readonly importer: NamespaceImportService,
    private readonly cls: ClsService,
  ) {}

  /** Archives are keyed by tenant schema, both on disk and in the bucket. */
  private schema(): string {
    return this.cls.get<string>(CLS_SCHEMA) ?? 'namespace';
  }

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
    schema: string,
    fileName: string,
    bytes: Buffer,
  ): Promise<ArchivePreview> {
    if (bytes.length === 0) {
      throw new BadRequestException('The uploaded archive is empty');
    }
    if (bytes.length > this.storage.maxArchiveBytes) {
      throw new BadRequestException(
        `Archive is larger than the ${Math.round(
          this.storage.maxArchiveBytes / 1024 / 1024 / 1024,
        )} GB limit`,
      );
    }

    const localPath = await this.storage.allocate(schema, fileName);
    const storageKey = this.storage.handleFor(localPath);
    const fsp = await import('node:fs/promises');
    await fsp.writeFile(localPath, bytes);

    let manifest: ArchiveManifest;
    try {
      manifest = await this.importer.inspect(localPath);
    } catch (error) {
      await this.storage.remove(schema, storageKey);
      throw new BadRequestException(
        error instanceof ArchiveFormatError
          ? error.message
          : `Could not read the archive: ${String(error)}`,
      );
    }

    // Validated, so hand it to shared storage — the worker that will read it
    // runs in a different pod and cannot see this one's filesystem.
    await this.storage.publish(schema, localPath);

    const rowsByScope: Record<string, number> = {};
    let totalRows = 0;
    for (const [model, count] of Object.entries(manifest.estimatedCounts)) {
      const table = TRANSFER_TABLES.find((t) => t.model === model);
      if (!table) continue;
      rowsByScope[table.scope] = (rowsByScope[table.scope] ?? 0) + count;
      totalRows += count;
    }

    return {
      // An opaque handle, resolved back to a path server-side — never the path
      // itself, which the client could then point anywhere.
      uploadId: storageKey,
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
    const storageKey = this.storage.handleFor(input.uploadId);
    if (!(await this.storage.available(input.schema, storageKey))) {
      throw new BadRequestException(
        'The uploaded archive is no longer available — upload it again',
      );
    }
    await this.assertNoActiveJob();

    const job = await this.prisma.dataTransferJob.create({
      data: {
        kind: DataTransferKind.IMPORT,
        scopes,
        conflictMode: input.conflictMode ?? DataTransferConflict.SKIP,
        // Strip the UUID prefix the staging step added, so the operator sees
        // the name of the file they picked.
        fileName: storageKey.replace(/^[0-9a-f-]{36}-/i, ''),
        storageKey,
        fileSize: BigInt(await this.storage.size(input.schema, storageKey)),
        createdBy: input.createdBy ?? null,
        expiresAt: this.storage.expiryFromNow(),
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

    if (job.status === DataTransferStatus.PENDING) {
      await this.storage.remove(this.schema(), job.storageKey);
      return this.prisma.dataTransferJob.update({
        where: { id },
        data: {
          status: DataTransferStatus.CANCELLED,
          cancelRequested: true,
          storageKey: null,
          finishedAt: new Date(),
        },
      });
    }

    return this.prisma.dataTransferJob.update({
      where: { id },
      data: { cancelRequested: true },
    });
  }

  async remove(id: string): Promise<void> {
    const job = await this.get(id);
    if (!isTerminal(job.status)) {
      throw new BadRequestException('Cancel the transfer before deleting it');
    }
    await this.storage.remove(this.schema(), job.storageKey);
    await this.prisma.dataTransferJob.delete({ where: { id } });
  }

  /**
   * Resolve a completed export's archive to a local file the download endpoint
   * can stream. On object storage this pulls it into the API pod's staging
   * directory first — the archive was written by the worker, which this pod
   * shares no filesystem with.
   */
  async downloadable(
    id: string,
  ): Promise<{ path: string; fileName: string; size: number }> {
    const job = await this.get(id);
    if (job.kind !== DataTransferKind.EXPORT) {
      throw new BadRequestException('Only exports produce a downloadable file');
    }
    if (job.status !== DataTransferStatus.COMPLETED || !job.storageKey) {
      throw new BadRequestException('This export has not finished');
    }

    const schema = this.schema();
    const localPath = await this.storage.materialize(schema, job.storageKey);
    if (!localPath) {
      throw new NotFoundException(
        'The archive has expired and been removed — run the export again',
      );
    }
    return {
      path: localPath,
      fileName: job.fileName ?? 'namespace-archive.cfyre',
      size: await this.storage.size(schema, job.storageKey),
    };
  }

  /**
   * Delete archives past their TTL and forget the jobs that pointed at them.
   * Called on worker startup and on a timer.
   */
  async purgeExpired(): Promise<number> {
    const schema = this.schema();
    const expired = await this.prisma.dataTransferJob.findMany({
      where: { expiresAt: { lt: new Date() }, storageKey: { not: null } },
      select: { id: true, storageKey: true },
    });

    for (const job of expired) {
      await this.storage.remove(schema, job.storageKey);
      await this.prisma.dataTransferJob
        .update({ where: { id: job.id }, data: { storageKey: null } })
        .catch(() => undefined);
    }

    if (expired.length > 0) {
      this.logger.log(`Purged ${expired.length} expired transfer archive(s)`);
    }
    return expired.length;
  }

  /**
   * Mark jobs that were mid-flight when the worker died as failed. A transfer
   * is not resumable — it would have to reconcile a half-written archive — so
   * it is surfaced as failed and the operator restarts it.
   */
  async recoverStaleJobs(): Promise<void> {
    const schema = this.schema();
    const stale = await this.prisma.dataTransferJob.findMany({
      where: { status: DataTransferStatus.RUNNING },
      select: { id: true, storageKey: true, kind: true },
    });

    for (const job of stale) {
      // A half-written export archive is garbage; an import's archive was
      // uploaded by the operator and is worth keeping so they can retry.
      if (job.kind === DataTransferKind.EXPORT) {
        await this.storage.remove(schema, job.storageKey);
      }
      await this.prisma.dataTransferJob.update({
        where: { id: job.id },
        data: {
          status: DataTransferStatus.FAILED,
          errorMessage:
            'The transfer was interrupted when the service restarted. Start it again.',
          finishedAt: new Date(),
          ...(job.kind === DataTransferKind.EXPORT ? { storageKey: null } : {}),
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
