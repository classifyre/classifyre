import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { type LogLevel, RunnerLogEntryDto, RunnerLogsResponseDto } from './dto';

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

/** Resolved parameters used internally by listLogs / paginateEntries. */
interface ResolvedListParams {
  take: number;
  skip: number;
  sortOrder: 'asc' | 'desc';
  searchLower: string;
  levelFilter: Set<string>;
  streamFilter: Set<string>;
}

@Injectable()
export class RunnerLogStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunnerLogStorageService.name);

  // Filesystem fallback root (used when S3 is not configured)
  private readonly rootDir = path.resolve(
    process.env.RUNNER_LOGS_DIR ||
      path.join(process.cwd(), 'var', 'runner-logs'),
  );

  // ── In-memory log buffers ─────────────────────────────────────────────────
  // Populated for the lifetime of an active run on this API replica.
  // Cleared on finalizeRunner / deleteRunnerLogs.
  private readonly inMemoryLogs = new Map<string, StoredRunnerLogEntry[]>();

  // Partial-line buffers (one per runnerId:stream key)
  private readonly lineBuffers = new Map<string, string>();

  // S3 backend (populated when S3_BUCKET is set)
  private s3: S3Config | null = null;

  // Per-runner S3 sync timers (periodic upload during active run)
  private readonly s3SyncTimers = new Map<string, NodeJS.Timeout>();

  // Per-runner sourceId lookup (needed by onModuleDestroy)
  private readonly runnerSourceIds = new Map<string, string>();

  /**
   * Serialized S3 upload chain per runner.
   * Guarantees that uploads never race: the next PutObject always waits for
   * the previous one to finish, so the latest upload always wins.
   */
  private readonly s3SyncChains = new Map<string, Promise<void>>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

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

    await this.retryWithBackoff(
      () => this.ensureBucket(),
      10,
      1000,
      `S3 bucket ${bucket}`,
    );

    this.logger.log(
      `S3 log storage: bucket=${bucket} endpoint=${endpoint || 'aws'} prefix=${this.s3.prefix}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Final upload for any active runners before process shuts down
    if (this.s3) {
      await Promise.all(
        Array.from(this.s3SyncTimers.keys()).map(async (runnerId) => {
          const sourceId = this.runnerSourceIds.get(runnerId);
          if (!sourceId) return;
          try {
            await this.syncToS3Serialized(sourceId, runnerId);
          } catch (err: any) {
            this.logger.warn(
              `Final S3 sync failed for ${runnerId}: ${err?.message}`,
            );
          }
        }),
      );
    }

    for (const timer of this.s3SyncTimers.values()) {
      clearInterval(timer);
    }
    this.s3SyncTimers.clear();
    this.runnerSourceIds.clear();
    this.s3SyncChains.clear();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Returns the sourceId recorded at initializeRunner time, or undefined if unknown. */
  getRunnerSourceId(runnerId: string): string | undefined {
    return this.runnerSourceIds.get(runnerId);
  }

  async initializeRunner(sourceId: string, runnerId: string): Promise<void> {
    this.inMemoryLogs.set(runnerId, []);
    this.clearRunnerBuffers(runnerId);
    this.s3SyncChains.delete(runnerId);

    if (this.s3) {
      this.runnerSourceIds.set(runnerId, sourceId);
      this.startSyncTimer(sourceId, runnerId);
      // Immediately create an empty object so the key exists in S3
      await this.doSyncToS3(sourceId, runnerId).catch(() => undefined);
    } else {
      await this.ensureRunnerDir(runnerId);
      await fs.writeFile(this.getRunnerLogPath(runnerId), '', 'utf8');
    }
  }

  /**
   * Parse a raw output chunk into complete log lines and append them to
   * the in-memory buffer.  Returns the new `RunnerLogEntryDto` objects so
   * callers can push them to WebSocket clients without a separate read.
   */
  appendChunk(
    runnerId: string,
    chunk: string,
    stream: RunnerLogStream = 'stderr',
  ): RunnerLogEntryDto[] {
    if (!chunk) return [];

    const bufferKey = this.getBufferKey(runnerId, stream);
    const previous = this.lineBuffers.get(bufferKey) || '';
    const combined = previous + chunk;
    const lines = combined.split('\n');
    const remainder = lines.pop() || '';
    this.lineBuffers.set(bufferKey, remainder);

    if (lines.length === 0) return [];

    const entries: StoredRunnerLogEntry[] = lines.map((line) =>
      this.createEntry(line.replace(/\r$/, ''), stream),
    );

    const buffer = this.inMemoryLogs.get(runnerId);
    if (buffer) {
      const baseIndex = buffer.length;
      buffer.push(...entries);
      return entries.map((e, i) => this.entryToDto(e, baseIndex + i));
    }

    // Runner not initialised on this replica — return DTOs with ephemeral index
    return entries.map((e, i) => this.entryToDto(e, i));
  }

  async finalizeRunner(sourceId: string, runnerId: string): Promise<void> {
    // Flush any incomplete last line held in the line buffers
    for (const stream of [
      'stderr',
      'stdout',
      'combined',
    ] as RunnerLogStream[]) {
      const bufferKey = this.getBufferKey(runnerId, stream);
      const remainder = this.lineBuffers.get(bufferKey);
      if (remainder?.trim().length) {
        const entry = this.createEntry(remainder.replace(/\r$/, ''), stream);
        this.inMemoryLogs.get(runnerId)?.push(entry);
      }
      this.lineBuffers.delete(bufferKey);
    }

    if (this.s3) {
      // Stop periodic syncs, then perform a final serialised upload so there
      // is no race between the timer and this final write.
      this.stopSyncTimer(runnerId);
      await this.syncToS3Serialized(sourceId, runnerId);
      this.inMemoryLogs.delete(runnerId);
      this.s3SyncChains.delete(runnerId);
    } else {
      // Filesystem mode: write the full accumulated buffer to disk
      const entries = this.inMemoryLogs.get(runnerId) ?? [];
      const ndjson = entries.map((e) => this.encodeEntry(e)).join('');
      await this.ensureRunnerDir(runnerId);
      await fs.writeFile(this.getRunnerLogPath(runnerId), ndjson, 'utf8');
      this.inMemoryLogs.delete(runnerId);
    }
  }

  async deleteRunnerLogs(sourceId: string, runnerId: string): Promise<void> {
    this.inMemoryLogs.delete(runnerId);
    this.clearRunnerBuffers(runnerId);

    if (this.s3) {
      this.stopSyncTimer(runnerId);
      this.s3SyncChains.delete(runnerId);
      await this.s3DeleteObject(sourceId, runnerId).catch((err) => {
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
    sourceId: string;
    runnerId: string;
    cursor?: string;
    skip?: number;
    take?: number | string;
    search?: string;
    levels?: string[];
    sortOrder?: 'asc' | 'desc';
    streams?: string[];
  }): Promise<RunnerLogsResponseDto> {
    const resolved = this.resolveListParams(params);

    // ── Active run on this replica (in-memory) ─────────────────────────────
    const buffer = this.inMemoryLogs.get(params.runnerId);
    if (buffer !== undefined) {
      const dtos = buffer.map((e, i) => this.entryToDto(e, i));
      return this.paginateEntries(params.runnerId, dtos, resolved);
    }

    // ── S3 mode (completed run or different replica) ───────────────────────
    if (this.s3) {
      return this.listLogsFromS3(params.sourceId, params.runnerId, resolved);
    }

    // ── Filesystem mode (completed run) ───────────────────────────────────
    const logPath = this.getRunnerLogPath(params.runnerId);
    const stat = await this.safeStat(logPath);
    if (!stat) {
      return this.emptyResponse(params.runnerId, resolved.take);
    }
    const readable = createReadStream(logPath);
    const allEntries = await this.readAllEntriesFromStream(readable);
    return this.paginateEntries(params.runnerId, allEntries, resolved);
  }

  // ── Pagination helper ─────────────────────────────────────────────────────

  private paginateEntries(
    runnerId: string,
    allEntries: RunnerLogEntryDto[],
    params: ResolvedListParams,
  ): RunnerLogsResponseDto {
    const { take, skip, sortOrder, searchLower, levelFilter, streamFilter } =
      params;

    const filtered = allEntries.filter((e) =>
      this.matchesFilter(e, searchLower, levelFilter, streamFilter),
    );
    const total = filtered.length;

    if (sortOrder === 'desc') {
      filtered.reverse();
    }

    const page = filtered.slice(skip, skip + take);
    const nextSkip = skip + take;
    const hasMore = nextSkip < total;

    return {
      runnerId,
      entries: page,
      nextCursor: hasMore ? `i:${nextSkip}` : null,
      cursor: `i:${nextSkip}`,
      hasMore,
      take,
      total,
    };
  }

  // ── S3 streaming (completed run / different replica) ─────────────────────

  private async listLogsFromS3(
    sourceId: string,
    runnerId: string,
    params: ResolvedListParams,
  ): Promise<RunnerLogsResponseDto> {
    let obj: GetObjectCommandOutput;
    try {
      obj = await this.s3!.client.send(
        new GetObjectCommand({
          Bucket: this.s3!.bucket,
          Key: this.s3Key(sourceId, runnerId),
        }),
      );
    } catch (err: any) {
      if (
        err instanceof NoSuchKey ||
        err?.name === 'NoSuchKey' ||
        err?.$metadata?.httpStatusCode === 404
      ) {
        return this.emptyResponse(runnerId, params.take);
      }
      throw err;
    }

    const allEntries = await this.readAllEntriesFromStream(
      obj.Body as Readable,
    );
    return this.paginateEntries(runnerId, allEntries, params);
  }

  // ── S3 sync helpers ───────────────────────────────────────────────────────

  /**
   * Schedule an S3 upload that is chained after the previous one for this
   * runner.  This prevents concurrent PutObject calls from racing.
   */
  private syncToS3Serialized(
    sourceId: string,
    runnerId: string,
  ): Promise<void> {
    const prev = this.s3SyncChains.get(runnerId) ?? Promise.resolve();
    const next = prev
      .then(() => this.doSyncToS3(sourceId, runnerId))
      .catch((err: any) => {
        this.logger.warn(`S3 sync failed for ${runnerId}: ${err?.message}`);
      });
    this.s3SyncChains.set(runnerId, next);
    return next;
  }

  /** Serialise the in-memory buffer and upload it as a single PutObject. */
  private async doSyncToS3(sourceId: string, runnerId: string): Promise<void> {
    const entries = this.inMemoryLogs.get(runnerId);
    if (entries === undefined) return; // Already finalized or not on this replica
    const ndjson = entries.map((e) => this.encodeEntry(e)).join('');
    await this.s3PutObject(sourceId, runnerId, ndjson);
  }

  private startSyncTimer(sourceId: string, runnerId: string): void {
    this.runnerSourceIds.set(runnerId, sourceId);
    const timer = setInterval(() => {
      void this.syncToS3Serialized(sourceId, runnerId);
    }, 5_000);
    this.s3SyncTimers.set(runnerId, timer);
  }

  private stopSyncTimer(runnerId: string): void {
    const timer = this.s3SyncTimers.get(runnerId);
    if (timer) {
      clearInterval(timer);
      this.s3SyncTimers.delete(runnerId);
    }
    this.runnerSourceIds.delete(runnerId);
  }

  // ── Stream parser (for S3 / filesystem reads) ─────────────────────────────

  private async readAllEntriesFromStream(
    readable: Readable,
  ): Promise<RunnerLogEntryDto[]> {
    const entries: RunnerLogEntryDto[] = [];
    let remainder = '';
    let index = 0;

    for await (const rawChunk of readable) {
      const chunk: string =
        typeof rawChunk === 'string'
          ? rawChunk
          : (rawChunk as Buffer).toString('utf8');
      remainder += chunk;

      while (true) {
        const nl = remainder.indexOf('\n');
        if (nl === -1) break;

        const rawLine = remainder.slice(0, nl);
        remainder = remainder.slice(nl + 1);

        if (!rawLine) continue;
        entries.push(this.decodeEntryAtIndex(rawLine, index++));
      }
    }

    if (remainder) {
      entries.push(this.decodeEntryAtIndex(remainder, index));
    }

    return entries;
  }

  // ── S3 object helpers ─────────────────────────────────────────────────────

  private s3Key(sourceId: string, runnerId: string): string {
    return `${this.s3!.prefix}${sourceId}/${runnerId}.ndjson`;
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
        if (err?.Code !== 'BucketAlreadyOwnedByYou') {
          this.logger.error(
            `Failed to create S3 bucket ${bucket}: ${err?.message}`,
          );
        }
      }
    }
  }

  private async s3PutObject(
    sourceId: string,
    runnerId: string,
    content: string | Buffer,
  ): Promise<void> {
    const { client, bucket } = this.s3!;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: this.s3Key(sourceId, runnerId),
        Body:
          typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
        ContentType: 'application/x-ndjson',
      }),
    );
  }

  private async s3DeleteObject(
    sourceId: string,
    runnerId: string,
  ): Promise<void> {
    const { client, bucket } = this.s3!;
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: this.s3Key(sourceId, runnerId),
      }),
    );
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  private matchesFilter(
    entry: RunnerLogEntryDto,
    searchLower: string,
    levelFilter: Set<string>,
    streamFilter: Set<string>,
  ): boolean {
    if (searchLower && !entry.message.toLowerCase().includes(searchLower))
      return false;
    if (levelFilter.size > 0 && !levelFilter.has(entry.level)) return false;
    if (streamFilter.size > 0 && !streamFilter.has(entry.stream)) return false;
    return true;
  }

  // ── Level / display inference ─────────────────────────────────────────────

  private inferLevel(stream: RunnerLogStream, message: string): LogLevel {
    const structured = this.tryParseJson(message);
    if (structured) {
      const raw = structured['level'] ?? structured['severity'];
      if (typeof raw === 'string') {
        const normalized = this.normalizeLevel(raw);
        if (normalized !== 'UNKNOWN') return normalized;
      }
    }
    const match = message.match(
      /\b(trace|debug|info|warn(?:ing)?|error|fatal|critical)\b/i,
    );
    if (match?.[1]) return this.normalizeLevel(match[1]);
    if (stream === 'stderr') return 'ERROR';
    return 'UNKNOWN';
  }

  private normalizeLevel(raw: string): LogLevel {
    switch (raw.toUpperCase()) {
      case 'TRACE':
        return 'TRACE';
      case 'DEBUG':
        return 'DEBUG';
      case 'INFO':
        return 'INFO';
      case 'WARN':
      case 'WARNING':
        return 'WARN';
      case 'ERROR':
        return 'ERROR';
      case 'FATAL':
      case 'CRITICAL':
        return 'FATAL';
      default:
        return 'UNKNOWN';
    }
  }

  private tryParseJson(message: string): Record<string, unknown> | null {
    const trimmed = message.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  private inferDisplayMessage(
    structured: Record<string, unknown> | null,
    rawMessage: string,
  ): string {
    const msg = structured?.['message'] ?? structured?.['msg'];
    if (typeof msg === 'string' && msg.trim().length > 0) return msg.trim();
    return rawMessage.trim();
  }

  // ── Entry encoding / decoding ─────────────────────────────────────────────

  private createEntry(
    message: string,
    stream: RunnerLogStream,
  ): StoredRunnerLogEntry {
    return { timestamp: new Date().toISOString(), stream, message };
  }

  private encodeEntry(entry: StoredRunnerLogEntry): string {
    return `${JSON.stringify(entry)}\n`;
  }

  /** Convert a stored entry + its position index to a DTO. */
  private entryToDto(
    entry: StoredRunnerLogEntry,
    index: number,
  ): RunnerLogEntryDto {
    const structured = this.tryParseJson(entry.message);
    return {
      cursor: String(index),
      timestamp: entry.timestamp,
      stream: entry.stream,
      message: this.inferDisplayMessage(structured, entry.message),
      level: this.inferLevel(entry.stream, entry.message),
    };
  }

  private decodeEntryAtIndex(
    rawLine: string,
    index: number,
  ): RunnerLogEntryDto {
    try {
      const parsed = JSON.parse(rawLine) as Partial<StoredRunnerLogEntry>;
      const stream = this.normalizeStream(parsed.stream);
      const timestamp =
        typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
      const rawMessage =
        typeof parsed.message === 'string'
          ? parsed.message
          : JSON.stringify(parsed);
      const structured = this.tryParseJson(rawMessage);
      return {
        cursor: String(index),
        timestamp,
        stream,
        message: this.inferDisplayMessage(structured, rawMessage),
        level: this.inferLevel(stream, rawMessage),
      };
    } catch {
      return {
        cursor: String(index),
        timestamp: null,
        stream: 'combined',
        message: rawLine,
        level: 'UNKNOWN',
      };
    }
  }

  private normalizeStream(value: unknown): RunnerLogStream {
    if (value === 'stderr' || value === 'stdout' || value === 'combined')
      return value;
    return 'combined';
  }

  // ── Cursor / param resolution ─────────────────────────────────────────────

  private resolveListParams(params: {
    cursor?: string;
    skip?: number;
    take?: number | string;
    search?: string;
    levels?: string[];
    streams?: string[];
    sortOrder?: 'asc' | 'desc';
  }): ResolvedListParams {
    const take = this.resolveTake(params.take);
    const sortOrder = params.sortOrder === 'desc' ? 'desc' : 'asc';
    const searchLower = params.search?.trim().toLowerCase() ?? '';
    const levelFilter = new Set(
      (params.levels ?? []).map((l) => l.toUpperCase()),
    );
    const streamFilter = new Set(
      (params.streams ?? []).map((s) => s.toLowerCase()),
    );

    // `skip` takes precedence over cursor
    let skip = 0;
    if (typeof params.skip === 'number' && params.skip >= 0) {
      skip = params.skip;
    } else if (params.cursor) {
      skip = this.parseIndexCursor(params.cursor);
    }

    return { take, skip, sortOrder, searchLower, levelFilter, streamFilter };
  }

  private parseIndexCursor(cursor?: string): number {
    if (!cursor) return 0;
    if (cursor.startsWith('i:')) {
      const n = Number.parseInt(cursor.slice(2), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    // Legacy byte-cursor: treat as start-of-file (index 0)
    return 0;
  }

  private resolveTake(take?: number | string): number {
    const numeric =
      typeof take === 'string' ? Number.parseInt(take, 10) : Number(take);
    const resolved = Number.isFinite(numeric) ? numeric : 200;
    return Math.max(1, Math.min(1000, Math.trunc(resolved)));
  }

  private emptyResponse(runnerId: string, take: number): RunnerLogsResponseDto {
    return {
      runnerId,
      entries: [],
      nextCursor: null,
      cursor: 'i:0',
      hasMore: false,
      take,
      total: 0,
    };
  }

  // ── Retry helper ──────────────────────────────────────────────────────────

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    baseDelayMs: number,
    description: string,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        if (attempt === maxRetries) break;
        const delay = baseDelayMs * 2 ** attempt;
        this.logger.warn(
          `${description} not ready (attempt ${attempt + 1}/${maxRetries + 1}): ${err?.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error(
      `${description} unavailable after ${maxRetries + 1} attempts: ${lastError?.message}`,
    );
  }

  // ── Filesystem helpers ────────────────────────────────────────────────────

  private async ensureRunnerDir(runnerId: string): Promise<void> {
    await fs.mkdir(this.getRunnerDir(runnerId), { recursive: true });
  }

  private async safeStat(filePath: string) {
    try {
      return await fs.stat(filePath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
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
}
