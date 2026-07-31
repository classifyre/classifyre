import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip, createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';

import type { TransferScopeId } from './transfer-scopes';

/**
 * The `.cfyre` archive: gzipped newline-delimited JSON.
 *
 * One line per record, first line the manifest, last line the footer:
 *
 *   {"v":1,"kind":"classifyre.namespace.archive",...}
 *   {"t":"sources","d":{...}}
 *   {"t":"sources","d":{...}}
 *   {"t":"assets","d":{...}}
 *   {"t":"__end__","d":{"counts":{"sources":2,"assets":1}}}
 *
 * NDJSON rather than a zip or a SQL dump because both directions then stream in
 * constant memory: the exporter appends a batch and forgets it, the importer
 * reads a line at a time and never holds the archive in RAM. Tables are written
 * in foreign-key-safe order (see transfer-scopes.ts) so the importer can insert
 * as it reads instead of buffering the whole file to sort it. Gzip because
 * these rows are highly repetitive JSON and compress roughly 10:1.
 *
 * The footer is what distinguishes a complete archive from a truncated one — an
 * import that reaches EOF without it refuses to run rather than silently
 * loading half a namespace.
 */

/** Bump on any breaking change to the line shape or a model rename. */
export const ARCHIVE_VERSION = 1;

export const ARCHIVE_MAGIC = 'classifyre.namespace.archive';
export const ARCHIVE_EXTENSION = '.cfyre';
export const FOOTER_TAG = '__end__';

export interface ArchiveManifest {
  kind: typeof ARCHIVE_MAGIC;
  v: number;
  /** ISO timestamp the export started. */
  createdAt: string;
  /** Product version that wrote the archive, for diagnosing drift. */
  appVersion: string;
  /** Display name and slug of the namespace it came from (informational). */
  namespace: { name: string; slug: string };
  scopes: TransferScopeId[];
  /** Row counts per table, estimated before the export ran. */
  estimatedCounts: Record<string, number>;
  /**
   * Always true, and always asserted on import. Credentials are removed on the
   * way out (see redaction.ts); an archive claiming otherwise is not one of
   * ours.
   */
  secretsStripped: true;
}

export interface ArchiveFooter {
  counts: Record<string, number>;
  /** Column paths removed during export, per table. */
  stripped: Record<string, string[]>;
}

export interface ArchiveRecord {
  t: string;
  d: Record<string, unknown>;
}

// ── Value encoding ───────────────────────────────────────────────────────────
// Prisma hands back types JSON cannot represent. Each is tagged so the importer
// restores the exact runtime type rather than a lookalike string, which would
// make `createMany` reject the row.

const TAG = '$t';

type TaggedValue = {
  [TAG]: 'date' | 'bigint' | 'bytes' | 'decimal';
  v: string;
};

function isTagged(value: unknown): value is TaggedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[TAG] === 'string'
  );
}

interface DecimalLike {
  toFixed(): string;
}

/** Prisma's Decimal, without importing the runtime just for an instanceof. */
function isDecimal(value: object): boolean {
  return (
    'toFixed' in value &&
    's' in value &&
    'e' in value &&
    'd' in value &&
    typeof (value as { toFixed: unknown }).toFixed === 'function'
  );
}

export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === 'bigint')
    return { [TAG]: 'bigint', v: value.toString() };
  if (value instanceof Date) return { [TAG]: 'date', v: value.toISOString() };
  if (Buffer.isBuffer(value)) {
    return { [TAG]: 'bytes', v: value.toString('base64') };
  }
  if (value instanceof Uint8Array) {
    return { [TAG]: 'bytes', v: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));

  if (typeof value === 'object') {
    if (isDecimal(value)) {
      // `toFixed()` with no argument is decimal.js's lossless normal notation;
      // going through Number would round away precision the column can hold.
      return { [TAG]: 'decimal', v: (value as DecimalLike).toFixed() };
    }
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = encodeValue(nested);
    }
    return out;
  }

  return value;
}

export function decodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (Array.isArray(value)) return value.map((item) => decodeValue(item));

  if (isTagged(value)) {
    switch (value[TAG]) {
      case 'date':
        return new Date(value.v);
      case 'bigint':
        return BigInt(value.v);
      case 'bytes':
        return Buffer.from(value.v, 'base64');
      case 'decimal':
        // Prisma accepts a numeric string for Decimal columns.
        return value.v;
      default:
        return value;
    }
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = decodeValue(nested);
    }
    return out;
  }

  return value;
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Appends NDJSON records to a gzipped file, hashing the compressed bytes as
 * they go so the archive carries a checksum without a second read pass.
 */
export class ArchiveWriter {
  private readonly source = new PassThrough();
  private readonly hash = createHash('sha256');
  private readonly done: Promise<void>;
  private bytes = 0;
  private closed = false;

  constructor(private readonly filePath: string) {
    const gzip = createGzip({ level: 6 });
    gzip.on('data', (chunk: Buffer) => {
      this.bytes += chunk.length;
      this.hash.update(chunk);
    });
    this.done = pipeline(this.source, gzip, createWriteStream(filePath));
    // The pipeline rejection is surfaced by `close()`; without a no-op handler
    // an early write failure would be an unhandled rejection first.
    this.done.catch(() => undefined);
  }

  writeManifest(manifest: ArchiveManifest): Promise<void> {
    return this.writeLine(manifest);
  }

  writeRecord(table: string, row: Record<string, unknown>): Promise<void> {
    return this.writeLine({
      t: table,
      d: encodeValue(row) as Record<string, unknown>,
    });
  }

  writeFooter(footer: ArchiveFooter): Promise<void> {
    return this.writeLine({ t: FOOTER_TAG, d: footer });
  }

  /** Flush, finish the gzip trailer and return the file's size + checksum. */
  async close(): Promise<{ path: string; size: number; checksum: string }> {
    if (!this.closed) {
      this.closed = true;
      this.source.end();
    }
    await this.done;
    return {
      path: this.filePath,
      size: this.bytes,
      checksum: this.hash.digest('hex'),
    };
  }

  /** Abandon the archive after a failure; the caller unlinks the file. */
  async destroy(error: Error): Promise<void> {
    this.closed = true;
    this.source.destroy(error);
    await this.done.catch(() => undefined);
  }

  private writeLine(value: unknown): Promise<void> {
    const line = `${JSON.stringify(value)}\n`;
    if (this.source.write(line)) return Promise.resolve();
    // Respect backpressure: a fast database read must not outrun gzip and
    // buffer the whole namespace in memory.
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.source.off('drain', onDrain);
        reject(error);
      };
      const onDrain = () => {
        this.source.off('error', onError);
        resolve();
      };
      this.source.once('drain', onDrain);
      this.source.once('error', onError);
    });
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

export class ArchiveFormatError extends Error {}

/**
 * Reads an archive line by line. Yields `{table, row}` for data records; the
 * manifest is returned up front and the footer through {@link footer} once the
 * iteration completes.
 */
export class ArchiveReader {
  private manifestValue?: ArchiveManifest;
  private footerValue?: ArchiveFooter;

  constructor(private readonly filePath: string) {}

  get footer(): ArchiveFooter | undefined {
    return this.footerValue;
  }

  get manifest(): ArchiveManifest | undefined {
    return this.manifestValue;
  }

  /**
   * Read only the manifest. Used by the upload preview to show what an archive
   * holds before the operator commits to importing any of it — it stops after
   * the first line, so a 2 GB archive costs one gzip block.
   */
  async readManifest(): Promise<ArchiveManifest> {
    for await (const line of this.lines()) {
      return parseManifest(line);
    }
    throw new ArchiveFormatError('Archive is empty');
  }

  async *read(): AsyncGenerator<{
    table: string;
    row: Record<string, unknown>;
  }> {
    let first = true;
    for await (const line of this.lines()) {
      if (first) {
        first = false;
        this.manifestValue = parseManifest(line);
        continue;
      }

      let record: ArchiveRecord;
      try {
        record = JSON.parse(line) as ArchiveRecord;
      } catch {
        throw new ArchiveFormatError('Archive contains a malformed record');
      }
      if (!record || typeof record.t !== 'string') {
        throw new ArchiveFormatError('Archive contains a record with no table');
      }

      if (record.t === FOOTER_TAG) {
        this.footerValue = record.d as unknown as ArchiveFooter;
        return;
      }

      yield {
        table: record.t,
        row: decodeValue(record.d) as Record<string, unknown>,
      };
    }

    throw new ArchiveFormatError(
      'Archive ends without its footer — the file is truncated or still uploading',
    );
  }

  private async *lines(): AsyncGenerator<string> {
    const stream = createReadStream(this.filePath).pipe(createGunzip());
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        if (line.trim().length > 0) yield line;
      }
    } catch (error) {
      if (isGzipError(error)) {
        throw new ArchiveFormatError(
          'File is not a Classifyre archive (failed to decompress)',
        );
      }
      throw error;
    } finally {
      reader.close();
      stream.destroy();
    }
  }
}

function parseManifest(line: string): ArchiveManifest {
  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(line) as ArchiveManifest;
  } catch {
    throw new ArchiveFormatError('File is not a Classifyre archive');
  }
  if (manifest?.kind !== ARCHIVE_MAGIC) {
    throw new ArchiveFormatError('File is not a Classifyre archive');
  }
  if (typeof manifest.v !== 'number' || manifest.v > ARCHIVE_VERSION) {
    throw new ArchiveFormatError(
      `Archive version ${String(manifest.v)} is newer than this instance supports (${ARCHIVE_VERSION}). Update Classifyre first.`,
    );
  }
  return manifest;
}

function isGzipError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && code.startsWith('Z_');
}
