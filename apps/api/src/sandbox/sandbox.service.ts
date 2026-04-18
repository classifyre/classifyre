import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { PrismaService } from '../prisma.service';
import {
  AssetContentType,
  DetectorType,
  Prisma,
  SandboxRunStatus,
} from '@prisma/client';
import {
  QuerySandboxRunsDto,
  SandboxRunsSortBy,
  SandboxRunsSortOrder,
} from './dto/query-sandbox-runs.dto';
import { KubernetesCliJobService } from '../cli-runner/kubernetes-cli-job.service';
import { SandboxFileStorageService } from './sandbox-file-storage.service';

const TABULAR_MIME_TYPES = new Set([
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/parquet',
  'application/vnd.apache.parquet',
]);

/** Map a MIME type string to the internal AssetContentType enum. */
function mimeToContentType(mime: string): AssetContentType {
  const normalizedMime = mime.split(';', 1)[0].trim().toLowerCase();
  if (normalizedMime.startsWith('image/')) return AssetContentType.IMAGE;
  if (normalizedMime.startsWith('video/')) return AssetContentType.VIDEO;
  if (normalizedMime.startsWith('audio/')) return AssetContentType.AUDIO;
  if (TABULAR_MIME_TYPES.has(normalizedMime)) return AssetContentType.TABLE;
  if (
    normalizedMime === 'text/html' ||
    normalizedMime === 'application/xhtml+xml'
  )
    return AssetContentType.TXT;
  if (
    normalizedMime === 'text/plain' ||
    normalizedMime === 'text/markdown' ||
    normalizedMime === 'application/json' ||
    normalizedMime === 'application/xml' ||
    normalizedMime === 'text/xml'
  )
    return AssetContentType.TXT;
  if (normalizedMime === 'application/octet-stream')
    return AssetContentType.BINARY;
  // Office formats, PDFs, archives, etc. → BINARY
  if (
    normalizedMime.startsWith('application/vnd.') ||
    normalizedMime === 'application/pdf' ||
    normalizedMime === 'application/zip' ||
    normalizedMime === 'application/x-tar' ||
    normalizedMime.startsWith('application/x-')
  )
    return AssetContentType.BINARY;
  return AssetContentType.OTHER;
}

function normalizeSandboxFindings(findings: unknown[]): unknown[] {
  return findings.map((finding) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      return finding;
    }
    const entry = { ...(finding as Record<string, unknown>) };
    if (typeof entry.category === 'string') {
      entry.category = entry.category.toLowerCase();
    }
    return entry;
  });
}

function sanitizeStringForPostgresJson(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    const current = value.charCodeAt(i);

    // PostgreSQL JSONB rejects NUL and non-whitespace C0 controls.
    if (current === 0x00) {
      continue;
    }
    if (
      current < 0x20 &&
      current !== 0x09 &&
      current !== 0x0a &&
      current !== 0x0d
    ) {
      continue;
    }

    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[i] + value[i + 1];
        i += 1;
      } else {
        result += '\uFFFD';
      }
      continue;
    }

    if (current >= 0xdc00 && current <= 0xdfff) {
      result += '\uFFFD';
      continue;
    }

    result += value[i];
  }

  return result;
}

function sanitizeForPostgresJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeStringForPostgresJson(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPostgresJson(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      sanitized[key] = sanitizeForPostgresJson(item);
    }
    return sanitized;
  }
  return value;
}

function inferMimeTypeFromFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const byExtension: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.parquet': 'application/parquet',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.doc': 'application/msword',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  return byExtension[extension] ?? 'application/octet-stream';
}

function normalizeDetectedMimeType(
  detectedMimeType: string,
  fileName: string,
): string {
  const mime = detectedMimeType.split(';', 1)[0].trim().toLowerCase();
  const inferredMime = inferMimeTypeFromFileName(fileName);
  if (!mime || mime === 'application/octet-stream') {
    return inferredMime;
  }
  if (mime === 'text/plain' && TABULAR_MIME_TYPES.has(inferredMime)) {
    return inferredMime;
  }
  return mime;
}

type SandboxCliResult = {
  mime_type: string;
  findings: unknown[];
};

function sanitizeUnsupportedUnicodeEscapes(text: string): string {
  return text
    .replace(/\\U[0-9a-fA-F]{8}/g, '\\uFFFD')
    .replace(/\\u[dD][89a-fA-F][0-9a-fA-F]{2}/g, '\\uFFFD');
}

function parseSandboxCliOutput(stdout: string): SandboxCliResult {
  const raw = stdout.trim();
  if (!raw) {
    throw new Error('Sandbox CLI returned empty output');
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastJsonLine =
    [...lines].reverse().find((line) => line.startsWith('{')) ?? raw;
  const candidates = [raw, lastJsonLine];

  let lastError: unknown;
  for (const candidate of candidates) {
    for (const payload of [
      candidate,
      sanitizeUnsupportedUnicodeEscapes(candidate),
    ]) {
      try {
        const parsed = JSON.parse(payload) as SandboxCliResult;
        if (
          typeof parsed.mime_type === 'string' &&
          Array.isArray(parsed.findings)
        ) {
          return parsed;
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError instanceof Error) {
    throw new Error(
      `Failed to parse sandbox CLI JSON output: ${lastError.message}`,
    );
  }
  throw new Error('Failed to parse sandbox CLI JSON output');
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toDetectorType(value: string): DetectorType | null {
  const upper = value.toUpperCase();
  const valid = Object.values(DetectorType);
  return valid.includes(upper as DetectorType) ? (upper as DetectorType) : null;
}

function extractDetectorTypesFromRun(run: {
  detectors: unknown;
  findings: unknown;
}): Set<DetectorType> {
  const detectorTypes = new Set<DetectorType>();

  if (Array.isArray(run.detectors)) {
    for (const item of run.detectors) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rawType = (item as { type?: unknown }).type;
      if (typeof rawType !== 'string') continue;
      const detectorType = toDetectorType(rawType);
      if (detectorType) detectorTypes.add(detectorType);
    }
  }

  if (Array.isArray(run.findings)) {
    for (const item of run.findings) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rawType = (item as { detector_type?: unknown }).detector_type;
      if (typeof rawType !== 'string') continue;
      const detectorType = toDetectorType(rawType);
      if (detectorType) detectorTypes.add(detectorType);
    }
  }

  return detectorTypes;
}

function getFindingsCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function compareNullableNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  const left = typeof a === 'number' ? a : Number.NEGATIVE_INFINITY;
  const right = typeof b === 'number' ? b : Number.NEGATIVE_INFINITY;
  return left - right;
}

function sortRunsInMemory(
  runs: Prisma.SandboxRunGetPayload<Record<string, never>>[],
  sortBy: SandboxRunsSortBy,
  sortOrder: SandboxRunsSortOrder,
): Prisma.SandboxRunGetPayload<Record<string, never>>[] {
  const direction = sortOrder === SandboxRunsSortOrder.ASC ? 1 : -1;
  const sorted = [...runs].sort((a, b) => {
    switch (sortBy) {
      case SandboxRunsSortBy.FILE_NAME:
        return a.fileName.localeCompare(b.fileName);
      case SandboxRunsSortBy.STATUS:
        return a.status.localeCompare(b.status);
      case SandboxRunsSortBy.FILE_SIZE_BYTES:
        return a.fileSizeBytes - b.fileSizeBytes;
      case SandboxRunsSortBy.DURATION_MS:
        return compareNullableNumbers(a.durationMs, b.durationMs);
      case SandboxRunsSortBy.FINDINGS_COUNT:
        return getFindingsCount(a.findings) - getFindingsCount(b.findings);
      case SandboxRunsSortBy.CREATED_AT:
      default:
        return a.createdAt.getTime() - b.createdAt.getTime();
    }
  });

  return direction === 1 ? sorted : sorted.reverse();
}

function toPrismaOrderBy(
  sortBy: SandboxRunsSortBy,
  sortOrder: SandboxRunsSortOrder,
): Prisma.SandboxRunOrderByWithRelationInput | null {
  const order = sortOrder.toLowerCase() as Prisma.SortOrder;
  switch (sortBy) {
    case SandboxRunsSortBy.FILE_NAME:
      return { fileName: order };
    case SandboxRunsSortBy.STATUS:
      return { status: order };
    case SandboxRunsSortBy.FILE_SIZE_BYTES:
      return { fileSizeBytes: order };
    case SandboxRunsSortBy.DURATION_MS:
      return { durationMs: order };
    case SandboxRunsSortBy.CREATED_AT:
      return { createdAt: order };
    case SandboxRunsSortBy.FINDINGS_COUNT:
    default:
      return null;
  }
}

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);
  /** Tracks in-flight CLI processes so they can be killed on delete. */
  private readonly activeProcesses = new Map<string, ChildProcess>();

  constructor(
    private prisma: PrismaService,
    private sandboxFileStorage: SandboxFileStorageService,
    @Optional()
    private kubernetesCliJobService?: KubernetesCliJobService,
  ) {}

  async createRun(
    fileBuffer: Buffer,
    fileName: string,
    detectors: unknown[],
    options?: { skipDuplicateCheck?: boolean },
  ) {
    this.validateDetectors(detectors);

    const fileExtension = path.extname(fileName);
    const fileSizeBytes = fileBuffer.length;

    // Duplicate detection: reject if another non-error run has the same file content.
    let contentHash: string | undefined;
    let s3Key: string | undefined;

    if (this.sandboxFileStorage.isEnabled) {
      contentHash = this.sandboxFileStorage.computeHash(fileBuffer);

      if (!options?.skipDuplicateCheck) {
        const existing = await this.prisma.sandboxRun.findFirst({
          where: {
            contentHash,
            status: { not: SandboxRunStatus.ERROR },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existing) {
          throw new ConflictException({
            message: 'A run with the same file content already exists.',
            existingRunId: existing.id,
          });
        }
      }

      const uploaded = await this.sandboxFileStorage.uploadFile(
        fileBuffer,
        fileExtension,
      );
      s3Key = uploaded.s3Key;
      contentHash = uploaded.contentHash;
    }

    // Create DB record with PENDING status
    const run = await this.prisma.sandboxRun.create({
      data: {
        fileName,
        fileType: '',
        fileExtension,
        fileSizeBytes,
        detectors: detectors as any,
        status: SandboxRunStatus.PENDING,
        s3Key: s3Key ?? null,
        contentHash: contentHash ?? null,
      },
    });

    void this.processRun(
      run.id,
      fileBuffer,
      fileName,
      fileExtension,
      detectors,
    );

    return run;
  }

  /**
   * Re-run an existing completed (or errored) sandbox run with a different
   * set of detectors. Requires S3 to be enabled so the original file can be
   * retrieved. Creates a brand-new SandboxRun record that shares the same
   * S3 object (content-addressed key).
   */
  async rerunRun(originalRunId: string, detectors: unknown[]) {
    this.validateDetectors(detectors);

    const original = await this.prisma.sandboxRun.findUnique({
      where: { id: originalRunId },
    });
    if (!original) {
      throw new NotFoundException(`Sandbox run ${originalRunId} not found`);
    }
    if (
      original.status === SandboxRunStatus.PENDING ||
      original.status === SandboxRunStatus.RUNNING
    ) {
      throw new BadRequestException(
        'Cannot rerun a run that is still in progress',
      );
    }
    if (!original.s3Key || !this.sandboxFileStorage.isEnabled) {
      throw new BadRequestException(
        'Rerun requires S3 storage to be configured and the original run to have an uploaded file',
      );
    }

    const fileBuffer = await this.sandboxFileStorage.downloadFile(
      original.s3Key,
    );

    const run = await this.prisma.sandboxRun.create({
      data: {
        fileName: original.fileName,
        fileType: '',
        fileExtension: original.fileExtension,
        fileSizeBytes: original.fileSizeBytes,
        detectors: detectors as any,
        status: SandboxRunStatus.PENDING,
        s3Key: original.s3Key,
        contentHash: original.contentHash,
      },
    });

    void this.processRun(
      run.id,
      fileBuffer,
      original.fileName,
      original.fileExtension,
      detectors,
    );

    return run;
  }

  private validateDetectors(detectors: unknown[]): void {
    const validTypes = new Set<string>(Object.values(DetectorType));
    for (const detector of detectors) {
      const item = detector as Record<string, unknown>;
      const rawType = typeof item.type === 'string' ? item.type : '';
      const type = rawType.toUpperCase();
      if (!validTypes.has(type)) {
        throw new BadRequestException(
          `Invalid detector type: "${rawType}". Must be one of: ${[...validTypes].join(', ')}`,
        );
      }
      if (
        item.config !== undefined &&
        (typeof item.config !== 'object' || Array.isArray(item.config))
      ) {
        throw new BadRequestException(
          `Detector config for "${type}" must be an object`,
        );
      }
    }
  }

  private async processRun(
    runId: string,
    fileBuffer: Buffer,
    fileName: string,
    fileExtension: string,
    detectors: unknown[],
  ): Promise<void> {
    const startTime = Date.now();
    const usesKubernetesJobs =
      this.kubernetesCliJobService?.isEnabled() ?? false;
    const tmpDir = usesKubernetesJobs
      ? this.getSandboxSharedDir(runId)
      : process.env.TEMP_DIR || '/tmp';
    const tempFilePath = path.join(
      tmpDir,
      usesKubernetesJobs
        ? `input${fileExtension}`
        : `sandbox-${runId}-${startTime}${fileExtension}`,
    );
    const detectorsFile = path.join(
      tmpDir,
      usesKubernetesJobs ? 'detectors.json' : `sandbox-detectors-${runId}.json`,
    );

    try {
      // Mark as RUNNING
      await this.prisma.sandboxRun.update({
        where: { id: runId },
        data: { status: SandboxRunStatus.RUNNING },
      });

      // Write temp files
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(tempFilePath, fileBuffer);
      const expandedDetectors = await this.expandCustomDetectors(detectors);
      await fs.writeFile(
        detectorsFile,
        JSON.stringify(expandedDetectors, null, 2),
      );

      // Execute CLI
      const { stdout, exitCode } = usesKubernetesJobs
        ? await this.executeSandboxJob(runId, tempFilePath, detectorsFile)
        : await this.executeSandboxLocally(runId, tempFilePath, detectorsFile);

      if (exitCode !== 0) {
        throw new Error(`CLI exited with code ${exitCode}: ${stdout}`);
      }

      const result = parseSandboxCliOutput(stdout);
      const normalizedFindings = normalizeSandboxFindings(result.findings);
      const sanitizedFindings = sanitizeForPostgresJson(
        normalizedFindings,
      ) as unknown[];
      const normalizedMimeType = normalizeDetectedMimeType(
        typeof result.mime_type === 'string' ? result.mime_type : '',
        fileName,
      );

      const durationMs = Date.now() - startTime;

      await this.prisma.sandboxRun.update({
        where: { id: runId },
        data: {
          status: SandboxRunStatus.COMPLETED,
          fileType: normalizedMimeType,
          contentType: mimeToContentType(normalizedMimeType),
          findings: sanitizedFindings as any,
          durationMs,
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Sandbox run ${runId} failed: ${errorMessage}`);

      await this.prisma.sandboxRun
        .update({
          where: { id: runId },
          data: {
            status: SandboxRunStatus.ERROR,
            errorMessage,
            durationMs: Date.now() - startTime,
          },
        })
        .catch(() => undefined);
    } finally {
      if (usesKubernetesJobs) {
        await fs
          .rm(tmpDir, { recursive: true, force: true })
          .catch(() => undefined);
      } else {
        await fs.unlink(tempFilePath).catch(() => undefined);
        await fs.unlink(detectorsFile).catch(() => undefined);
      }
    }
  }

  async listRuns(query: QuerySandboxRunsDto) {
    const skip =
      typeof query.skip === 'string'
        ? parseInt(query.skip, 10)
        : (query.skip ?? 0);
    const limit =
      typeof query.limit === 'string'
        ? parseInt(query.limit, 10)
        : (query.limit ?? 50);

    const sortBy = query.sortBy ?? SandboxRunsSortBy.CREATED_AT;
    const sortOrder = query.sortOrder ?? SandboxRunsSortOrder.DESC;
    const statusFilters = asStringArray(query.status).filter((value) =>
      Object.values(SandboxRunStatus).includes(value as SandboxRunStatus),
    ) as SandboxRunStatus[];
    const contentTypeFilters = asStringArray(query.contentType).filter(
      (value) =>
        Object.values(AssetContentType).includes(value as AssetContentType),
    ) as AssetContentType[];
    const detectorFilterValues = asStringArray(query.detectorType);
    const detectorFilters = detectorFilterValues
      .map(toDetectorType)
      .filter((value): value is DetectorType => value !== null);

    const where: Prisma.SandboxRunWhereInput = {
      ...(query.search
        ? {
            OR: [
              {
                fileName: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                fileType: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(statusFilters.length > 0 ? { status: { in: statusFilters } } : {}),
      ...(contentTypeFilters.length > 0
        ? { contentType: { in: contentTypeFilters } }
        : {}),
    };

    const requiresInMemoryFiltering =
      detectorFilters.length > 0 ||
      typeof query.hasFindings === 'boolean' ||
      sortBy === SandboxRunsSortBy.FINDINGS_COUNT;

    if (!requiresInMemoryFiltering) {
      const orderBy = toPrismaOrderBy(sortBy, sortOrder) ?? {
        createdAt: 'desc',
      };

      const [items, total] = await this.prisma.$transaction([
        this.prisma.sandboxRun.findMany({
          where,
          orderBy,
          skip,
          take: limit,
        }),
        this.prisma.sandboxRun.count({ where }),
      ]);

      return { items, total, skip, limit };
    }

    const runs = await this.prisma.sandboxRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const filtered = runs.filter((run) => {
      if (typeof query.hasFindings === 'boolean') {
        const hasFindings = getFindingsCount(run.findings) > 0;
        if (hasFindings !== query.hasFindings) return false;
      }

      if (detectorFilters.length > 0) {
        const runDetectors = extractDetectorTypesFromRun(run);
        const matched = detectorFilters.some((detector) =>
          runDetectors.has(detector),
        );
        if (!matched) return false;
      }

      return true;
    });

    const sorted = sortRunsInMemory(filtered, sortBy, sortOrder);
    const total = sorted.length;
    const items = sorted.slice(skip, skip + limit);

    return { items, total, skip, limit };
  }

  async getRun(id: string) {
    const run = await this.prisma.sandboxRun.findUnique({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Sandbox run ${id} not found`);
    }
    return run;
  }

  async deleteRun(id: string): Promise<void> {
    const run = await this.prisma.sandboxRun.findUnique({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Sandbox run ${id} not found`);
    }

    // Kill the process if it's still running
    const child = this.activeProcesses.get(id);
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {
        // process may have already exited
      }
      this.activeProcesses.delete(id);
    }

    await this.kubernetesCliJobService
      ?.stopSandboxJob(id)
      .catch(() => undefined);
    await fs
      .rm(this.getSandboxSharedDir(id), { recursive: true, force: true })
      .catch(() => undefined);

    await this.prisma.sandboxRun.delete({ where: { id } });

    // Delete S3 file only if no other run references the same content hash
    if (run.s3Key && run.contentHash && this.sandboxFileStorage.isEnabled) {
      const otherRefCount = await this.prisma.sandboxRun.count({
        where: { contentHash: run.contentHash },
      });
      await this.sandboxFileStorage.deleteFile(run.s3Key, otherRefCount);
    }
  }

  private async executeSandboxJob(
    runId: string,
    inputFilePath: string,
    detectorsFilePath: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.kubernetesCliJobService?.isEnabled()) {
      throw new Error('Kubernetes CLI job service is not enabled');
    }

    const result = await this.kubernetesCliJobService.runSandboxJob({
      runId,
      inputFilePath,
      detectorsFilePath,
    });

    return {
      stdout: result.output,
      stderr: '',
      exitCode: result.exitCode,
    };
  }

  private async executeSandboxLocally(
    runId: string,
    tempFilePath: string,
    detectorsFile: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const environment = process.env.ENVIRONMENT || 'development';
    const cliPath = this.getCliPath(environment);
    const venvPath = path.join(cliPath, '.venv');

    const escapedCliPath = this.shellEscape(cliPath);
    const escapedVenvPython = this.shellEscape(
      path.join(venvPath, 'bin/python'),
    );
    const command =
      `cd ${escapedCliPath} && ` +
      `uv run --locked --python ${escapedVenvPython} ` +
      `python -m src.main sandbox ${this.shellEscape(tempFilePath)} --detectors-file ${this.shellEscape(detectorsFile)}`;

    return this.executeCliSync(command, runId);
  }

  private getCliPath(environment: string): string {
    const configuredPath = process.env.CLI_PATH;
    const defaultDevelopmentCliPath = path.join(__dirname, '../../../cli');
    const defaultDockerCliPath = '/app/cli';

    const resolveCliPath = (rawPath: string): string => {
      if (path.isAbsolute(rawPath)) {
        return path.normalize(rawPath);
      }

      // Support CLI_PATH like "../cli" from apps/api/.env regardless of process cwd.
      const apiAppRoot = path.resolve(__dirname, '../..');
      const apiRelative = path.resolve(apiAppRoot, rawPath);
      const cwdRelative = path.resolve(process.cwd(), rawPath);

      if (fsSync.existsSync(apiRelative)) {
        return apiRelative;
      }
      if (fsSync.existsSync(cwdRelative)) {
        return cwdRelative;
      }

      return apiRelative;
    };

    switch (environment) {
      case 'development':
        return resolveCliPath(configuredPath || defaultDevelopmentCliPath);
      case 'docker':
        return resolveCliPath(configuredPath || defaultDockerCliPath);
      default:
        return resolveCliPath(configuredPath || defaultDevelopmentCliPath);
    }
  }

  /**
   * For CUSTOM type detectors the caller supplies only `custom_detector_key`
   * (and optionally `config: {}`). The CLI's CustomDetectorConfig requires
   * `custom_detector_key`, `name`, and `method` inside the `config` dict.
   * This method looks up each CUSTOM detector from the database and merges the
   * required fields into `config` so the CLI can validate it correctly.
   */
  private async expandCustomDetectors(
    detectors: unknown[],
  ): Promise<unknown[]> {
    const keys: string[] = [];
    for (const d of detectors) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
      const item = d as Record<string, unknown>;
      const type = typeof item.type === 'string' ? item.type.toUpperCase() : '';
      const key =
        typeof item.custom_detector_key === 'string'
          ? item.custom_detector_key
          : '';
      if (type === 'CUSTOM' && key) keys.push(key);
    }

    if (keys.length === 0) return detectors;

    const records = await this.prisma.customDetector.findMany({
      where: { key: { in: keys } },
      select: { key: true, name: true, method: true, config: true },
    });

    const byKey = new Map(records.map((r) => [r.key, r]));

    return detectors.map((d) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
      const item = d as Record<string, unknown>;
      const type = typeof item.type === 'string' ? item.type.toUpperCase() : '';
      const detectorKey =
        typeof item.custom_detector_key === 'string'
          ? item.custom_detector_key
          : '';

      if (type !== 'CUSTOM' || !detectorKey) return d;

      const record = byKey.get(detectorKey);
      if (!record) {
        this.logger.warn(
          `Custom detector key "${detectorKey}" not found in database; skipping expansion`,
        );
        return d;
      }

      const existingConfig =
        item.config &&
        typeof item.config === 'object' &&
        !Array.isArray(item.config)
          ? (item.config as Record<string, unknown>)
          : {};

      return {
        ...item,
        config: {
          ...(record.config as Record<string, unknown>),
          // caller-supplied overrides DB defaults, but identity fields are pinned
          ...existingConfig,
          // identity fields always come from DB to ensure correctness
          custom_detector_key: record.key,
          name: record.name,
          method: record.method,
        },
      };
    });
  }

  private getSandboxSharedDir(runId: string): string {
    const rootDir = path.resolve(
      process.env.RUNNER_LOGS_DIR ||
        path.join(process.cwd(), 'var', 'runner-logs'),
    );
    return path.join(rootDir, 'sandbox-runs', runId);
  }

  private shellEscape(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  private executeCliSync(
    command: string,
    runId: string,
    timeoutMs = 300_000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const configuredTimeoutMs = Number(process.env.SANDBOX_CLI_TIMEOUT_MS);
      const effectiveTimeoutMs =
        Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
          ? configuredTimeoutMs
          : timeoutMs;
      const child = spawn(command, { shell: true, env: { ...process.env } });
      this.activeProcesses.set(runId, child);

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error(`CLI command timed out after ${effectiveTimeoutMs}ms`),
        );
      }, effectiveTimeoutMs);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.logger.debug(`[sandbox CLI] ${chunk.trim()}`);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(runId);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(runId);
        reject(err);
      });
    });
  }
}
