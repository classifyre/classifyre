import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomDetector,
  CustomDetectorTrainingRun,
  CustomDetectorTrainingStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from './prisma.service';
import { AiProviderConfigService } from './ai-provider-config.service';
import { stableStringify } from './utils/masked-config.utils';
import { resolveSchemaFile } from './utils/schema-path';
import { CreateCustomDetectorDto } from './dto/create-custom-detector.dto';
import { UpdateCustomDetectorDto } from './dto/update-custom-detector.dto';
import { TrainCustomDetectorDto } from './dto/train-custom-detector.dto';
import { ListCustomDetectorsQueryDto } from './dto/list-custom-detectors-query.dto';
import { CustomDetectorResponseDto } from './dto/custom-detector-response.dto';
import { CustomDetectorTrainingRunDto } from './dto/custom-detector-training-run.dto';
import { CustomDetectorExampleDto } from './dto/custom-detector-example.dto';
import {
  ParseTrainingExamplesResponseDto,
  ParsedTrainingExampleDto,
  ParseTrainingExamplesSkippedReasonsDto,
} from './dto/parse-training-examples-response.dto';
import {
  SaveTrainingExamplesDto,
  TrainingExampleDto,
  TrainingExamplesStatsDto,
} from './dto/training-example.dto';

type JsonRecord = Record<string, unknown>;
type DetectorUsageStats = {
  sourcesUsingCount: number;
  sourcesWithFindingsCount: number;
  recentSourceNames: string[];
  sourcesUsing: Array<{ id: string; name: string }>;
};

type ParsedTrainingExamplesDraft = {
  format: string;
  totalRows: number;
  skippedRows: number;
  warnings: string[];
  examples: ParsedTrainingExampleDto[];
  availableColumns?: string[];
  detectedLabelColumn?: string;
  detectedTextColumn?: string;
  skippedReasons?: ParseTrainingExamplesSkippedReasonsDto;
};

const TRAINING_FILE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const TRAINING_FILE_ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.tsv',
  '.txt',
  '.md',
  '.log',
  '.json',
]);
const TRAINING_LABEL_HEADERS = new Set([
  'label',
  'class',
  'category',
  'intent',
  'target',
]);
const TRAINING_TEXT_HEADERS = new Set([
  'text',
  'example',
  'content',
  'message',
  'sentence',
  'input',
  'email_text',
  'email_body',
  'body',
  'mail_text',
  'mail_body',
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeHeaderCell(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

@Injectable()
export class CustomDetectorsService {
  private readonly logger = new Logger(CustomDetectorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProviderConfigService: AiProviderConfigService,
  ) {}

  private parseDelimitedLine(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];

      if (char === '"') {
        const next = line[index + 1];
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim());
    return cells;
  }

  private parseCsvLikeContent(
    content: string,
    delimiter: ',' | '\t',
    format: 'csv' | 'tsv',
    opts: { labelColumn?: string; textColumn?: string } = {},
  ): ParsedTrainingExamplesDraft {
    const nonEmptyLines = content
      .split(/\r?\n/)
      .map((line, index) => ({
        value: line.trim(),
        lineNumber: index + 1,
      }))
      .filter((entry) => entry.value.length > 0);

    if (nonEmptyLines.length === 0) {
      return {
        format,
        totalRows: 0,
        skippedRows: 0,
        warnings: [],
        examples: [],
        skippedReasons: { missingLabel: 0, missingText: 0, duplicates: 0 },
      };
    }

    const parsedRows = nonEmptyLines.map((entry) => ({
      lineNumber: entry.lineNumber,
      cells: this.parseDelimitedLine(entry.value, delimiter),
    }));

    const warnings: string[] = [];
    let startIndex = 0;
    let labelIndex = 0;
    let textIndex = 1;
    const firstRowCells = parsedRows[0]?.cells ?? [];
    const firstRowHeaders = firstRowCells.map(normalizeHeaderCell);
    const availableColumns = firstRowCells.filter((h) => h.length > 0);

    const detectedLabelIndex = opts.labelColumn
      ? firstRowHeaders.findIndex(
          (h) => h === normalizeHeaderCell(opts.labelColumn!),
        )
      : firstRowHeaders.findIndex((header) =>
          TRAINING_LABEL_HEADERS.has(header),
        );
    const detectedTextIndex = opts.textColumn
      ? firstRowHeaders.findIndex(
          (h) => h === normalizeHeaderCell(opts.textColumn!),
        )
      : firstRowHeaders.findIndex((header) =>
          TRAINING_TEXT_HEADERS.has(header),
        );

    let detectedLabelColumn: string | undefined;
    let detectedTextColumn: string | undefined;

    if (detectedLabelIndex >= 0 && detectedTextIndex >= 0) {
      startIndex = 1;
      labelIndex = detectedLabelIndex;
      textIndex = detectedTextIndex;
      detectedLabelColumn = firstRowCells[labelIndex];
      detectedTextColumn = firstRowCells[textIndex];
      warnings.push('Detected header row and skipped it.');
    }

    const examples: ParsedTrainingExampleDto[] = [];
    let totalRows = 0;
    let skippedMissingLabel = 0;
    let skippedMissingText = 0;

    for (let index = startIndex; index < parsedRows.length; index += 1) {
      const row = parsedRows[index];
      if (!row) {
        continue;
      }

      totalRows += 1;
      const label = asString(row.cells[labelIndex]);
      const text = asString(row.cells[textIndex]);

      if (!label && !text) {
        skippedMissingLabel += 1;
        skippedMissingText += 1;
        continue;
      }
      if (!label) {
        skippedMissingLabel += 1;
        continue;
      }
      if (!text) {
        skippedMissingText += 1;
        continue;
      }

      examples.push({
        label,
        text,
        accepted: true,
        source: 'upload',
        lineNumber: row.lineNumber,
      });
    }

    const skippedRows = totalRows - examples.length;

    return {
      format,
      totalRows,
      skippedRows,
      warnings,
      examples,
      availableColumns:
        availableColumns.length > 0 ? availableColumns : undefined,
      detectedLabelColumn,
      detectedTextColumn,
      skippedReasons: {
        missingLabel: skippedMissingLabel,
        missingText: skippedMissingText,
        duplicates: 0,
      },
    };
  }

  private parsePlainTextContent(content: string): ParsedTrainingExamplesDraft {
    const lines = content
      .split(/\r?\n/)
      .map((line, index) => ({
        value: line.trim(),
        lineNumber: index + 1,
      }))
      .filter((entry) => entry.value.length > 0);

    const examples: ParsedTrainingExampleDto[] = [];
    const warnings: string[] = [];
    let totalRows = 0;
    let skippedRows = 0;
    let headerSkipped = false;

    for (const line of lines) {
      totalRows += 1;

      let label: string | null = null;
      let text: string | null = null;
      if (line.value.includes('|')) {
        const separatorIndex = line.value.indexOf('|');
        label = asString(line.value.slice(0, separatorIndex));
        text = asString(line.value.slice(separatorIndex + 1));
      } else if (line.value.includes('\t')) {
        const separatorIndex = line.value.indexOf('\t');
        label = asString(line.value.slice(0, separatorIndex));
        text = asString(line.value.slice(separatorIndex + 1));
      } else if (line.value.includes(',')) {
        const cells = this.parseDelimitedLine(line.value, ',');
        label = asString(cells[0]);
        text = asString(cells[1]);
      }

      if (!label || !text) {
        skippedRows += 1;
        continue;
      }

      const normalizedLabel = normalizeHeaderCell(label);
      const normalizedText = normalizeHeaderCell(text);
      if (
        !headerSkipped &&
        TRAINING_LABEL_HEADERS.has(normalizedLabel) &&
        TRAINING_TEXT_HEADERS.has(normalizedText)
      ) {
        skippedRows += 1;
        headerSkipped = true;
        warnings.push('Detected header row and skipped it.');
        continue;
      }

      examples.push({
        label,
        text,
        accepted: true,
        source: 'upload',
        lineNumber: line.lineNumber,
      });
    }

    return {
      format: 'txt',
      totalRows,
      skippedRows,
      warnings,
      examples,
    };
  }

  private parseJsonTrainingExamples(
    content: string,
  ): ParsedTrainingExamplesDraft {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new BadRequestException('JSON file could not be parsed.');
    }

    const asArray = Array.isArray(parsed)
      ? parsed
      : asRecord(parsed).training_examples;
    if (!Array.isArray(asArray)) {
      throw new BadRequestException(
        'JSON must be an array or include a training_examples array.',
      );
    }

    const examples: ParsedTrainingExampleDto[] = [];
    let skippedRows = 0;
    for (const item of asArray) {
      const row = asRecord(item);
      const label =
        asString(row.label) ??
        asString(row.class) ??
        asString(row.category) ??
        asString(row.intent);
      const text =
        asString(row.text) ??
        asString(row.example) ??
        asString(row.content) ??
        asString(row.message);

      if (!label || !text) {
        skippedRows += 1;
        continue;
      }

      examples.push({
        label,
        text,
        accepted: true,
        source: 'upload',
      });
    }

    return {
      format: 'json',
      totalRows: asArray.length,
      skippedRows,
      warnings: [],
      examples,
    };
  }

  private findTrainingHeaderIndex(
    headers: string[],
    knownHeaders: Set<string>,
  ) {
    return headers.findIndex((header) => {
      if (knownHeaders.has(header)) {
        return true;
      }

      const headerParts = header.split('_').filter((part) => part.length > 0);
      return headerParts.some((part) => knownHeaders.has(part));
    });
  }

  private dedupeTrainingExamples(examples: ParsedTrainingExampleDto[]): {
    deduped: ParsedTrainingExampleDto[];
    duplicateCount: number;
  } {
    const seen = new Set<string>();
    const deduped: ParsedTrainingExampleDto[] = [];
    let duplicateCount = 0;

    for (const example of examples) {
      const key = `${example.label.toLowerCase()}\u0000${example.text.toLowerCase()}`;
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(key);
      deduped.push(example);
    }

    return { deduped, duplicateCount };
  }

  parseTrainingExamplesUpload(
    fileBuffer: Buffer,
    fileName: string,
    opts: { labelColumn?: string; textColumn?: string } = {},
  ): ParseTrainingExamplesResponseDto {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty.');
    }

    if (fileBuffer.length > TRAINING_FILE_MAX_BYTES) {
      throw new BadRequestException(
        `Uploaded file is too large. Max size is ${Math.floor(TRAINING_FILE_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const extension = path.extname(fileName).toLowerCase();
    if (!TRAINING_FILE_ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        `Unsupported file type "${extension || 'unknown'}". Supported: ${Array.from(TRAINING_FILE_ALLOWED_EXTENSIONS).join(', ')}`,
      );
    }

    const content = fileBuffer.toString('utf8').replace(/^\uFEFF/, '');
    if (content.trim().length === 0) {
      throw new BadRequestException('Uploaded file has no parseable text.');
    }

    const parsed: ParsedTrainingExamplesDraft =
      extension === '.csv'
        ? this.parseCsvLikeContent(content, ',', 'csv', opts)
        : extension === '.tsv'
          ? this.parseCsvLikeContent(content, '\t', 'tsv', opts)
          : extension === '.json'
            ? this.parseJsonTrainingExamples(content)
            : this.parsePlainTextContent(content);

    const deduped = this.dedupeTrainingExamples(parsed.examples);
    const warnings = [...parsed.warnings];
    if (deduped.duplicateCount > 0) {
      warnings.push(
        `Dropped ${deduped.duplicateCount} duplicate example${deduped.duplicateCount === 1 ? '' : 's'}.`,
      );
    }

    if (deduped.deduped.length === 0) {
      throw new BadRequestException(
        'No valid training examples found. Expected rows in the form "label|text" or CSV columns for label/text.',
      );
    }

    const skippedReasons = parsed.skippedReasons
      ? { ...parsed.skippedReasons, duplicates: deduped.duplicateCount }
      : undefined;

    return {
      format: parsed.format,
      totalRows: parsed.totalRows,
      importedRows: deduped.deduped.length,
      skippedRows: parsed.skippedRows + deduped.duplicateCount,
      warnings,
      examples: deduped.deduped,
      availableColumns: parsed.availableColumns,
      detectedLabelColumn: parsed.detectedLabelColumn,
      detectedTextColumn: parsed.detectedTextColumn,
      skippedReasons,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private normalizeKey(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized.length > 0
      ? normalized
      : `cust_${randomUUID().slice(0, 8)}`;
  }

  private buildDefaultPipelineSchema(params: {
    key: string;
    name: string;
    description?: string | null;
  }): JsonRecord {
    const { key, name, description } = params;
    return {
      custom_detector_key: key,
      name,
      description: description ?? undefined,
      languages: ['de', 'en'],
      confidence_threshold: 0.7,
      max_findings: 100,
      pipeline_schema: {
        model: { name: 'fastino/gliner2-base-v1', path: null },
        entities: {},
        classification: {},
        validation: { confidence_threshold: 0.7, rules: [] },
      },
    };
  }

  private canonicalizePipelineSchema(input: {
    key: string;
    name: string;
    description?: string | null;
    pipelineSchema: Record<string, unknown>;
  }): JsonRecord {
    const incoming = input.pipelineSchema;
    const schemaType = (incoming.type as string | undefined) ?? 'GLINER2';

    // Transformer and LLM pipeline types store config directly in pipeline_schema —
    // don't merge GLINER2 defaults (entities/classification/validation) on top.
    if (
      CustomDetectorsService.TRANSFORMER_PIPELINE_TYPES.has(schemaType) ||
      schemaType === 'LLM'
    ) {
      const config: JsonRecord = {
        custom_detector_key: input.key,
        name: input.name,
        pipeline_schema: incoming,
      };
      if (input.description) config.description = input.description;
      return config;
    }

    const defaults = this.buildDefaultPipelineSchema(input);

    const config: JsonRecord = {
      ...defaults,
      custom_detector_key: input.key,
      name: input.name,
      description: input.description ?? undefined,
      pipeline_schema: {
        ...asRecord(defaults.pipeline_schema),
        ...asRecord(incoming),
      },
    };

    for (const [entryKey, entryValue] of Object.entries(config)) {
      if (entryValue === undefined) {
        delete config[entryKey];
      }
    }

    return config;
  }

  private static readonly TRANSFORMER_PIPELINE_TYPES = new Set([
    'TEXT_CLASSIFICATION',
    'IMAGE_CLASSIFICATION',
    'FEATURE_EXTRACTION',
    'OBJECT_DETECTION',
  ]);

  private validatePipelineSchema(schema: Record<string, unknown>): void {
    const schemaType = (schema.type as string | undefined) ?? 'GLINER2';
    const validTypes = [
      'GLINER2',
      'REGEX',
      'LLM',
      'TEXT_CLASSIFICATION',
      'IMAGE_CLASSIFICATION',
      'FEATURE_EXTRACTION',
      'OBJECT_DETECTION',
    ];
    if (!validTypes.includes(schemaType)) {
      throw new BadRequestException(
        `Unknown pipeline schema type '${schemaType}'. Must be one of: ${validTypes.join(', ')}`,
      );
    }

    if (schemaType === 'REGEX') {
      const hasPatterns =
        schema.patterns &&
        typeof schema.patterns === 'object' &&
        Object.keys(schema.patterns).length > 0;
      if (!hasPatterns) {
        throw new BadRequestException(
          'REGEX pipeline schema must define at least one pattern',
        );
      }
      return;
    }

    if (schemaType === 'LLM') {
      if (!schema.system_prompt || typeof schema.system_prompt !== 'string') {
        throw new BadRequestException(
          'LLM (AI) pipeline schema must define a system_prompt string',
        );
      }
      if (schema.provider_runtime !== undefined) {
        throw new BadRequestException(
          'provider_runtime is injected by the server and must not be supplied by clients',
        );
      }
      return;
    }

    // Transformer pipeline types — require a model (except IMAGE_CLASSIFICATION which has a default)
    if (CustomDetectorsService.TRANSFORMER_PIPELINE_TYPES.has(schemaType)) {
      if (
        schemaType !== 'IMAGE_CLASSIFICATION' &&
        (!schema.model || typeof schema.model !== 'string')
      ) {
        throw new BadRequestException(
          `${schemaType} pipeline schema must define a model`,
        );
      }
      return;
    }

    // GLINER2 — default
    const hasEntities =
      schema.entities &&
      typeof schema.entities === 'object' &&
      Object.keys(schema.entities).length > 0;
    const hasClassification =
      schema.classification &&
      typeof schema.classification === 'object' &&
      Object.keys(schema.classification).length > 0;

    if (!hasEntities && !hasClassification) {
      throw new BadRequestException(
        'Pipeline schema must define at least one entity or one classification task',
      );
    }
  }

  /**
   * Resolve the AI provider credential FK for a detector. LLM detectors require
   * a valid `aiProviderConfigId`; all other types must not carry one (returns null).
   */
  private async resolveAiProviderConfigId(
    pipelineSchema: Record<string, unknown>,
    requested: string | null | undefined,
  ): Promise<string | null> {
    const schemaType = (pipelineSchema.type as string | undefined) ?? 'GLINER2';
    if (schemaType !== 'LLM') {
      return null;
    }
    if (!requested || typeof requested !== 'string') {
      throw new BadRequestException(
        'LLM (AI) detectors require aiProviderConfigId referencing a configured AI provider credential',
      );
    }
    // Throws NotFoundException when the credential does not exist.
    await this.aiProviderConfigService.get(requested);
    return requested;
  }

  /**
   * For LLM detectors, resolve the configured provider credential (decrypting the
   * API key) and inject a runtime-only `provider_runtime` block into the pipeline
   * schema so the CLI worker can call the provider directly. No-op for other types.
   */
  private async injectLlmProviderRuntime(
    pipelineSchema: Record<string, unknown>,
    aiProviderConfigId: string | null,
  ): Promise<Record<string, unknown>> {
    const schemaType = (pipelineSchema.type as string | undefined) ?? 'GLINER2';
    if (schemaType !== 'LLM') {
      return pipelineSchema;
    }
    if (!aiProviderConfigId) {
      throw new BadRequestException(
        'LLM (AI) detector is missing an AI provider credential and cannot be dispatched',
      );
    }
    const runtime =
      await this.aiProviderConfigService.getRuntimeConfig(aiProviderConfigId);
    return {
      ...pipelineSchema,
      provider_runtime: {
        provider: runtime.provider,
        model: runtime.model,
        api_key: runtime.apiKey,
        base_url: runtime.baseUrl ?? null,
        context_size: runtime.contextSize ?? null,
        supports_vision: runtime.supportsVision ?? false,
      },
    };
  }

  private toTrainingRunDto(
    run: CustomDetectorTrainingRun,
  ): CustomDetectorTrainingRunDto {
    return {
      id: run.id,
      customDetectorId: run.customDetectorId,
      sourceId: run.sourceId,
      status: run.status,
      strategy: run.strategy,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      trainedExamples: run.trainedExamples,
      positiveExamples: run.positiveExamples,
      negativeExamples: run.negativeExamples,
      metrics: run.metrics as Record<string, unknown> | null,
      modelArtifactPath: run.modelArtifactPath,
      configHash: run.configHash,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private toResponse(
    detector: CustomDetector & {
      trainingRuns?: CustomDetectorTrainingRun[];
      _count?: { findings?: number };
    },
    usage?: DetectorUsageStats,
  ): CustomDetectorResponseDto {
    const latestRun = detector.trainingRuns?.[0] ?? null;
    return {
      id: detector.id,
      key: detector.key,
      name: detector.name,
      description: detector.description,
      pipelineSchema: asRecord((detector as any).pipelineSchema),
      aiProviderConfigId: (detector as any).aiProviderConfigId ?? null,
      isActive: detector.isActive,
      version: detector.version,
      lastTrainedAt: detector.lastTrainedAt,
      lastTrainingSummary: detector.lastTrainingSummary as Record<
        string,
        unknown
      > | null,
      latestTrainingRun: latestRun ? this.toTrainingRunDto(latestRun) : null,
      findingsCount: detector._count?.findings ?? 0,
      sourcesUsingCount: usage?.sourcesUsingCount ?? 0,
      sourcesWithFindingsCount: usage?.sourcesWithFindingsCount ?? 0,
      recentSourceNames: usage?.recentSourceNames ?? [],
      sourcesUsing: usage?.sourcesUsing ?? [],
      createdAt: detector.createdAt,
      updatedAt: detector.updatedAt,
    };
  }

  private async buildUsageStats(
    detectorIds: string[],
  ): Promise<Map<string, DetectorUsageStats>> {
    const map = new Map<string, DetectorUsageStats>();
    if (detectorIds.length === 0) {
      return map;
    }

    const detectorIdSql = detectorIds.map((id) => Prisma.sql`${id}`);

    const sourceUsageRows = await this.prisma.$queryRaw<
      Array<{
        detector_id: string;
        source_count: number;
        source_names: string[] | null;
        source_ids: string[] | null;
      }>
    >(Prisma.sql`
      WITH expanded AS (
        SELECT
          elem.value AS detector_id,
          s.id AS source_id,
          s.name AS source_name,
          s.updated_at AS updated_at
        FROM sources s
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.config->'custom_detectors', '[]'::jsonb)) AS elem(value)
        WHERE elem.value IN (${Prisma.join(detectorIdSql)})
      ),
      dedup AS (
        SELECT
          detector_id,
          source_id,
          MAX(source_name) AS source_name,
          MAX(updated_at) AS updated_at
        FROM expanded
        GROUP BY detector_id, source_id
      )
      SELECT
        detector_id,
        COUNT(*)::int AS source_count,
        ARRAY_AGG(source_name ORDER BY updated_at DESC) AS source_names,
        ARRAY_AGG(source_id::text ORDER BY updated_at DESC) AS source_ids
      FROM dedup
      GROUP BY detector_id
    `);

    for (const row of sourceUsageRows) {
      const names = Array.isArray(row.source_names) ? row.source_names : [];
      const ids = Array.isArray(row.source_ids) ? row.source_ids : [];
      const sourcesUsing = names.map((name, i) => ({ id: ids[i] ?? '', name }));
      map.set(row.detector_id, {
        sourcesUsingCount: Number(row.source_count ?? 0),
        sourcesWithFindingsCount: 0,
        recentSourceNames: names.slice(0, 5),
        sourcesUsing: sourcesUsing.slice(0, 5),
      });
    }

    const findingsUsageRows = await this.prisma.$queryRaw<
      Array<{ detector_id: string; sources_with_findings_count: number }>
    >(Prisma.sql`
      SELECT
        custom_detector_id AS detector_id,
        COUNT(DISTINCT source_id)::int AS sources_with_findings_count
      FROM findings
      WHERE custom_detector_id IN (${Prisma.join(detectorIdSql)})
      GROUP BY custom_detector_id
    `);

    for (const row of findingsUsageRows) {
      const existing = map.get(row.detector_id) ?? {
        sourcesUsingCount: 0,
        sourcesWithFindingsCount: 0,
        recentSourceNames: [],
        sourcesUsing: [],
      };
      map.set(row.detector_id, {
        ...existing,
        sourcesWithFindingsCount: Number(row.sources_with_findings_count ?? 0),
      });
    }

    return map;
  }

  async list(
    query: ListCustomDetectorsQueryDto,
  ): Promise<CustomDetectorResponseDto[]> {
    const includeInactive = query.includeInactive === true;
    const detectors = await this.prisma.customDetector.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: {
        trainingRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { findings: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const usageByDetector = await this.buildUsageStats(
      detectors.map((detector) => detector.id),
    );

    return detectors.map((detector) =>
      this.toResponse(detector, usageByDetector.get(detector.id)),
    );
  }

  async getById(id: string): Promise<CustomDetectorResponseDto> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id },
      include: {
        trainingRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { findings: true } },
      },
    });

    if (!detector) {
      throw new NotFoundException(`Custom detector with ID ${id} not found`);
    }

    const usageByDetector = await this.buildUsageStats([id]);
    return this.toResponse(detector, usageByDetector.get(id));
  }

  async create(
    dto: CreateCustomDetectorDto,
  ): Promise<CustomDetectorResponseDto> {
    const key = this.normalizeKey(dto.key ?? `cust_${dto.name}`);
    this.validatePipelineSchema(dto.pipelineSchema);
    const aiProviderConfigId = await this.resolveAiProviderConfigId(
      dto.pipelineSchema,
      dto.aiProviderConfigId,
    );

    let detector;
    try {
      detector = await this.prisma.customDetector.create({
        data: {
          key,
          name: dto.name,
          description: dto.description,
          pipelineSchema: dto.pipelineSchema as Prisma.InputJsonValue,
          aiProviderConfigId,
          isActive: dto.isActive ?? true,
        } as any,
        include: {
          trainingRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { findings: true } },
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          `Custom detector key already exists: ${key}`,
        );
      }
      throw error;
    }

    return this.toResponse(detector);
  }

  async update(
    id: string,
    dto: UpdateCustomDetectorDto,
  ): Promise<CustomDetectorResponseDto> {
    const existing = await this.prisma.customDetector.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Custom detector with ID ${id} not found`);
    }

    const nextKey = this.normalizeKey(dto.key ?? existing.key);
    const nextName = dto.name ?? existing.name;
    const nextDescription =
      dto.description !== undefined ? dto.description : existing.description;
    const nextPipelineSchema =
      dto.pipelineSchema !== undefined
        ? dto.pipelineSchema
        : (asRecord((existing as any).pipelineSchema) as Record<
            string,
            unknown
          >);

    if (dto.pipelineSchema !== undefined) {
      this.validatePipelineSchema(nextPipelineSchema);
    }

    const requestedProviderId =
      dto.aiProviderConfigId !== undefined
        ? dto.aiProviderConfigId
        : ((existing as any).aiProviderConfigId as string | null);
    const aiProviderConfigId = await this.resolveAiProviderConfigId(
      nextPipelineSchema,
      requestedProviderId,
    );

    const nextVersion =
      stableStringify(nextPipelineSchema) !==
      stableStringify((existing as any).pipelineSchema)
        ? existing.version + 1
        : existing.version;

    let detector;
    try {
      detector = await this.prisma.customDetector.update({
        where: { id },
        data: {
          key: nextKey,
          name: nextName,
          description: nextDescription,
          isActive: dto.isActive ?? existing.isActive,
          pipelineSchema: nextPipelineSchema as Prisma.InputJsonValue,
          aiProviderConfigId,
          version: nextVersion,
        } as any,
        include: {
          trainingRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { findings: true } },
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          `Custom detector key already exists: ${nextKey}`,
        );
      }
      throw error;
    }

    return this.toResponse(detector);
  }

  async delete(id: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.customDetector.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Custom detector with ID ${id} not found`);
    }

    // Remove this detector from all source configs that reference it.
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE sources
      SET config = jsonb_set(
        config,
        '{custom_detectors}',
        COALESCE(
          (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements_text(COALESCE(config->'custom_detectors', '[]'::jsonb)) AS elem
            WHERE elem != ${id}
          ),
          '[]'::jsonb
        )
      )
      WHERE config->'custom_detectors' @> ${JSON.stringify([id])}::jsonb
    `);

    await this.prisma.customDetector.delete({ where: { id } });
    return { deleted: true };
  }

  /** Read the raw CUSTOM example templates, or [] if the schema file is absent. */
  private loadCustomExampleRecords(): JsonRecord[] {
    const schemaPath = resolveSchemaFile(
      __dirname,
      'all_detectors_examples.json',
    );
    if (!fs.existsSync(schemaPath)) {
      return [];
    }
    const allExamples = JSON.parse(
      fs.readFileSync(schemaPath, 'utf8'),
    ) as Record<string, unknown>;
    const customExamples = allExamples.CUSTOM;
    return Array.isArray(customExamples)
      ? customExamples.map((raw) => asRecord(raw))
      : [];
  }

  /** The inner pipeline schema ({type, model, ...}) carried by an example record. */
  private examplePipelineSchema(example: JsonRecord): JsonRecord {
    const config = asRecord(example.pipelineSchema ?? example.config);
    // Templates nest the engine config under `pipeline_schema`; older shapes
    // put the type fields directly on the config.
    return asRecord(config.pipeline_schema ?? config);
  }

  /**
   * Worked custom-detector example templates (name, description, full config).
   * Pass `type` (REGEX | GLINER2 | LLM | *_CLASSIFICATION | FEATURE_EXTRACTION |
   * OBJECT_DETECTION) to return only the examples for that pipeline engine.
   */
  listExamples(type?: string): CustomDetectorExampleDto[] {
    const wanted = type?.trim().toUpperCase();
    return this.loadCustomExampleRecords()
      .filter((example) => {
        if (!wanted) return true;
        const schemaType =
          asString(this.examplePipelineSchema(example).type)?.toUpperCase() ??
          'GLINER2';
        return schemaType === wanted;
      })
      .map((example) => ({
        name: asString(example.name) ?? 'Custom Detector Example',
        description: asString(example.description) ?? 'Custom detector example',
        pipelineSchema: asRecord(example.pipelineSchema ?? example.config),
      }));
  }

  /** One-line "when to use" guidance per pipeline engine, in author order. */
  private static readonly TYPE_GUIDANCE: ReadonlyArray<[string, string]> = [
    [
      'REGEX',
      'fixed / structured tokens — IDs, keys, account or product codes',
    ],
    [
      'GLINER2',
      'zero-shot entities & categories with no labelled data (no training; dry-run only)',
    ],
    [
      'TEXT_CLASSIFICATION',
      'an off-the-shelf HF text classifier fits — spam, sentiment, toxicity, language, prompt-injection',
    ],
    [
      'IMAGE_CLASSIFICATION',
      'classify whole images — NSFW, scene or object category',
    ],
    [
      'OBJECT_DETECTION',
      'locate objects inside images — weapons, people, logos',
    ],
    [
      'FEATURE_EXTRACTION',
      'embeddings for similarity / clustering / retrieval',
    ],
    [
      'LLM',
      'nuanced judgement no smaller model captures (needs aiProviderConfigId; never provider_runtime)',
    ],
  ];

  /**
   * A compact registry of the available detector engines — derived from the
   * example templates so it stays in sync — listing, per type, when to use it
   * and the candidate models / example detectors harvested from the templates.
   * Injected into the detector-author system prompt so every run sees the full
   * menu (not just REGEX/GLINER2) without having to call detector.examples.
   */
  buildTypeRegistry(): string {
    const examples = this.loadCustomExampleRecords();
    const models = new Map<string, Set<string>>();
    const names = new Map<string, Set<string>>();
    for (const example of examples) {
      const schema = this.examplePipelineSchema(example);
      const type = asString(schema.type)?.toUpperCase() ?? 'GLINER2';
      const name = asString(example.name);
      if (name) {
        if (!names.has(type)) names.set(type, new Set());
        names.get(type)!.add(name);
      }
      // model is a HuggingFace id (string) or a {name, path} object (GLINER2).
      const model =
        asString(schema.model) ?? asString(asRecord(schema.model).name);
      if (model) {
        if (!models.has(type)) models.set(type, new Set());
        models.get(type)!.add(model);
      }
    }

    const lines = CustomDetectorsService.TYPE_GUIDANCE.map(([type, when]) => {
      const modelList = Array.from(models.get(type) ?? []).slice(0, 4);
      const detail =
        modelList.length > 0
          ? ` Models: ${modelList.join(', ')}.`
          : (() => {
              const nameList = Array.from(names.get(type) ?? []).slice(0, 3);
              return nameList.length > 0
                ? ` Examples: ${nameList.join('; ')}.`
                : '';
            })();
      return `- ${type} — ${when}.${detail}`;
    });

    return [
      'Available detector engines (pipeline_schema.type) — pick the simplest that fits;',
      'detector.examples returns a full worked schema to copy (optionally filter by type):',
      ...lines,
    ].join('\n');
  }

  async assertActiveDetectorIds(ids: unknown): Promise<string[]> {
    if (!Array.isArray(ids)) {
      return [];
    }

    const normalized = Array.from(
      new Set(
        ids
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter((entry) => entry.length > 0),
      ),
    );

    if (normalized.length === 0) {
      return [];
    }

    const rows = await this.prisma.customDetector.findMany({
      where: { id: { in: normalized }, isActive: true },
      select: { id: true },
    });
    const existing = new Set(rows.map((row) => row.id));
    const missing = normalized.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown or inactive custom detectors: ${missing.join(', ')}`,
      );
    }

    return normalized;
  }

  async buildRuntimeCustomDetectors(ids: unknown): Promise<
    Array<{
      id: string;
      key: string;
      name: string;
      detector: {
        type: 'CUSTOM';
        enabled: true;
        config: Record<string, unknown>;
      };
    }>
  > {
    if (!Array.isArray(ids)) {
      return [];
    }

    const normalizedIds = Array.from(
      new Set(
        ids
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter((entry) => entry.length > 0),
      ),
    );
    if (normalizedIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.customDetector.findMany({
      where: {
        id: { in: normalizedIds },
        isActive: true,
      },
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = normalizedIds
      .map((id) => byId.get(id))
      .filter((row): row is CustomDetector => Boolean(row));
    const entries = await Promise.all(
      orderedRows.map((row) => this.toRuntimeEntry(row)),
    );
    return entries.filter((entry): entry is NonNullable<typeof entry> =>
      Boolean(entry),
    );
  }

  /**
   * Same as buildRuntimeCustomDetectors but accepts string keys instead of IDs.
   * Used when sources store CUSTOM detectors as { type, custom_detector_key } in
   * their detectors array rather than the legacy custom_detectors ID array.
   */
  async buildRuntimeCustomDetectorsByKeys(keys: string[]): Promise<
    Array<{
      id: string;
      key: string;
      name: string;
      detector: {
        type: 'CUSTOM';
        enabled: true;
        config: Record<string, unknown>;
      };
    }>
  > {
    const normalizedKeys = Array.from(
      new Set(keys.map((k) => k.trim()).filter((k) => k.length > 0)),
    );
    if (normalizedKeys.length === 0) {
      return [];
    }

    const rows = await this.prisma.customDetector.findMany({
      where: {
        key: { in: normalizedKeys },
        isActive: true,
      },
    });

    const byKey = new Map(rows.map((row) => [row.key, row]));
    const orderedRows = normalizedKeys
      .map((key) => byKey.get(key))
      .filter((row): row is CustomDetector => Boolean(row));
    const entries = await Promise.all(
      orderedRows.map((row) => this.toRuntimeEntry(row)),
    );
    return entries.filter((entry): entry is NonNullable<typeof entry> =>
      Boolean(entry),
    );
  }

  /**
   * Build a single recipe entry from a custom detector row, hydrating LLM
   * provider credentials when needed. Returns null when an LLM detector's
   * provider credential cannot be resolved (missing key/model/credential) so a
   * single misconfigured detector is skipped rather than failing the whole run.
   */
  private async toRuntimeEntry(row: CustomDetector): Promise<{
    id: string;
    key: string;
    name: string;
    detector: {
      type: 'CUSTOM';
      enabled: true;
      config: Record<string, unknown>;
    };
  } | null> {
    let pipelineSchema: Record<string, unknown>;
    try {
      pipelineSchema = await this.injectLlmProviderRuntime(
        asRecord((row as any).pipelineSchema),
        (row as any).aiProviderConfigId ?? null,
      );
    } catch (error) {
      this.logger.warn(
        `Skipping custom detector "${row.key}" (${row.id}): unable to resolve AI provider credential — ${String(
          error instanceof Error ? error.message : error,
        )}`,
      );
      return null;
    }
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      detector: {
        type: 'CUSTOM' as const,
        enabled: true,
        config: {
          custom_detector_key: row.key,
          name: row.name,
          description: row.description,
          languages: ['de', 'en'],
          confidence_threshold: 0.7,
          max_findings: 100,
          pipeline_schema: pipelineSchema,
        },
      },
    };
  }

  // ── Training examples CRUD ─────────────────────────────────────────────────

  async saveTrainingExamples(
    detectorId: string,
    dto: SaveTrainingExamplesDto,
  ): Promise<{ saved: number }> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: detectorId },
      select: { id: true },
    });
    if (!detector) {
      throw new NotFoundException(`Custom detector ${detectorId} not found`);
    }

    if (dto.clearExisting) {
      await this.prisma.customDetectorTrainingExample.deleteMany({
        where: { customDetectorId: detectorId },
      });
    }

    if (dto.examples.length === 0) return { saved: 0 };

    await this.prisma.customDetectorTrainingExample.createMany({
      data: dto.examples.map((ex) => ({
        customDetectorId: detectorId,
        label: ex.label,
        text: ex.text,
        value: ex.value ?? null,
        accepted: ex.accepted,
        source: ex.source ?? null,
      })),
    });

    return { saved: dto.examples.length };
  }

  async listTrainingExamples(
    detectorId: string,
  ): Promise<TrainingExampleDto[]> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: detectorId },
      select: { id: true },
    });
    if (!detector) {
      throw new NotFoundException(`Custom detector ${detectorId} not found`);
    }

    return this.prisma.customDetectorTrainingExample.findMany({
      where: { customDetectorId: detectorId },
      orderBy: [{ label: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getTrainingExamplesStats(
    detectorId: string,
  ): Promise<TrainingExamplesStatsDto> {
    const examples = await this.prisma.customDetectorTrainingExample.findMany({
      where: { customDetectorId: detectorId },
      select: { label: true, accepted: true },
    });

    const byLabel: Record<string, { positive: number; negative: number }> = {};
    for (const ex of examples) {
      if (!byLabel[ex.label]) byLabel[ex.label] = { positive: 0, negative: 0 };
      if (ex.accepted) byLabel[ex.label].positive++;
      else byLabel[ex.label].negative++;
    }

    return { total: examples.length, byLabel };
  }

  async deleteTrainingExample(
    detectorId: string,
    exampleId: string,
  ): Promise<void> {
    const example = await this.prisma.customDetectorTrainingExample.findFirst({
      where: { id: exampleId, customDetectorId: detectorId },
    });
    if (!example) {
      throw new NotFoundException(`Training example ${exampleId} not found`);
    }
    await this.prisma.customDetectorTrainingExample.delete({
      where: { id: exampleId },
    });
  }

  async clearTrainingExamples(
    detectorId: string,
  ): Promise<{ deleted: number }> {
    const result = await this.prisma.customDetectorTrainingExample.deleteMany({
      where: { customDetectorId: detectorId },
    });
    return { deleted: result.count };
  }

  // ── Training ───────────────────────────────────────────────────────────────

  async train(
    id: string,
    dto: TrainCustomDetectorDto,
  ): Promise<CustomDetectorTrainingRunDto> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id },
    });
    if (!detector)
      throw new NotFoundException(`Custom detector ${id} not found`);

    if (dto.sourceId) {
      const source = await this.prisma.source.findUnique({
        where: { id: dto.sourceId },
        select: { id: true },
      });
      if (!source) {
        throw new BadRequestException(`Source ${dto.sourceId} not found`);
      }
    }

    const examples = await this.prisma.customDetectorTrainingExample.findMany({
      where: { customDetectorId: id },
      orderBy: [{ label: 'asc' }, { createdAt: 'asc' }],
    });

    const startedAt = Date.now();
    const run = await this.prisma.customDetectorTrainingRun.create({
      data: {
        customDetectorId: detector.id,
        sourceId: dto.sourceId ?? null,
        status: CustomDetectorTrainingStatus.RUNNING,
      },
    });

    // Fire training in the background — return RUNNING immediately so the API
    // response is not blocked by a potentially long fine-tuning job.
    void this._runTrainingBackground(detector, run.id, examples, startedAt);

    return this.toTrainingRunDto(run);
  }

  private async _runTrainingBackground(
    detector: CustomDetector,
    runId: string,
    examples: Array<{
      label: string;
      text: string | null;
      value: string | null | undefined;
      accepted: boolean;
      source: string | null | undefined;
    }>,
    startedAt: number,
  ): Promise<void> {
    try {
      const pipelineSchema = asRecord((detector as any).pipelineSchema);
      const configHash = createHash('sha256')
        .update(stableStringify(pipelineSchema))
        .digest('hex');

      const cacheRoot =
        process.env.CLASSIFYRE_MODEL_CACHE_DIR ??
        path.join(os.homedir(), '.cache', 'classifyre');
      const artifactDir = path.join(
        cacheRoot,
        'custom-detectors',
        detector.key,
        configHash,
      );

      const cliResult = await this.invokeCliTrain({
        pipelineSchema,
        examples: examples.map((e) => ({
          label: e.label,
          text: e.text ?? '',
          value: e.value,
          accepted: e.accepted,
          source: e.source,
        })),
        outputDir: artifactDir,
      });

      const strategy = 'GLINER2_PIPELINE';
      const summary = {
        strategy,
        config_hash: configHash,
        entity_count: Object.keys(asRecord(pipelineSchema.entities ?? {}))
          .length,
        classification_task_count: Object.keys(
          asRecord(pipelineSchema.classification ?? {}),
        ).length,
        trained_examples: cliResult.trained_examples,
      };

      await this.prisma.customDetectorTrainingRun.update({
        where: { id: runId },
        data: {
          status: CustomDetectorTrainingStatus.SUCCEEDED,
          strategy,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
          trainedExamples: cliResult.trained_examples,
          positiveExamples: cliResult.positive_examples,
          negativeExamples: cliResult.negative_examples,
          metrics: {
            ...summary,
            ...(cliResult.metrics ?? {}),
          },
          configHash,
          modelArtifactPath: cliResult.model_artifact_path,
        },
      });

      // Wire trained model path back into pipeline schema so runner uses it
      const updatedSchema = {
        ...pipelineSchema,
        model: {
          ...asRecord(pipelineSchema.model ?? {}),
          path: cliResult.model_artifact_path,
        },
      };

      await this.prisma.customDetector.update({
        where: { id: detector.id },
        data: {
          lastTrainedAt: new Date(),
          lastTrainingSummary: summary,
          pipelineSchema: updatedSchema,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Training run ${runId} failed: ${message}`);
      await this.prisma.customDetectorTrainingRun
        .update({
          where: { id: runId },
          data: {
            status: CustomDetectorTrainingStatus.FAILED,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt,
            errorMessage: message,
          },
        })
        .catch((dbErr: unknown) => {
          this.logger.error(
            `Failed to mark training run ${runId} as FAILED: ${String(dbErr)}`,
          );
        });
    }
  }

  private invokeCliTrain(params: {
    pipelineSchema: Record<string, unknown>;
    examples: Array<{
      label: string;
      text: string;
      value?: string | null;
      accepted: boolean;
      source?: string | null;
    }>;
    outputDir: string;
  }): Promise<{
    status: string;
    trained_examples: number;
    positive_examples: number;
    negative_examples: number;
    model_artifact_path: string;
    metrics?: Record<string, unknown>;
  }> {
    const tmpDir = os.tmpdir();
    const uid = randomUUID();
    const schemaPath = path.join(tmpDir, `cdet-schema-${uid}.json`);
    const examplesPath = path.join(tmpDir, `cdet-examples-${uid}.json`);

    fs.writeFileSync(schemaPath, JSON.stringify(params.pipelineSchema));
    fs.writeFileSync(examplesPath, JSON.stringify(params.examples));

    return new Promise((resolve, reject) => {
      // Prefer explicit override, then fall back to the CLI venv python so that
      // the full custom-detector dependency group (gliner2, setfit, etc.) is available.
      const defaultCliPath = path.resolve(__dirname, '../../../cli');
      const cliPath = process.env.CLI_PATH
        ? path.isAbsolute(process.env.CLI_PATH)
          ? process.env.CLI_PATH
          : path.resolve(__dirname, '../..', process.env.CLI_PATH)
        : defaultCliPath;
      const venvPython = path.join(cliPath, '.venv', 'bin', 'python');
      const pythonBin = process.env.CLASSIFYRE_PYTHON_BIN ?? venvPython;
      const child = spawn(
        pythonBin,
        [
          '-m',
          'src.main',
          'train',
          '--pipeline-schema',
          schemaPath,
          '--examples',
          examplesPath,
          '--output-dir',
          params.outputDir,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], cwd: cliPath },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      const cleanup = () => {
        try {
          fs.unlinkSync(schemaPath);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(examplesPath);
        } catch {
          /* ignore */
        }
      };

      child.on('close', (code) => {
        cleanup();
        if (code !== 0) {
          reject(new Error(`CLI train exited ${code}: ${stderr.slice(-2000)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(
            new Error(
              `CLI train produced invalid JSON output: ${stdout.slice(-500)}`,
            ),
          );
        }
      });

      child.on('error', (err) => {
        cleanup();
        reject(new Error(`Failed to spawn CLI trainer: ${err.message}`));
      });
    });
  }

  async getTrainingHistory(
    id: string,
    take = 20,
  ): Promise<CustomDetectorTrainingRunDto[]> {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!detector)
      throw new NotFoundException(`Custom detector ${id} not found`);

    const runs = await this.prisma.customDetectorTrainingRun.findMany({
      where: { customDetectorId: id },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return runs.map((run) => this.toTrainingRunDto(run));
  }
}
