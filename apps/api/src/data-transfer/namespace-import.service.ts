import { Injectable, Logger } from '@nestjs/common';
import {
  DataTransferConflict,
  DataTransferStatus,
  type DataTransferJob,
} from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { ArchiveStoreService } from './archive-store.service';
import { ArchiveReader, type ArchiveManifest } from './archive';
import {
  BATCH_PAUSE_MS,
  BINARY_BATCH_SIZE,
  TRANSFER_BATCH_SIZE,
} from './data-transfer.constants';
import {
  scopeById,
  tableSpec,
  type TransferTableSpec,
} from './transfer-scopes';
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
 * Nothing past the manifest is fatal. Once the file has been recognised as one
 * of ours, the import's job is to land as much of it as it can and then say
 * precisely what it could not land — a run that gets 400,000 rows in and then
 * throws away all of them because row 400,001 was damaged is the worst possible
 * outcome for an operator who waited for it. So each of these is absorbed:
 *
 *  - **Partial scopes.** Importing `investigations` without `findings` leaves
 *    rows pointing at nothing. The batch insert fails, the fallback halves the
 *    batch until it has isolated the offenders, and they are counted as skipped
 *    and reported once per table with a total.
 *  - **Version drift.** An archive from a different release carries columns this
 *    schema does not have. Unknown columns are pruned before insert.
 *  - **Existing data.** Primary keys already present are either skipped or
 *    overwritten, per the job's conflict mode.
 *  - **A damaged or truncated file.** Unreadable records are skipped; a stream
 *    that dies mid-read, or ends without its footer, finishes the rows already
 *    read and completes with a warning saying how far it got.
 *  - **A table that refuses everything.** One exploding table is reported and
 *    stepped over; the remaining tables still import.
 */
@Injectable()
export class NamespaceImportService {
  private readonly logger = new Logger(NamespaceImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ArchiveStoreService,
  ) {}

  async run(job: DataTransferJob): Promise<void> {
    if (!job.archived || !(await this.store.exists(job.id))) {
      throw new Error(
        'The uploaded archive is no longer available — upload it again',
      );
    }

    const progress = new TransferProgress(this.prisma, job.id);
    const selected = new Set(job.scopes);
    // The upload was accepted by an API pod and this worker is a different one;
    // the archive is read back out of the database, which is what they share.
    const reader = new ArchiveReader(
      () => this.store.stream(job.id),
      (description) =>
        progress.tally(
          'archive:badRecord',
          1,
          (count) =>
            `${count.toLocaleString()} record(s) in the archive could not be read and were skipped (first: ${description}).`,
        ),
    );

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

    /**
     * Write the buffered rows. A batch that cannot be written at all — a lost
     * connection, a model this build cannot address — is reported and stepped
     * over rather than allowed to abort the run.
     */
    const flush = async (): Promise<void> => {
      if (!pendingTable || pending.length === 0) return;
      const table = pendingTable;
      const rows = pending;
      pending = [];
      try {
        await this.writeBatch(
          table,
          rows,
          job.conflictMode,
          selected,
          remapId,
          progress,
        );
      } catch (error) {
        progress.skip(rows.length);
        progress.tally(
          `batchFailed:${table.model}`,
          rows.length,
          (count) =>
            `${count.toLocaleString()} '${table.model}' rows could not be written (${describe(error)}). The rest of the archive was still imported.`,
        );
      }
      await progress.flush();
      await sleep(BATCH_PAUSE_MS);
    };

    try {
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
      } catch (error) {
        // A read that dies before the manifest means this was never one of our
        // archives — there is nothing to salvage and no way to describe what
        // was imported, so that stays fatal. Anything later is a damaged file
        // that already gave us real rows: keep them.
        if (!reader.manifest) throw error;
        progress.warn(
          `The archive could not be read to the end (${describe(error)}). ` +
            'Everything readable up to that point was imported.',
        );
      }

      await flush();

      if (progress.cancelled) {
        await this.finish(job.id, DataTransferStatus.CANCELLED, progress);
        return;
      }

      if (!reader.complete) {
        progress.warn(
          'The archive ended without its footer, so it was incomplete — ' +
            'probably truncated in transit. Everything it did contain was imported; ' +
            're-export and import again to fill the gap.',
        );
      }

      this.warnAboutStrippedSecrets(reader.footer?.stripped, progress);
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
  async inspect(bytes: Buffer): Promise<ArchiveManifest> {
    return ArchiveReader.fromBuffer(bytes).readManifest();
  }

  /**
   * The same, for an archive already staged in the chunk store. Reading stops
   * at the first line, so this costs one gzip block however large the upload
   * was — which is what lets the upload endpoint answer immediately after the
   * last byte lands instead of parsing the file.
   */
  async inspectStored(jobId: string): Promise<ArchiveManifest> {
    return new ArchiveReader(() => this.store.stream(jobId)).readManifest();
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
   * Insert one batch. The fast path is a single `createMany`; the fallback
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

    const failures = await this.insertBisecting(
      table,
      delegate,
      prepared,
      progress,
    );
    progress.tally(
      `rowFailed:${table.model}`,
      failures,
      (count) =>
        `${count.toLocaleString()} '${table.model}' rows could not be imported — ` +
        'they already exist here, or they reference data in a scope that was not included.',
    );
  }

  /**
   * Write `rows`, isolating whatever cannot be written by halving.
   *
   * `createMany` is one statement: it either takes the whole batch or none of
   * it. The obvious fallback — retry every row on its own — costs 500 round
   * trips to find the one row with a dangling foreign key, and on an archive
   * where that happens per batch it is the difference between an import that
   * takes minutes and one that takes hours. Halving finds the bad rows in about
   * a dozen statements when they are rare, and never costs more than twice the
   * row-by-row path when they are not.
   *
   * Returns the number of rows that could not be written; they are already
   * counted as skipped.
   */
  private async insertBisecting(
    table: TransferTableSpec,
    delegate: ReturnType<typeof modelDelegate>,
    rows: Record<string, unknown>[],
    progress: TransferProgress,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    try {
      const result = await delegate.createMany({
        data: rows,
        skipDuplicates: true,
      });
      progress.advance(table.model, result.count);
      // Rows `skipDuplicates` dropped are skipped, not failed: they are already
      // here, which is the outcome the operator asked for.
      progress.skip(rows.length - result.count);
      return 0;
    } catch (error) {
      if (rows.length === 1) {
        this.logger.debug(`Row rejected by ${table.model}: ${describe(error)}`);
        progress.skip(1);
        return 1;
      }
    }

    const middle = Math.floor(rows.length / 2);
    return (
      (await this.insertBisecting(
        table,
        delegate,
        rows.slice(0, middle),
        progress,
      )) +
      (await this.insertBisecting(
        table,
        delegate,
        rows.slice(middle),
        progress,
      ))
    );
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
      // Counted, not warned per row: this fires on every affected row, and the
      // number of rows is the only part an operator can act on.
      progress.tally(
        `cleared:${table.model}.${column}`,
        1,
        (count) =>
          `${count.toLocaleString()} ${plural(table.model)} were imported without their link to ` +
          `${scopeLabel(scope)} — that data was not part of this import. The rows themselves are all here.`,
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `runnerAsset` → `runner assets`, for warnings an operator has to read. */
function plural(model: string): string {
  const words = model.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.endsWith('s') ? words : `${words}s`;
}

function scopeLabel(scope: string): string {
  return (scopeById(scope)?.label ?? scope).toLowerCase();
}
