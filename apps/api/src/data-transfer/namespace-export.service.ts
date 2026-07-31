import { Injectable, Logger } from '@nestjs/common';
import { DataTransferStatus, type DataTransferJob } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA, CLS_SLUG } from '../namespace/namespace.constants';
import { ArchiveStorageService } from './archive-storage.service';
import {
  ARCHIVE_MAGIC,
  ARCHIVE_VERSION,
  ArchiveWriter,
  type ArchiveManifest,
} from './archive';
import {
  BATCH_PAUSE_MS,
  BINARY_BATCH_SIZE,
  TRANSFER_BATCH_SIZE,
} from './data-transfer.constants';
import { assertNoSecrets, redactRow } from './redaction';
import { tablesForScopes, type TransferTableSpec } from './transfer-scopes';
import { TransferProgress } from './transfer-progress';
import { modelDelegate, type TransferDelegate } from './prisma-delegate';

/**
 * Writes the selected scopes of the current namespace to an archive on disk.
 *
 * Every table is read with keyset pagination (`ORDER BY <pk>` + cursor) rather
 * than OFFSET, so page 5000 costs the same as page 1 and a concurrent insert
 * can never make the walk skip or repeat a row. Between batches the export
 * sleeps briefly and yields the connection pool — a full export of a mature
 * namespace touches millions of rows, and it is background work that must not
 * starve the interactive API or a running scan.
 *
 * Rows go through {@link redactRow} and then {@link assertNoSecrets} before they
 * reach the writer. The guard throws rather than filters, so a model that grows
 * a credential column fails the export loudly instead of leaking it.
 */
@Injectable()
export class NamespaceExportService {
  private readonly logger = new Logger(NamespaceExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArchiveStorageService,
    private readonly cls: ClsService,
  ) {}

  async run(job: DataTransferJob): Promise<void> {
    const progress = new TransferProgress(this.prisma, job.id);
    const tables = tablesForScopes(job.scopes);

    const slug = this.cls.get<string>(CLS_SLUG) ?? 'namespace';
    const schema = this.cls.get<string>(CLS_SCHEMA) ?? 'namespace';
    const fileName = this.storage.archiveFileName(slug);
    const localPath = await this.storage.allocate(schema, fileName);
    const storageKey = this.storage.handleFor(localPath);

    await this.prisma.dataTransferJob.update({
      where: { id: job.id },
      data: {
        status: DataTransferStatus.RUNNING,
        startedAt: new Date(),
        fileName,
        storageKey,
        errorMessage: null,
      },
    });

    const estimates = await this.estimate(tables);
    progress.setTotal(Object.values(estimates).reduce((sum, n) => sum + n, 0));

    const writer = new ArchiveWriter(localPath);
    const stripped: Record<string, string[]> = {};

    try {
      const manifest: ArchiveManifest = {
        kind: ARCHIVE_MAGIC,
        v: ARCHIVE_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: process.env.APP_VERSION ?? 'unknown',
        namespace: { name: slug, slug },
        scopes: job.scopes as ArchiveManifest['scopes'],
        estimatedCounts: estimates,
        secretsStripped: true,
      };
      await writer.writeManifest(manifest);

      for (const table of tables) {
        if (progress.cancelled) break;
        progress.setTable(table.model);
        const removed = await this.exportTable(table, writer, progress);
        if (removed.size > 0) stripped[table.model] = [...removed];
      }

      if (progress.cancelled) {
        await writer.destroy(new Error('cancelled'));
        await this.storage.remove(schema, storageKey);
        await this.finishCancelled(job.id, progress);
        return;
      }

      await writer.writeFooter({ counts: progress.tableCounts, stripped });
      const result = await writer.close();

      // Hand the finished archive to shared storage before the job is marked
      // complete: the download is served by a different pod than the worker
      // that produced it, so a COMPLETED job whose archive is still pod-local
      // would 404 the moment anyone clicked it.
      await this.storage.publish(schema, localPath);

      if (Object.keys(stripped).length > 0) {
        progress.warn(
          'Credentials were removed from this archive. Sources, AI providers, ' +
            'MCP servers and chat bots will need their secrets re-entered after import.',
        );
      }

      await this.prisma.dataTransferJob.update({
        where: { id: job.id },
        data: {
          status: DataTransferStatus.COMPLETED,
          percent: 100,
          currentTable: null,
          processedRows: progress.processedRows,
          totalRows: progress.processedRows,
          counts: progress.tableCounts,
          warnings: progress.collectedWarnings,
          fileSize: BigInt(result.size),
          checksum: result.checksum,
          expiresAt: this.storage.expiryFromNow(),
          finishedAt: new Date(),
        },
      });

      this.logger.log(
        `Export ${job.id} wrote ${progress.processedRows} rows to ${fileName} ` +
          `(${Math.round(result.size / 1024)} KB)`,
      );
    } catch (error) {
      await writer.destroy(
        error instanceof Error ? error : new Error(String(error)),
      );
      await this.storage.remove(schema, storageKey);
      throw error;
    }
  }

  /**
   * Row counts per table, taken before the walk starts so the UI has a
   * denominator. Counts are cheap relative to the export and are only ever used
   * for the progress bar, so drift on a busy namespace is harmless.
   */
  private async estimate(
    tables: readonly TransferTableSpec[],
  ): Promise<Record<string, number>> {
    const estimates: Record<string, number> = {};
    for (const table of tables) {
      try {
        estimates[table.model] = await modelDelegate(
          this.prisma,
          table.model,
        ).count();
      } catch (error) {
        this.logger.warn(
          `Could not count ${table.model}: ${String(error)} — excluding it from the progress estimate`,
        );
        estimates[table.model] = 0;
      }
    }
    return estimates;
  }

  private async exportTable(
    table: TransferTableSpec,
    writer: ArchiveWriter,
    progress: TransferProgress,
  ): Promise<Set<string>> {
    const delegate = modelDelegate(this.prisma, table.model);
    const batchSize =
      table.model === 'uploadedSourceFile'
        ? BINARY_BATCH_SIZE
        : TRANSFER_BATCH_SIZE;
    const removed = new Set<string>();
    let cursor: Record<string, unknown> | undefined;

    for (;;) {
      const rows = (await delegate.findMany({
        take: batchSize,
        orderBy: table.keys.map((key) => ({ [key]: 'asc' })),
        ...(cursor ? { cursor: cursorArg(table, cursor), skip: 1 } : {}),
      })) as Record<string, unknown>[];

      if (rows.length === 0) break;

      for (const row of rows) {
        const redacted = redactRow(table, row);
        for (const path of redacted.stripped) removed.add(path);
        assertNoSecrets(table.model, redacted.row);
        await writer.writeRecord(table.model, redacted.row);
      }

      progress.advance(table.model, rows.length);
      cursor = keyOf(table, rows[rows.length - 1]);

      await progress.flush();
      if (progress.cancelled) return removed;
      if (rows.length < batchSize) break;
      await sleep(BATCH_PAUSE_MS);
    }

    return removed;
  }

  private async finishCancelled(
    jobId: string,
    progress: TransferProgress,
  ): Promise<void> {
    await this.prisma.dataTransferJob.update({
      where: { id: jobId },
      data: {
        status: DataTransferStatus.CANCELLED,
        currentTable: null,
        storageKey: null,
        counts: progress.tableCounts,
        warnings: progress.collectedWarnings,
        finishedAt: new Date(),
      },
    });
  }
}

/** The primary-key values of a row, as the next page's cursor. */
export function keyOf(
  table: TransferTableSpec,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const key: Record<string, unknown> = {};
  for (const field of table.keys) key[field] = row[field];
  return key;
}

/**
 * Prisma addresses a composite key through a single generated property
 * (`runnerId_assetHash`), and a single-column key directly.
 */
export function cursorArg(
  table: TransferTableSpec,
  key: Record<string, unknown>,
): Record<string, unknown> {
  return table.compoundKey ? { [table.compoundKey]: key } : key;
}

export type { TransferDelegate };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
