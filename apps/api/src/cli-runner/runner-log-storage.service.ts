import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import { createReadStream, type Stats } from 'fs';
import * as path from 'path';
import { type LogLevel, RunnerLogEntryDto, RunnerLogsResponseDto } from './dto';

type RunnerLogStream = 'stderr' | 'stdout' | 'combined';

interface StoredRunnerLogEntry {
  timestamp: string;
  stream: RunnerLogStream;
  message: string;
}

@Injectable()
export class RunnerLogStorageService {
  private readonly logger = new Logger(RunnerLogStorageService.name);
  private readonly rootDir = path.resolve(
    process.env.RUNNER_LOGS_DIR ||
      path.join(process.cwd(), 'var', 'runner-logs'),
  );
  private readonly lineBuffers = new Map<string, string>();
  private readonly writeQueues = new Map<string, Promise<void>>();

  async initializeRunner(runnerId: string): Promise<void> {
    await this.ensureRunnerDir(runnerId);
    await fs.writeFile(this.getRunnerLogPath(runnerId), '', 'utf8');
    this.clearRunnerBuffers(runnerId);
  }

  async appendChunk(
    runnerId: string,
    chunk: string,
    stream: RunnerLogStream = 'stderr',
  ): Promise<void> {
    if (!chunk) {
      return;
    }

    await this.enqueueWrite(runnerId, async () => {
      await this.ensureRunnerDir(runnerId);

      const bufferKey = this.getBufferKey(runnerId, stream);
      const previousBuffer = this.lineBuffers.get(bufferKey) || '';
      const combined = previousBuffer + chunk;
      const lines = combined.split('\n');
      const remainder = lines.pop() || '';
      this.lineBuffers.set(bufferKey, remainder);

      if (lines.length === 0) {
        return;
      }

      const encoded = lines
        .map((line) =>
          this.encodeEntry(this.createEntry(line.replace(/\r$/, ''), stream)),
        )
        .join('');

      if (encoded) {
        await fs.appendFile(this.getRunnerLogPath(runnerId), encoded, 'utf8');
      }
    });
  }

  async finalizeRunner(runnerId: string): Promise<void> {
    await this.waitForPendingWrites(runnerId);

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

    if (pendingEntries.length === 0) {
      return;
    }

    await this.enqueueWrite(runnerId, async () => {
      await this.ensureRunnerDir(runnerId);
      const payload = pendingEntries
        .map((entry) => this.encodeEntry(entry))
        .join('');
      if (payload) {
        await fs.appendFile(this.getRunnerLogPath(runnerId), payload, 'utf8');
      }
    });
  }

  async deleteRunnerLogs(runnerId: string): Promise<void> {
    await this.waitForPendingWrites(runnerId);
    this.writeQueues.delete(runnerId);
    this.clearRunnerBuffers(runnerId);
    await fs.rm(this.getRunnerDir(runnerId), { recursive: true, force: true });
  }

  async listLogs(params: {
    runnerId: string;
    cursor?: string;
    take?: number | string;
    search?: string;
    levels?: string[];
    sortOrder?: 'asc' | 'desc';
    streams?: string[];
  }): Promise<RunnerLogsResponseDto> {
    const take = this.resolveTake(params.take);
    const sortOrder = params.sortOrder === 'desc' ? 'desc' : 'asc';
    const searchLower = params.search?.trim().toLowerCase() ?? '';
    const levelFilter = new Set(
      (params.levels ?? []).map((l) => l.toUpperCase()),
    );
    const streamFilter = new Set(params.streams ?? []);

    const logPath = this.getRunnerLogPath(params.runnerId);
    const stats = await this.safeStat(logPath);

    if (!stats) {
      return this.emptyResponse(params.runnerId, take);
    }

    if (sortOrder === 'desc') {
      return this.listLogsDesc(
        params.runnerId,
        logPath,
        take,
        this.parseIndexCursor(params.cursor),
        searchLower,
        levelFilter,
        streamFilter,
      );
    }

    return this.listLogsAsc(
      params.runnerId,
      logPath,
      stats,
      take,
      this.parseByteCursor(params.cursor),
      searchLower,
      levelFilter,
      streamFilter,
    );
  }

  // ── asc (oldest-first, byte-cursor pagination) ────────────────────────────

  private async listLogsAsc(
    runnerId: string,
    logPath: string,
    stats: Stats,
    take: number,
    cursor: number,
    searchLower: string,
    levelFilter: Set<string>,
    streamFilter: Set<string>,
  ): Promise<RunnerLogsResponseDto> {
    if (cursor >= stats.size) {
      return this.emptyResponse(runnerId, take, String(cursor));
    }

    const fileSize = stats.size;
    const entries: RunnerLogEntryDto[] = [];
    let currentOffset = cursor;
    let remainder = '';

    const readable = createReadStream(logPath, {
      encoding: 'utf8',
      start: cursor,
    });

    outer: for await (const chunk of readable) {
      remainder += chunk;

      while (true) {
        const newlineIndex = remainder.indexOf('\n');
        if (newlineIndex === -1) break;

        const rawLine = remainder.slice(0, newlineIndex);
        remainder = remainder.slice(newlineIndex + 1);

        const lineOffset = currentOffset;
        currentOffset += Buffer.byteLength(rawLine, 'utf8') + 1;

        if (!rawLine) continue;

        const entry = this.decodeEntry(rawLine, lineOffset);
        if (this.matchesFilter(entry, searchLower, levelFilter, streamFilter)) {
          entries.push(entry);
          if (entries.length >= take) break outer;
        }
      }
    }

    if (entries.length < take && remainder) {
      const lineOffset = currentOffset;
      currentOffset = stats.size;
      const entry = this.decodeEntry(remainder, lineOffset);
      if (this.matchesFilter(entry, searchLower, levelFilter, streamFilter)) {
        entries.push(entry);
      }
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

  // ── desc (newest-first, index-cursor pagination) ──────────────────────────

  private async listLogsDesc(
    runnerId: string,
    logPath: string,
    take: number,
    skip: number,
    searchLower: string,
    levelFilter: Set<string>,
    streamFilter: Set<string>,
  ): Promise<RunnerLogsResponseDto> {
    const allEntries = await this.readAllEntries(logPath);
    const filtered = allEntries.filter((e) =>
      this.matchesFilter(e, searchLower, levelFilter, streamFilter),
    );
    filtered.reverse();

    const page = filtered.slice(skip, skip + take);
    const nextSkip = skip + take;
    const hasMore = nextSkip < filtered.length;

    return {
      runnerId,
      entries: page,
      nextCursor: hasMore ? `i:${nextSkip}` : null,
      cursor: `i:${nextSkip}`,
      hasMore,
      take,
    };
  }

  private async readAllEntries(logPath: string): Promise<RunnerLogEntryDto[]> {
    const entries: RunnerLogEntryDto[] = [];
    let remainder = '';
    let currentOffset = 0;

    const readable = createReadStream(logPath, { encoding: 'utf8' });

    for await (const chunk of readable) {
      remainder += chunk;

      while (true) {
        const newlineIndex = remainder.indexOf('\n');
        if (newlineIndex === -1) break;

        const rawLine = remainder.slice(0, newlineIndex);
        remainder = remainder.slice(newlineIndex + 1);

        const lineOffset = currentOffset;
        currentOffset += Buffer.byteLength(rawLine, 'utf8') + 1;

        if (!rawLine) continue;
        entries.push(this.decodeEntry(rawLine, lineOffset));
      }
    }

    if (remainder) {
      entries.push(this.decodeEntry(remainder, currentOffset));
    }

    return entries;
  }

  // ── filtering ─────────────────────────────────────────────────────────────

  private matchesFilter(
    entry: RunnerLogEntryDto,
    searchLower: string,
    levelFilter: Set<string>,
    streamFilter: Set<string>,
  ): boolean {
    if (searchLower && !entry.message.toLowerCase().includes(searchLower)) {
      return false;
    }
    if (levelFilter.size > 0 && !levelFilter.has(entry.level)) {
      return false;
    }
    if (streamFilter.size > 0 && !streamFilter.has(entry.stream)) {
      return false;
    }
    return true;
  }

  // ── level inference ───────────────────────────────────────────────────────

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

  // ── encoding / decoding ───────────────────────────────────────────────────

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
      const rawMessage =
        typeof parsed.message === 'string'
          ? parsed.message
          : JSON.stringify(parsed);
      const structured = this.tryParseJson(rawMessage);
      const message = this.inferDisplayMessage(structured, rawMessage);
      const level = this.inferLevel(stream, rawMessage);
      return { cursor: String(offset), timestamp, stream, message, level };
    } catch {
      return {
        cursor: String(offset),
        timestamp: null,
        stream: 'combined',
        message: rawLine,
        level: 'UNKNOWN',
      };
    }
  }

  private normalizeStream(value: unknown): RunnerLogStream {
    if (value === 'stderr' || value === 'stdout' || value === 'combined') {
      return value;
    }
    return 'combined';
  }

  // ── cursor helpers ────────────────────────────────────────────────────────

  private parseByteCursor(cursor?: string): number {
    if (!cursor || cursor.startsWith('i:')) return 0;
    const parsed = Number.parseInt(cursor, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private parseIndexCursor(cursor?: string): number {
    if (!cursor) return 0;
    if (cursor.startsWith('i:')) {
      const n = Number.parseInt(cursor.slice(2), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return 0;
  }

  private resolveTake(take?: number | string): number {
    const numeric =
      typeof take === 'string' ? Number.parseInt(take, 10) : Number(take);
    const resolved = Number.isFinite(numeric) ? numeric : 200;
    return Math.max(1, Math.min(1000, Math.trunc(resolved)));
  }

  private emptyResponse(
    runnerId: string,
    take: number,
    cursor = '0',
  ): RunnerLogsResponseDto {
    return {
      runnerId,
      entries: [],
      nextCursor: null,
      cursor,
      hasMore: false,
      take,
    };
  }

  // ── filesystem helpers ────────────────────────────────────────────────────

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
      if (key.startsWith(`${runnerId}:`)) {
        this.lineBuffers.delete(key);
      }
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
