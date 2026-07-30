import { Injectable, Logger } from '@nestjs/common';
import {
  DataTransferConflict,
  DataTransferStatus,
  type DataTransferJob,
} from '@prisma/client';

import { ClsService } from 'nestjs-cls';

import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { ArchiveStorageService } from './archive-storage.service';
import {
  ArchiveFormatError,
  ArchiveReader,
  type ArchiveManifest,
} from './archive';
import {
  BATCH_PAUSE_MS,
  BINARY_BATCH_SIZE,
  TRANSFER_BATCH_SIZE,
} from './data-transfer.constants';
import { tableSpec, type TransferTableSpec } from './transfer-scopes';
import { TransferProgress } from './transfer-progress';
import { modelDelegate, scalarFields } from './prisma-delegate';
import { createIdRemapper, type IdRemapper } from './id-remap';
import { cursorArg, keyOf } from './namespace-export.service';

/**
 * Loads an archive into the current namespace.
 *
 * The archive is read one line at a time and inserted in batches as it streams,
 * which is only safe because the exporter writes tables in foreign-key-safe
 * order — a referenced row is always already committed by the time the row
 * referencing it arrives. That is what keeps the import to constant memory
 * regardless of archive size.
 *
 * Three things routinely go wrong with a real archive, and each is handled
 * rather than fatal:
 *
 *  - **Partial scopes.** Importing `investigations` without `findings` leaves
 *    rows pointing at nothing. The batch insert fails, the fallback retries row
 *    by row, orphans are counted as skipped and reported once per table.
 *  - **Version drift.** An archive from a different release carries columns this
 *    schema does not have. Unknown columns are pruned before insert.
 *  - **Existing data.** Primary keys already present are either skipped or
 *    overwritten, per the job's conflict mode.
 */
@Injectable()
export class NamespaceImportService {
  private readonly logger = new Logger(NamespaceImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArchiveStorageService,
    private readonly cls: ClsService,
  ) {}

  async run(job: DataTransferJob): Promise<void> {
    if (!job.storageKey) {
      throw new Error('Import job has no uploaded archive');
    }

    // The upload was accepted by an API pod; this worker is a different pod, so
    // the archive has to be fetched from shared storage before it can be read.
    const schema = this.cls.get<string>(CLS_SCHEMA) ?? 'namespace';
    const localPath = await this.storage.materialize(schema, job.storageKey);
    if (!localPath) {
      throw new Error(
        'The uploaded archive is no longer available — upload it again',
      );
    }

    const progress = new TransferProgress(this.prisma, job.id);
    const selected = new Set(job.scopes);
    const reader = new ArchiveReader(localPath);

    // Every imported row gets a fresh identity derived from the job id, so an
    // import is purely additive and a retry of this same job reproduces exactly
    // the same ids rather than a second copy of everything.
    const remapId = createIdRemapper(job.id);

    await this.prisma.dataTransferJob.update({
      where: { id: job.id },
      data: {
        status: DataTransferStatus.RUNNING,
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    // A buffer of consecutive rows for one table. The archive is grouped by
    // table, so this flushes on every table boundary and whenever it fills.
    let pending: Record<string, unknown>[] = [];
    let pendingTable: TransferTableSpec | null = null;
    let estimated = false;
    const skippedTables = new Set<string>();

    const flush = async (): Promise<void> => {
      if (!pendingTable || pending.length === 0) return;
      const table = pendingTable;
      const rows = pending;
      pending = [];
      await this.writeBatch(
        table,
        rows,
        job.conflictMode,
        selected,
        remapId,
        progress,
      );
      await progress.flush();
      await sleep(BATCH_PAUSE_MS);
    };

    try {
      for await (const { table: model, row } of reader.read()) {
        if (progress.cancelled) break;

        // The manifest is parsed before the first row is yielded, so the
        // progress denominator is known from the very first batch.
        if (!estimated && reader.manifest) {
          estimated = true;
          this.applyManifestEstimate(reader.manifest, selected, progress);
        }

        const spec = tableSpec(model);
        if (!spec) {
          // A table this build does not know — an archive from a newer release.
          if (!skippedTables.has(model)) {
            skippedTables.add(model);
            progress.warn(
              `Skipped unknown table '${model}' — this archive was written by a newer version of Classifyre.`,
            );
          }
          continue;
        }
        if (!selected.has(spec.scope)) continue;

        if (pendingTable && pendingTable.model !== spec.model) await flush();
        pendingTable = spec;
        progress.setTable(spec.model);
        pending.push(row);

        const limit =
          spec.model === 'uploadedSourceFile'
            ? BINARY_BATCH_SIZE
            : TRANSFER_BATCH_SIZE;
        if (pending.length >= limit) await flush();
      }

      await flush();

      if (progress.cancelled) {
        await this.finish(job.id, DataTransferStatus.CANCELLED, progress);
        return;
      }

      if (!reader.footer) {
        throw new ArchiveFormatError(
          'Archive ended without its footer — the upload is incomplete',
        );
      }

      this.warnAboutStrippedSecrets(reader.footer.stripped, progress);
      await this.finish(job.id, DataTransferStatus.COMPLETED, progress);

      this.logger.log(
        `Import ${job.id} wrote ${progress.processedRows} rows ` +
          `(${progress.skippedRows} skipped)`,
      );
    } catch (error) {
      progress.setTable(null);
      throw error;
    }
  }

  /**
   * Read an archive's manifest without importing it, so the operator can see
   * what it holds — and pick a subset — before committing.
   */
  async inspect(filePath: string): Promise<ArchiveManifest> {
    return new ArchiveReader(filePath).readManifest();
  }

  private applyManifestEstimate(
    manifest: ArchiveManifest,
    selected: Set<string>,
    progress: TransferProgress,
  ): void {
    let total = 0;
    for (const [model, count] of Object.entries(manifest.estimatedCounts)) {
      const spec = tableSpec(model);
      if (spec && selected.has(spec.scope)) total += count;
    }
    progress.setTotal(total);
  }

  private warnAboutStrippedSecrets(
    stripped: Record<string, string[]> | undefined,
    progress: TransferProgress,
  ): void {
    if (!stripped) return;
    const models = Object.keys(stripped);
    if (models.length === 0) return;

    if (stripped['source']) {
      progress.warn(
        'Imported sources have no connection credentials — open each source and re-enter them before scanning.',
      );
    }
    if (stripped['aiProviderConfig']) {
      progress.warn(
        'Imported AI providers have no API key — re-enter it in Settings → AI providers.',
      );
    }
    if (stripped['mcpServerConfig']) {
      progress.warn(
        'Imported MCP servers were left disabled because their request headers were not exported.',
      );
    }
    if (stripped['chatBot']) {
      progress.warn(
        'Imported chat bots were left disabled because their bot tokens were not exported.',
      );
    }
    if (stripped['instanceSettings']) {
      progress.warn(
        'The Hugging Face access token was not exported — re-enter it in Settings if you use gated repositories.',
      );
    }
  }

  /**
   * Insert one batch. The fast path is a single `createMany`; the slow path
   * exists because `createMany` is all-or-nothing and one orphaned row would
   * otherwise discard the other 499.
   */
  private async writeBatch(
    table: TransferTableSpec,
    rows: Record<string, unknown>[],
    conflictMode: DataTransferConflict,
    selected: Set<string>,
    remapId: IdRemapper,
    progress: TransferProgress,
  ): Promise<void> {
    const prepared = rows.map((row) =>
      this.prepare(table, row, selected, remapId, progress),
    );
    const delegate = modelDelegate(this.prisma, table.model);

    // Singletons (instance settings, correlation config, per-agent config) have
    // a fixed key that already exists in a provisioned schema, so an insert
    // would always collide. They are upserted individually — there are only
    // ever a handful of them.
    if (table.singleton) {
      for (const row of prepared) {
        await this.upsertRow(table, row, progress);
      }
      return;
    }

    if (conflictMode === DataTransferConflict.OVERWRITE) {
      for (const row of prepared) {
        await this.upsertRow(table, row, progress);
      }
      return;
    }

    try {
      const result = await delegate.createMany({
        data: prepared,
        skipDuplicates: true,
      });
      progress.advance(table.model, result.count);
      progress.skip(prepared.length - result.count);
      return;
    } catch (error) {
      this.logger.debug(
        `Batch insert into ${table.model} failed (${String(error)}); retrying row by row`,
      );
    }

    // Row-by-row fallback: keep everything that can be written, count and
    // explain the rest.
    let failures = 0;
    for (const row of prepared) {
      try {
        await delegate.create({ data: row });
        progress.advance(table.model, 1);
      } catch {
        failures += 1;
        progress.skip(1);
      }
    }
    if (failures > 0) {
      progress.warn(
        `${failures} of ${prepared.length} '${table.model}' rows could not be imported — ` +
          'they already exist, or they reference data in a scope that was not included.',
      );
    }
  }

  private async upsertRow(
    table: TransferTableSpec,
    row: Record<string, unknown>,
    progress: TransferProgress,
  ): Promise<void> {
    const delegate = modelDelegate(this.prisma, table.model);
    const where = cursorArg(table, keyOf(table, row));
    try {
      await delegate.upsert({ where, create: row, update: row });
      progress.advance(table.model, 1);
    } catch {
      progress.skip(1);
      progress.warn(
        `A '${table.model}' row could not be imported — it references data in a scope that was not included.`,
      );
    }
  }

  /**
   * Drop columns this schema does not have, null out references into scopes the
   * operator left out, then apply the table's import defaults (which land
   * credential-stripped connectors in a disabled state).
   */
  private prepare(
    table: TransferTableSpec,
    row: Record<string, unknown>,
    selected: Set<string>,
    remapId: IdRemapper,
    progress: TransferProgress,
  ): Record<string, unknown> {
    const known = scalarFields(table.model);
    const prepared: Record<string, unknown> = {};
    const dropped: string[] = [];

    for (const [column, value] of Object.entries(row)) {
      if (known.has(column)) prepared[column] = value;
      else dropped.push(column);
    }

    if (dropped.length > 0) {
      progress.warn(
        `Ignored unknown column(s) on '${table.model}': ${dropped.join(', ')} — ` +
          'the archive came from a different version of Classifyre.',
      );
    }

    // Give the row a new identity and rewrite every reference the same way, so
    // the graph stays internally consistent while colliding with nothing that
    // already exists here. Content hashes and enum keys are natural keys and
    // pass through untouched (see id-remap.ts).
    for (const column of table.idRefs ?? []) {
      if (prepared[column] === undefined || prepared[column] === null) continue;
      prepared[column] = remapId(prepared[column]);
    }

    // An optional reference into an excluded scope is dropped, not fatal:
    // importing assets without scan history should give you the assets, minus
    // the link back to the run that ingested them.
    for (const [column, scope] of Object.entries(table.optionalRefs ?? {})) {
      if (selected.has(scope)) continue;
      if (prepared[column] === undefined || prepared[column] === null) continue;
      prepared[column] = null;
      progress.warn(
        `'${table.model}.${column}' was cleared because '${scope}' was not included in this import.`,
      );
    }

    return table.importDefaults
      ? { ...prepared, ...table.importDefaults }
      : prepared;
  }

  private async finish(
    jobId: string,
    status: DataTransferStatus,
    progress: TransferProgress,
  ): Promise<void> {
    await this.prisma.dataTransferJob.update({
      where: { id: jobId },
      data: {
        status,
        percent:
          status === DataTransferStatus.COMPLETED ? 100 : progress.percent,
        currentTable: null,
        processedRows: progress.processedRows,
        skippedRows: progress.skippedRows,
        counts: progress.tableCounts,
        warnings: progress.collectedWarnings,
        finishedAt: new Date(),
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
