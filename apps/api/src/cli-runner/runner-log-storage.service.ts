import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import { createReadStream, type Stats } from 'fs';
import * as path from 'path';
import { RunnerLogEntryDto, RunnerLogsResponseDto } from './dto';

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
  }): Promise<RunnerLogsResponseDto> {
    const take = this.resolveTake(params.take);
    const cursor = this.parseCursor(params.cursor);
    const logPath = this.getRunnerLogPath(params.runnerId);
    const stats = await this.safeStat(logPath);

    if (!stats || cursor >= stats.size) {
      return {
        runnerId: params.runnerId,
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
        if (newlineIndex === -1) {
          break;
        }

        const rawLine = remainder.slice(0, newlineIndex);
        remainder = remainder.slice(newlineIndex + 1);

        const lineOffset = currentOffset;
        currentOffset += Buffer.byteLength(rawLine, 'utf8') + 1;

        if (!rawLine) {
          continue;
        }

        entries.push(this.decodeEntry(rawLine, lineOffset));
      }

      if (entries.length >= take) {
        break;
      }
    }

    if (entries.length < take && remainder) {
      const lineOffset = currentOffset;
      currentOffset = fileSize;
      entries.push(this.decodeEntry(remainder, lineOffset));
    }

    const hasMore = currentOffset < fileSize;
    return {
      runnerId: params.runnerId,
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
    return {
      timestamp: new Date().toISOString(),
      stream,
      message,
    };
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
      return {
        cursor: String(offset),
        timestamp,
        stream,
        message,
      };
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
    if (value === 'stderr' || value === 'stdout' || value === 'combined') {
      return value;
    }
    return 'combined';
  }

  private parseCursor(cursor?: string): number {
    if (!cursor) {
      return 0;
    }

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
      if (error?.code === 'ENOENT') {
        return null;
      }
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
