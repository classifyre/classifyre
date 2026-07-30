import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { ARCHIVE_EXTENSION } from './archive';

/**
 * Where archives live between being produced and being consumed.
 *
 * Never the database: an archive is a single opaque blob that is only ever
 * written once and read once, start to finish, and pushing a multi-gigabyte
 * bytea through Postgres would defeat the entire point of keeping transfers off
 * the database's back.
 *
 * Two backends, because the two supported deployments have genuinely different
 * topologies:
 *
 *  - **Local filesystem** (desktop, and Kubernetes with a shared volume). One
 *    process writes and reads the file. Set `DATA_TRANSFER_DIR`.
 *  - **S3 / object storage** (the Helm chart's default shape). The API and the
 *    worker are *separate deployments*, so the worker that writes an export
 *    archive is not the pod that later serves its download, and the pod that
 *    accepts an import upload is not the one that reads it. Anything
 *    pod-local silently 404s the moment there is more than one replica. Set
 *    `S3_BUCKET` — the same object-storage configuration the runner logs use.
 *
 * Either way the local path stays the working unit: the export writes a local
 * file and uploads it on completion, the import downloads to a local file and
 * reads it. Both directions are one complete write followed by one complete
 * read, so nothing needs a multipart streaming upload.
 *
 * Archives are keyed by tenant schema so a namespace teardown drops the whole
 * prefix, and expire on a TTL so an operator who exports and never downloads
 * does not slowly fill the volume or the bucket.
 */
@Injectable()
export class ArchiveStorageService implements OnModuleInit {
  private readonly logger = new Logger(ArchiveStorageService.name);

  /** Working directory. With S3 configured this is a staging area only. */
  private rootDir = path.join(os.tmpdir(), 'classifyre-transfers');

  private s3: { client: S3Client; bucket: string; prefix: string } | null =
    null;

  /** How long an archive survives after the job that produced it finishes. */
  private ttlMs = 24 * 60 * 60 * 1000;

  /** Refused upload size; also the practical ceiling on an export. */
  private maxBytes = 8 * 1024 * 1024 * 1024;

  async onModuleInit(): Promise<void> {
    const configured = process.env.DATA_TRANSFER_DIR;
    if (configured) this.rootDir = path.resolve(configured);

    this.ttlMs = readIntEnv('DATA_TRANSFER_TTL_HOURS', 24) * 60 * 60 * 1000;
    this.maxBytes = readIntEnv('DATA_TRANSFER_MAX_GB', 8) * 1024 * 1024 * 1024;

    try {
      await fsp.mkdir(this.rootDir, { recursive: true });
    } catch (error) {
      this.logger.error(
        `Could not create archive directory ${this.rootDir}: ${String(error)}`,
      );
    }

    // An explicit directory wins: it is how the desktop app and a shared-volume
    // Kubernetes install both opt out of object storage.
    const bucket = configured ? undefined : process.env.S3_BUCKET;
    if (bucket) {
      this.s3 = {
        client: new S3Client({
          region: process.env.S3_REGION || 'us-east-1',
          ...(process.env.S3_ENDPOINT
            ? { endpoint: process.env.S3_ENDPOINT }
            : {}),
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
          credentials:
            process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
              ? {
                  accessKeyId: process.env.S3_ACCESS_KEY_ID,
                  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
                }
              : undefined,
        }),
        bucket,
        prefix: process.env.S3_TRANSFER_PREFIX || 'namespace-archives/',
      };
      this.logger.log(
        `Archive storage: s3 bucket=${bucket} prefix=${this.s3.prefix} ` +
          `ttl=${this.ttlMs / 3_600_000}h maxSize=${gb(this.maxBytes)}GB`,
      );
      return;
    }

    if (!configured && process.env.SERVICE_ROLE) {
      // Split api/worker deployments cannot share an ephemeral pod filesystem.
      this.logger.warn(
        'Neither DATA_TRANSFER_DIR nor S3_BUCKET is set. Archives will be written to ' +
          "this pod's temporary directory, so exports produced by the worker will not be " +
          'downloadable from the API. Configure one of the two for namespace transfers.',
      );
    }

    this.logger.log(
      `Archive storage: dir=${this.rootDir} ttl=${this.ttlMs / 3_600_000}h ` +
        `maxSize=${gb(this.maxBytes)}GB`,
    );
  }

  get maxArchiveBytes(): number {
    return this.maxBytes;
  }

  /** True when archives are shared through object storage rather than a disk. */
  get usesObjectStorage(): boolean {
    return this.s3 !== null;
  }

  expiryFromNow(): Date {
    return new Date(Date.now() + this.ttlMs);
  }

  /** Allocate a local path for a new archive without creating the file. */
  async allocate(schema: string, fileName: string): Promise<string> {
    const dir = await this.schemaDir(schema);
    return path.join(dir, `${randomUUID()}-${sanitizeSegment(fileName)}`);
  }

  /** The handle a client (and the job row) uses to refer to an archive. */
  handleFor(filePath: string): string {
    return path.basename(filePath);
  }

  /**
   * Publish a locally written archive so any pod can read it, and return the
   * handle to store on the job. A no-op on the filesystem backend.
   */
  async publish(schema: string, filePath: string): Promise<void> {
    if (!this.s3) return;
    await this.s3.client.send(
      new PutObjectCommand({
        Bucket: this.s3.bucket,
        Key: this.objectKey(schema, path.basename(filePath)),
        Body: createReadStream(filePath),
        ContentLength: await this.localSize(filePath),
        ContentType: 'application/gzip',
      }),
    );
    // The staging copy has served its purpose; the object is the archive now.
    await fsp.rm(filePath, { force: true }).catch(() => undefined);
  }

  /**
   * Resolve a handle to a readable local path, fetching it from object storage
   * first when necessary. Returns null when the archive no longer exists.
   *
   * The handle is always a basename, never a path: it round-trips through the
   * client, so treating it as a path would let a crafted value read — and on
   * cleanup delete — any file the process can reach. Sanitizing the segment and
   * re-checking that the join stayed inside the namespace's own directory
   * closes both halves.
   */
  async materialize(schema: string, handle: string): Promise<string | null> {
    const dir = await this.schemaDir(schema);
    const name = sanitizeSegment(path.basename(handle));
    const local = path.resolve(dir, name);
    if (local !== path.join(dir, path.basename(local))) return null;

    if (await this.exists(local)) return local;
    if (!this.s3) return null;

    let body: Readable;
    try {
      const object = await this.s3.client.send(
        new GetObjectCommand({
          Bucket: this.s3.bucket,
          Key: this.objectKey(schema, name),
        }),
      );
      body = object.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    // Download to a temp name and rename, so a concurrent reader never opens a
    // half-written archive and fails its footer check.
    const staging = `${local}.${randomUUID()}.part`;
    try {
      await pipeline(body, createWriteStream(staging));
      await fsp.rename(staging, local);
    } catch (error) {
      await fsp.rm(staging, { force: true }).catch(() => undefined);
      throw error;
    }
    return local;
  }

  /** Whether an archive is still retrievable, without downloading it. */
  async available(schema: string, handle: string): Promise<boolean> {
    const dir = await this.schemaDir(schema);
    const name = sanitizeSegment(path.basename(handle));
    if (await this.exists(path.join(dir, name))) return true;
    if (!this.s3) return false;

    try {
      await this.s3.client.send(
        new HeadObjectCommand({
          Bucket: this.s3.bucket,
          Key: this.objectKey(schema, name),
        }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async remove(
    schema: string,
    handle: string | null | undefined,
  ): Promise<void> {
    if (!handle) return;
    const name = sanitizeSegment(path.basename(handle));
    const dir = await this.schemaDir(schema);
    await fsp.rm(path.join(dir, name), { force: true }).catch(() => undefined);

    if (!this.s3) return;
    await this.s3.client
      .send(
        new DeleteObjectCommand({
          Bucket: this.s3.bucket,
          Key: this.objectKey(schema, name),
        }),
      )
      .catch(() => undefined);
  }

  /** Byte size of an archive, wherever it currently lives. */
  async size(schema: string, handle: string): Promise<number> {
    const dir = await this.schemaDir(schema);
    const local = path.join(dir, sanitizeSegment(path.basename(handle)));
    if (await this.exists(local)) return this.localSize(local);

    if (!this.s3) return 0;
    try {
      const head = await this.s3.client.send(
        new HeadObjectCommand({
          Bucket: this.s3.bucket,
          Key: this.objectKey(schema, path.basename(handle)),
        }),
      );
      return head.ContentLength ?? 0;
    } catch {
      return 0;
    }
  }

  /** Drop every archive belonging to a namespace being torn down. */
  async removeSchema(schema: string): Promise<void> {
    await fsp
      .rm(path.join(this.rootDir, sanitizeSegment(schema)), {
        recursive: true,
        force: true,
      })
      .catch(() => undefined);

    if (!this.s3) return;
    const prefix = this.objectKey(schema, '');
    let token: string | undefined;
    do {
      const listed = await this.s3.client
        .send(
          new ListObjectsV2Command({
            Bucket: this.s3.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        )
        .catch(() => null);
      if (!listed) return;
      for (const object of listed.Contents ?? []) {
        if (!object.Key) continue;
        await this.s3.client
          .send(
            new DeleteObjectCommand({
              Bucket: this.s3.bucket,
              Key: object.Key,
            }),
          )
          .catch(() => undefined);
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  }

  /** Human-facing archive name, e.g. `acme-2026-07-30.cfyre`. */
  archiveFileName(namespaceSlug: string): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `${sanitizeSegment(namespaceSlug)}-${stamp}${ARCHIVE_EXTENSION}`;
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async localSize(filePath: string): Promise<number> {
    const stat = await fsp.stat(filePath);
    return stat.size;
  }

  private objectKey(schema: string, name: string): string {
    return `${this.s3?.prefix ?? ''}${sanitizeSegment(schema)}/${name}`;
  }

  private async schemaDir(schema: string): Promise<string> {
    const dir = path.join(this.rootDir, sanitizeSegment(schema));
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }
}

function sanitizeSegment(value: string): string {
  // Path traversal here would let a crafted namespace slug or filename write
  // outside the archive root.
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'archive';
}

function isNotFound(error: unknown): boolean {
  const err = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    err?.name === 'NoSuchKey' ||
    err?.name === 'NotFound' ||
    err?.$metadata?.httpStatusCode === 404
  );
}

function gb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024 / 1024);
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
