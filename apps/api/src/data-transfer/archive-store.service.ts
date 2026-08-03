import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';

import { PrismaService } from '../prisma.service';

/**
 * The archive's bytes, stored in Postgres against the job that owns them.
 *
 * Postgres because it is the only thing the two halves of this feature share.
 * An export runs on the worker deployment; its download is served by the API
 * deployment. Anything written to a pod's filesystem is invisible to the other
 * pod, which is how a completed export ends up 404-ing on download. Object
 * storage would also work, but it is off by default and requiring a bucket to
 * export a workspace is a poor trade for the size these archives actually are.
 *
 * Split across {@link CHUNK_BYTES} rows rather than one `bytea` so both
 * directions stay bounded: the export appends a chunk and forgets it, the
 * download reads them back in order, and neither ever holds the whole archive.
 * Chunks cascade-delete with their job, so cleanup is one `DELETE`.
 */

/** Bytes per chunk row. Large enough that a big archive is few rows, small
 *  enough that one row is a comfortable buffer and query payload. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

@Injectable()
export class ArchiveStoreService {
  private readonly logger = new Logger(ArchiveStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** How long an archive survives after the run that produced it finishes. */
  get ttlMs(): number {
    return readIntEnv('DATA_TRANSFER_TTL_MINUTES', 60) * 60 * 1000;
  }

  /**
   * Largest archive accepted on import. Unlimited by default, matching the
   * multipart/body limits in main.ts — a real corpus export is routinely
   * hundreds of MB and a fixed ceiling only made import fail at the door.
   *
   * `DATA_TRANSFER_MAX_MB` re-imposes a cap for deployments that want one;
   * anything unset or non-positive means no cap.
   */
  get maxArchiveBytes(): number {
    const mb = readIntEnv('DATA_TRANSFER_MAX_MB', 0);
    return mb > 0 ? mb * 1024 * 1024 : Number.MAX_SAFE_INTEGER;
  }

  expiryFromNow(): Date {
    return new Date(Date.now() + this.ttlMs);
  }

  /** Human-facing archive name, e.g. `Acme-Investigations-2026-07-31-0834.cfyre`. */
  archiveFileName(namespaceName: string, extension: string): string {
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace('T', '-')
      .replace(':', '');
    const label =
      namespaceName
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'workspace';
    return `${label}-${stamp}${extension}`;
  }

  /** Append one chunk. Ordinals must be dense and start at zero. */
  async writeChunk(
    jobId: string,
    ordinal: number,
    data: Buffer,
  ): Promise<void> {
    await this.prisma.dataTransferChunk.create({
      // Prisma's Bytes input is a plain Uint8Array; a Buffer's backing store is
      // typed more loosely, so it is narrowed here rather than at every caller.
      data: { jobId, ordinal, data: new Uint8Array(data) },
    });
  }

  /** Store a complete archive that is already in memory (an upload). */
  async writeAll(jobId: string, bytes: Buffer): Promise<number> {
    let ordinal = 0;
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      await this.writeChunk(
        jobId,
        ordinal,
        bytes.subarray(offset, offset + CHUNK_BYTES),
      );
      ordinal += 1;
    }
    return ordinal;
  }

  /**
   * Stream an archive's bytes back in order.
   *
   * One row per round trip: holding a cursor open across the whole read would
   * pin a connection for as long as the download takes, and the primary key
   * already makes each lookup a single index seek.
   */
  async *read(jobId: string): AsyncGenerator<Buffer> {
    for (let ordinal = 0; ; ordinal += 1) {
      const chunk = await this.prisma.dataTransferChunk.findUnique({
        where: { jobId_ordinal: { jobId, ordinal } },
        select: { data: true },
      });
      if (!chunk) return;
      yield Buffer.from(chunk.data);
    }
  }

  /** The same bytes as a Node stream, for piping to an HTTP response. */
  stream(jobId: string): Readable {
    return Readable.from(this.read(jobId));
  }

  async exists(jobId: string): Promise<boolean> {
    const first = await this.prisma.dataTransferChunk.findUnique({
      where: { jobId_ordinal: { jobId, ordinal: 0 } },
      select: { ordinal: true },
    });
    return first !== null;
  }

  /** Total stored size, computed in the database rather than by reading rows. */
  async size(jobId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ total: bigint | null }[]>`
      SELECT sum(octet_length(data))::bigint AS total
      FROM data_transfer_chunks WHERE job_id = ${jobId}
    `;
    return Number(row?.total ?? 0);
  }

  /** Drop an archive, leaving its job row as history. */
  async remove(jobId: string): Promise<void> {
    await this.prisma.dataTransferChunk.deleteMany({ where: { jobId } });
    await this.prisma.dataTransferJob
      .update({ where: { id: jobId }, data: { archived: false } })
      .catch(() => undefined);
  }

  /**
   * Drop the archives of every job whose retention has lapsed. Jobs stay as
   * history; only their bytes go.
   */
  async purgeExpired(): Promise<number> {
    const expired = await this.prisma.dataTransferJob.findMany({
      where: { archived: true, expiresAt: { lt: new Date() } },
      select: { id: true },
    });

    for (const job of expired) await this.remove(job.id);

    if (expired.length > 0) {
      this.logger.log(`Purged ${expired.length} expired transfer archive(s)`);
    }
    return expired.length;
  }
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
