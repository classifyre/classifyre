import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { createReadStream, type Stats } from 'fs';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { RunnerLogEntryDto, RunnerLogsResponseDto } from './dto';

type RunnerLogStream = 'stderr' | 'stdout' | 'combined';

interface StoredRunnerLogEntry {
  timestamp: string;
  stream: RunnerLogStream;
  message: string;
}

interface S3Config {
  client: S3Client;
  bucket: string;
  prefix: string;
}

@Injectable()
export class RunnerLogStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunnerLogStorageService.name);

  // Filesystem state
  private readonly rootDir = path.resolve(
    process.env.RUNNER_LOGS_DIR ||
      path.join(process.cwd(), 'var', 'runner-logs'),
  );
  private readonly tempDir = path.resolve(
    process.env.TEMP_DIR || '/tmp',
    'classifyre-runner-logs',
  );

  // Shared write-serialisation
  private readonly lineBuffers = new Map<string, string>();
  private readonly writeQueues = new Map<string, Promise<void>>();

  // S3 backend (populated when S3_BUCKET is set)
  private s3: S3Config | null = null;

  // Per-runner S3 sync timers
  private readonly s3SyncTimers = new Map<string, NodeJS.Timeout>();

  async onModuleInit(): Promise<void> {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      return; // filesystem mode
    }

    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || 'us-east-1';
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false';

    const client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });

    this.s3 = {
      client,
      bucket,
      prefix: process.env.S3_LOG_PREFIX || 'runner-logs/',
    };

    await this.ensureBucket();
    await fs.mkdir(this.tempDir, { recursive: true });

    this.logger.log(
      `S3 log storage: bucket=${bucket} endpoint=${endpoint || 'aws'} prefix=${this.s3.prefix}`,
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.s3SyncTimers.values()) {
      clearInterval(timer);
    }
  }

  async initializeRunner(runnerId: string): Promise<void> {
    if (this.s3) {
      await fs.mkdir(this.getTempRunnerDir(runnerId), { recursive: true });
      await fs.writeFile(this.getTempLogPath(runnerId), '', 'utf8');
      this.clearRunnerBuffers(runnerId);
      await this.s3PutObject(runnerId, '');
      this.startSyncTimer(runnerId);
    } else {
      await this.ensureRunnerDir(runnerId);
      await fs.writeFile(this.getRunnerLogPath(runnerId), '', 'utf8');
      this.clearRunnerBuffers(runnerId);
    }
  }

  async appendChunk(
    runnerId: string,
    chunk: string,
    stream: RunnerLogStream = 'stderr',
  ): Promise<void> {
    if (!chunk) return;

    const filePath = this.s3
      ? this.getTempLogPath(runnerId)
      : this.getRunnerLogPath(runnerId);

    await this.enqueueWrite(runnerId, async () => {
      if (this.s3) {
        await fs.mkdir(this.getTempRunnerDir(runnerId), { recursive: true });
      } else {
        await this.ensureRunnerDir(runnerId);
      }

      const bufferKey = this.getBufferKey(runnerId, stream);
      const previousBuffer = this.lineBuffers.get(bufferKey) || '';
      const combined = previousBuffer + chunk;
      const lines = combined.split('\n');
      const remainder = lines.pop() || '';
      this.lineBuffers.set(bufferKey, remainder);

      if (lines.length === 0) return;

      const encoded = lines
        .map((line) =>
          this.encodeEntry(this.createEntry(line.replace(/\r$/, ''), stream)),
        )
        .join('');

      if (encoded) {
        await fs.appendFile(filePath, encoded, 'utf8');
      }
    });
  }

  async finalizeRunner(runnerId: string): Promise<void> {
    await this.waitForPendingWrites(runnerId);

    const filePath = this.s3
      ? this.getTempLogPath(runnerId)
      : this.getRunnerLogPath(runnerId);

    const pendingEntries: StoredRunnerLogEntry[] = [];
    for (const stream of [
      'stderr',
      'stdout',
      'combined',
    ] as RunnerLogStream[]) {
      const bufferKey = this.getBufferKey(runnerId, stream);
      const remainder = this.lineBuffers.get(bufferKey);
      if (remainder && remainder.trim().length > 0) {
        pendingEntries.push(
          this.createEntry(remainder.replace(/\r$/, ''), stream),
        );
      }
      this.lineBuffers.delete(bufferKey);
    }

    if (pendingEntries.length > 0) {
      await this.enqueueWrite(runnerId, async () => {
        const payload = pendingEntries
          .map((entry) => this.encodeEntry(entry))
          .join('');
        if (payload) await fs.appendFile(filePath, payload, 'utf8');
      });
      await this.waitForPendingWrites(runnerId);
    }

    if (this.s3) {
      this.stopSyncTimer(runnerId);
      await this.syncToS3(runnerId);
      await fs.rm(this.getTempRunnerDir(runnerId), {
        recursive: true,
        force: true,
      });
    }
  }

  async deleteRunnerLogs(runnerId: string): Promise<void> {
    await this.waitForPendingWrites(runnerId);
    this.writeQueues.delete(runnerId);
    this.clearRunnerBuffers(runnerId);

    if (this.s3) {
      this.stopSyncTimer(runnerId);
      await fs.rm(this.getTempRunnerDir(runnerId), {
        recursive: true,
        force: true,
      });
      await this.s3DeleteObject(runnerId).catch((err) => {
        this.logger.warn(
          `Could not delete S3 log for ${runnerId}: ${err?.message}`,
        );
      });
    } else {
      await fs.rm(this.getRunnerDir(runnerId), {
        recursive: true,
        force: true,
      });
    }
  }

  async listLogs(params: {
    runnerId: string;
    cursor?: string;
    take?: number | string;
  }): Promise<RunnerLogsResponseDto> {
    const take = this.resolveTake(params.take);
    const cursor = this.parseCursor(params.cursor);

    if (this.s3) {
      return this.listLogsFromS3(params.runnerId, cursor, take);
    }
    return this.listLogsFromFile(
      this.getRunnerLogPath(params.runnerId),
      params.runnerId,
      cursor,
      take,
    );
  }

  // ── S3 helpers ────────────────────────────────────────────────────────────

  private s3Key(runnerId: string): string {
    return `${this.s3!.prefix}${runnerId}/events.ndjson`;
  }

  private async ensureBucket(): Promise<void> {
    const { client, bucket } = this.s3!;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Created S3 bucket: ${bucket}`);
      } catch (err: any) {
        // Ignore BucketAlreadyOwnedByYou (concurrent creation races)
        if (err?.Code !== 'BucketAlreadyOwnedByYou') {
          this.logger.error(
            `Failed to create S3 bucket ${bucket}: ${err?.message}`,
          );
        }
      }
    }
  }

  private async s3PutObject(
    runnerId: string,
    content: string | Buffer,
  ): Promise<void> {
    const { client, bucket } = this.s3!;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: this.s3Key(runnerId),
        Body:
          typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
        ContentType: 'application/x-ndjson',
      }),
    );
  }

  private async s3DeleteObject(runnerId: string): Promise<void> {
    const { client, bucket } = this.s3!;
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: this.s3Key(runnerId) }),
    );
  }

  private async syncToS3(runnerId: string): Promise<void> {
    const tempPath = this.getTempLogPath(runnerId);
    const stat = await this.safeStat(tempPath);
    if (!stat) return;
    const content = await fs.readFile(tempPath);
    await this.s3PutObject(runnerId, content);
  }

  private startSyncTimer(runnerId: string): void {
    // Sync every 5 seconds so other API replicas can read fresh logs
    const timer = setInterval(() => {
      void this.waitForPendingWrites(runnerId)
        .then(() => this.syncToS3(runnerId))
        .catch((err) => {
          this.logger.warn(`S3 sync failed for ${runnerId}: ${err?.message}`);
        });
    }, 5_000);
    this.s3SyncTimers.set(runnerId, timer);
  }

  private stopSyncTimer(runnerId: string): void {
    const timer = this.s3SyncTimers.get(runnerId);
    if (timer) {
      clearInterval(timer);
      this.s3SyncTimers.delete(runnerId);
    }
  }

  private async listLogsFromS3(
    runnerId: string,
    cursor: number,
    take: number,
  ): Promise<RunnerLogsResponseDto> {
    // Fast path: temp file exists on this replica (active runner)
    const tempPath = this.getTempLogPath(runnerId);
    const tempStat = await this.safeStat(tempPath);
    if (tempStat) {
      return this.listLogsFromFile(tempPath, runnerId, cursor, take);
    }

    // Slow path: read from S3 using Range request
    const { client, bucket } = this.s3!;
    const key = this.s3Key(runnerId);

    let fileSize: number;
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      fileSize = head.ContentLength ?? 0;
    } catch (err: any) {
      if (
        err instanceof NoSuchKey ||
        err?.name === 'NoSuchKey' ||
        err?.$metadata?.httpStatusCode === 404
      ) {
        return {
          runnerId,
          entries: [],
          nextCursor: null,
          cursor: String(cursor),
          hasMore: false,
          take,
        };
      }
      throw err;
    }

    if (cursor >= fileSize) {
      return {
        runnerId,
        entries: [],
        nextCursor: null,
        cursor: String(cursor),
        hasMore: false,
        take,
      };
    }

    // Download up to 2 MiB starting from cursor
    const rangeEnd = Math.min(cursor + 2 * 1024 * 1024 - 1, fileSize - 1);
    const obj = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=${cursor}-${rangeEnd}`,
      }),
    );

    const content = await streamToString(obj.Body as Readable);
    const entries: RunnerLogEntryDto[] = [];
    let currentOffset = cursor;
    let remainder = content;

    while (entries.length < take) {
      const newlineIndex = remainder.indexOf('\n');
      if (newlineIndex === -1) break;

      const rawLine = remainder.slice(0, newlineIndex);
      remainder = remainder.slice(newlineIndex + 1);
      const lineOffset = currentOffset;
      currentOffset += Buffer.byteLength(rawLine, 'utf8') + 1;
      if (rawLine) entries.push(this.decodeEntry(rawLine, lineOffset));
    }

    if (
      entries.length < take &&
      remainder &&
      currentOffset >= rangeEnd + 1 &&
      currentOffset < fileSize
    ) {
      // The chunk boundary landed mid-line; the caller will resume on next poll
    }

    const hasMore = currentOffset < fileSize;
    return {
      runnerId,
      entries,
      nextCursor: hasMore ? String(currentOffset) : null,
      cursor: String(currentOffset),
      hasMore,
      take,
    };
  }

  // ── Filesystem helpers ────────────────────────────────────────────────────

  private async listLogsFromFile(
    logPath: string,
    runnerId: string,
    cursor: number,
    take: number,
  ): Promise<RunnerLogsResponseDto> {
    const stats = await this.safeStat(logPath);

    if (!stats || cursor >= stats.size) {
      return {
        runnerId,
        entries: [],
        nextCursor: null,
        cursor: String(cursor),
        hasMore: false,
        take,
      };
    }

    const fileSize = stats.size;
    const entries: RunnerLogEntryDto[] = [];
    let currentOffset = cursor;
    let remainder = '';

    const stream = createReadStream(logPath, {
      encoding: 'utf8',
      start: cursor,
    });

    for await (const chunk of stream) {
      remainder += chunk;
      while (entries.length < take) {
        const newlineIndex = remainder.indexOf('\n');
        if (newlineIndex === -1) break;
        const rawLine = remainder.slice(0, newlineIndex);
        remainder = remainder.slice(newlineIndex + 1);
        const lineOffset = currentOffset;
        currentOffset += Buffer.byteLength(rawLine, 'utf8') + 1;
        if (rawLine) entries.push(this.decodeEntry(rawLine, lineOffset));
      }
      if (entries.length >= take) break;
    }

    if (entries.length < take && remainder) {
      const lineOffset = currentOffset;
      currentOffset = fileSize;
      entries.push(this.decodeEntry(remainder, lineOffset));
    }

    const hasMore = currentOffset < fileSize;
    return {
      runnerId,
      entries,
      nextCursor: hasMore ? String(currentOffset) : null,
      cursor: String(currentOffset),
      hasMore,
      take,
    };
  }

  private createEntry(
    message: string,
    stream: RunnerLogStream,
  ): StoredRunnerLogEntry {
    return { timestamp: new Date().toISOString(), stream, message };
  }

  private encodeEntry(entry: StoredRunnerLogEntry): string {
    return `${JSON.stringify(entry)}\n`;
  }

  private decodeEntry(rawLine: string, offset: number): RunnerLogEntryDto {
    try {
      const parsed = JSON.parse(rawLine) as Partial<StoredRunnerLogEntry>;
      const stream = this.normalizeStream(parsed.stream);
      const timestamp =
        typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
      const message =
        typeof parsed.message === 'string'
          ? parsed.message
          : JSON.stringify(parsed);
      return { cursor: String(offset), timestamp, stream, message };
    } catch {
      return {
        cursor: String(offset),
        timestamp: null,
        stream: 'combined',
        message: rawLine,
      };
    }
  }

  private normalizeStream(value: unknown): RunnerLogStream {
    if (value === 'stderr' || value === 'stdout' || value === 'combined')
      return value;
    return 'combined';
  }

  private parseCursor(cursor?: string): number {
    if (!cursor) return 0;
    const parsed = Number.parseInt(cursor, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        'Invalid cursor. Cursor must be a non-negative integer string.',
      );
    }
    return parsed;
  }

  private resolveTake(take?: number | string): number {
    const numeric =
      typeof take === 'string' ? Number.parseInt(take, 10) : Number(take);
    const resolved = Number.isFinite(numeric) ? numeric : 200;
    return Math.max(1, Math.min(1000, Math.trunc(resolved)));
  }

  private async ensureRunnerDir(runnerId: string): Promise<void> {
    await fs.mkdir(this.getRunnerDir(runnerId), { recursive: true });
  }

  private async safeStat(filePath: string): Promise<Stats | null> {
    try {
      return await fs.stat(filePath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async waitForPendingWrites(runnerId: string): Promise<void> {
    await this.writeQueues.get(runnerId);
  }

  private enqueueWrite(runnerId: string, operation: () => Promise<void>) {
    const previous = this.writeQueues.get(runnerId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(operation)
      .catch((error) => {
        this.logger.error(
          `Failed writing runner logs for ${runnerId}: ${error?.message || error}`,
        );
      });
    this.writeQueues.set(runnerId, next);
    return next;
  }

  private clearRunnerBuffers(runnerId: string) {
    for (const key of this.lineBuffers.keys()) {
      if (key.startsWith(`${runnerId}:`)) this.lineBuffers.delete(key);
    }
  }

  private getBufferKey(runnerId: string, stream: RunnerLogStream): string {
    return `${runnerId}:${stream}`;
  }

  private getRunnerDir(runnerId: string): string {
    return path.join(this.rootDir, runnerId);
  }

  private getRunnerLogPath(runnerId: string): string {
    return path.join(this.getRunnerDir(runnerId), 'events.ndjson');
  }

  private getTempRunnerDir(runnerId: string): string {
    return path.join(this.tempDir, runnerId);
  }

  private getTempLogPath(runnerId: string): string {
    return path.join(this.getTempRunnerDir(runnerId), 'events.ndjson');
  }
}

async function streamToString(readable: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}
