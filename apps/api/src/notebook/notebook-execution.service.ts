import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  NotebookExecutionMode,
  NotebookExecutionStatus,
  NotebookScope,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { NotebookService } from './notebook.service';
import {
  DETECTOR_NOTEBOOK_EXECUTION_MODES,
  type CreateDetectorNotebookExecutionDto,
  type CreateNotebookExecutionDto,
} from './dto/notebook.dto';
import { codeCells, isCodeDetectorSchema } from '../custom-detector-code';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { redactDeepWithSecrets } from '../cli-runner/runner-error-safety';

const MODE_BY_DTO: Record<string, NotebookExecutionMode> = {
  cell: NotebookExecutionMode.CELL,
  all: NotebookExecutionMode.ALL,
  test_connection: NotebookExecutionMode.TEST_CONNECTION,
  preview_extract: NotebookExecutionMode.PREVIEW_EXTRACT,
  preview_augment: NotebookExecutionMode.PREVIEW_AUGMENT,
  preview_detect: NotebookExecutionMode.PREVIEW_DETECT,
};

const DTO_BY_MODE: Record<NotebookExecutionMode, string> = {
  [NotebookExecutionMode.CELL]: 'cell',
  [NotebookExecutionMode.ALL]: 'all',
  [NotebookExecutionMode.TEST_CONNECTION]: 'test_connection',
  [NotebookExecutionMode.PREVIEW_EXTRACT]: 'preview_extract',
  [NotebookExecutionMode.PREVIEW_AUGMENT]: 'preview_augment',
  [NotebookExecutionMode.PREVIEW_DETECT]: 'preview_detect',
};

const SCOPE_BY_DTO: Record<string, 'CONNECTOR' | 'AUGMENTATION'> = {
  connector: 'CONNECTOR',
  augmentation: 'AUGMENTATION',
};

@Injectable()
export class NotebookExecutionService {
  private readonly logger = new Logger(NotebookExecutionService.name);

  /** Local child processes, so a cancel has something to kill. */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notebooks: NotebookService,
    private readonly cliRunner: CliRunnerService,
    private readonly crypto: MaskedConfigCryptoService,
  ) {}

  /**
   * Record an execution and start it, returning before it finishes.
   *
   * Not synchronous like a connection test: Run All replays every preceding
   * cell, and a notebook that loads a large dataset would blow the request
   * timeout long before it had anything to say. The caller polls.
   */
  async create(
    sourceId: string,
    dto: CreateNotebookExecutionDto,
    triggeredBy?: string,
  ) {
    // preview_augment always addresses the augmentation notebook, whatever
    // scope the caller sent; every other mode defaults to the connector.
    const scope =
      dto.mode === 'preview_augment'
        ? 'augmentation'
        : (dto.scope ?? 'connector');
    const notebook = await this.notebooks.get(sourceId, scope);

    // `revision` here and `baseRevision` on the notebook PUT are the same
    // concept under two names, and there is no global ValidationPipe to
    // normalise either — so both are read here. Sending the PUT's name used to
    // produce "Revision undefined is not the current notebook revision":
    // accurate about the value and silent about the field that caused it.
    const requested = dto.revision ?? dto.baseRevision;
    if (requested === undefined) {
      throw new BadRequestException(
        'A revision is required: send `revision` (or `baseRevision`, which is ' +
          `an alias). The notebook is currently at revision ${notebook.revision}.`,
      );
    }
    if (requested !== notebook.revision) {
      throw new BadRequestException(
        `Revision ${requested} is not the current notebook revision (${notebook.revision}). ` +
          'Save your changes first, then run.',
      );
    }
    if (dto.mode === 'cell' && !dto.targetCellId) {
      throw new BadRequestException('mode "cell" requires targetCellId.');
    }
    if (
      dto.targetCellId &&
      !notebook.cells.some((cell) => cell.id === dto.targetCellId)
    ) {
      throw new BadRequestException(
        `No cell with id '${dto.targetCellId}' in revision ${notebook.revision}.`,
      );
    }

    const execution = await this.prisma.notebookExecution.create({
      data: {
        sourceId,
        revision: notebook.revision,
        mode: MODE_BY_DTO[dto.mode],
        scope: SCOPE_BY_DTO[scope],
        targetCellId: dto.targetCellId ?? null,
        status: NotebookExecutionStatus.PENDING,
        // Snapshot, not a reference: an execution must remain readable after
        // the notebook has moved on, and must never silently re-run different
        // code than the one it claims.
        cells: notebook.cells as unknown as Prisma.InputJsonValue,
        triggeredBy: triggeredBy ?? null,
      },
    });

    void this.run(execution.id, sourceId, dto, scope);
    return execution;
  }

  private async run(
    executionId: string,
    sourceId: string,
    dto: CreateNotebookExecutionDto,
    scope: 'connector' | 'augmentation' = 'connector',
  ): Promise<void> {
    const startedAt = new Date();
    try {
      await this.prisma.notebookExecution.update({
        where: { id: executionId },
        data: { status: NotebookExecutionStatus.RUNNING, startedAt },
      });

      const { payload, stderr, exitCode } =
        await this.cliRunner.runNotebookExecution({
          sourceId,
          request: {
            executionId,
            mode: dto.mode,
            scope,
            targetCellId: dto.targetCellId,
            revision: dto.revision,
            maxAssets: dto.maxAssets,
          },
          onJobCreated: async ({ jobName, namespace }) => {
            await this.prisma.notebookExecution.update({
              where: { id: executionId },
              data: { jobName, jobNamespace: namespace },
            });
          },
        });

      await this.finish(executionId, payload, stderr, exitCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notebook execution ${executionId} failed: ${message}`);
      await this.markFailed(executionId, {
        type: 'ExecutionFailed',
        message,
      });
    } finally {
      this.running.delete(executionId);
    }
  }

  private async finish(
    executionId: string,
    payload: Record<string, any> | null,
    stderr: string,
    exitCode: number,
  ): Promise<void> {
    const current = await this.prisma.notebookExecution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
    // A cancel that landed while the process was winding down wins: reporting
    // "error" for a run the user deliberately stopped is just noise.
    if (current?.status === NotebookExecutionStatus.CANCELLED) {
      return;
    }

    if (!payload) {
      await this.markFailed(executionId, {
        type: 'NoResult',
        message:
          exitCode === 0
            ? 'The notebook process produced no result.'
            : `The notebook process exited with code ${exitCode}.`,
        traceback: stderr ? stderr.split('\n').slice(-40) : [],
      });
      return;
    }

    const failed = payload.status !== 'success';
    // A rule that prints ctx.secret(...) (or echoes it into a preview
    // finding) must not persist the value: redact stored outputs against the
    // detector's own secret values before they reach Postgres.
    const outputs =
      executionId != null
        ? await this.redactedDetectorOutputs(
            executionId,
            this.buildOutputs(payload),
          )
        : this.buildOutputs(payload);
    await this.prisma.notebookExecution.update({
      where: { id: executionId },
      data: {
        status: failed
          ? payload.error?.type === 'ExecutionTimeout'
            ? NotebookExecutionStatus.TIMEOUT
            : NotebookExecutionStatus.ERROR
          : NotebookExecutionStatus.SUCCESS,
        outputs,
        failedCellId: payload.failedCellId ?? null,
        error: (payload.error ?? null) as Prisma.InputJsonValue,
        durationMs:
          typeof payload.durationMs === 'number' ? payload.durationMs : null,
        finishedAt: new Date(),
      },
    });
  }

  /**
   * The per-cell results plus whatever the mode produced.
   *
   * Kept as one JSON column rather than a table: outputs are read as a whole,
   * by one editor, and are disposable — the notebook can always be run again.
   */
  private buildOutputs(payload: Record<string, any>): Prisma.InputJsonValue {
    return {
      cells: payload.cells ?? [],
      ...(payload.result !== undefined ? { result: payload.result } : {}),
      ...(payload.assets !== undefined ? { assets: payload.assets } : {}),
      ...(payload.contract !== undefined ? { contract: payload.contract } : {}),
    };
  }

  /**
   * The detector's decrypted secret values, for redacting stored outputs.
   * Best-effort: a redaction miss must not fail the execution write.
   */
  private async detectorSecretValues(executionId: string): Promise<string[]> {
    try {
      const execution = await this.prisma.notebookExecution.findUnique({
        where: { id: executionId },
        select: {
          customDetector: { select: { pipelineSchema: true } },
        },
      });
      const schema = (execution?.customDetector?.pipelineSchema ??
        {}) as Record<string, unknown>;
      const secrets =
        schema && typeof schema === 'object'
          ? (schema.secrets as Record<string, unknown> | undefined)
          : undefined;
      if (!secrets || typeof secrets !== 'object') return [];
      const values: string[] = [];
      for (const value of Object.values(secrets)) {
        if (typeof value !== 'string' || !value) continue;
        try {
          values.push(
            this.crypto.isEncryptedValue(value)
              ? this.crypto.decryptString(value)
              : value,
          );
        } catch {
          // An undecryptable leaf is not a live credential; skip it.
        }
      }
      return values;
    } catch {
      return [];
    }
  }

  private async redactedDetectorOutputs(
    executionId: string,
    outputs: Prisma.InputJsonValue,
  ): Promise<Prisma.InputJsonValue> {
    const secrets = await this.detectorSecretValues(executionId);
    if (secrets.length === 0) return outputs;
    return redactDeepWithSecrets(outputs, secrets) as Prisma.InputJsonValue;
  }

  private async markFailed(
    executionId: string,
    error: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.notebookExecution
      .update({
        where: { id: executionId },
        data: {
          status: NotebookExecutionStatus.ERROR,
          error: error as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  /**
   * Stop a running execution.
   *
   * Python cannot be interrupted from outside, so cancelling means ending the
   * process (or deleting the Job). A loop that ignores ctx.should_abort is
   * stopped this way and no other.
   */
  async cancel(executionId: string): Promise<{ cancelled: boolean }> {
    const execution = await this.notebooks.getExecution(executionId);
    if (this.notebooks.isTerminal(execution.status)) {
      return { cancelled: false };
    }

    if (execution.jobName) {
      await this.cliRunner
        .cancelNotebookJob(executionId)
        .catch(() => undefined);
    }
    this.running.get(executionId)?.abort();

    await this.prisma.notebookExecution.update({
      where: { id: executionId },
      data: {
        status: NotebookExecutionStatus.CANCELLED,
        finishedAt: new Date(),
      },
    });
    return { cancelled: true };
  }

  /**
   * Record and start an execution of a code detector's notebook.
   *
   * `cell` / `all` need no source: they replay the detector's cells with its
   * variables, secrets and files, for print() debugging of helpers.
   * `preview_detect` needs one: it judges a real asset of that source (or a
   * small sample) exactly as a scan would, and records nothing.
   */
  async createForDetector(
    detectorId: string,
    dto: CreateDetectorNotebookExecutionDto,
    triggeredBy?: string,
  ) {
    // No global ValidationPipe: the DTO decorators do not run, so check here.
    const mode = dto?.mode;
    if (
      !mode ||
      !(DETECTOR_NOTEBOOK_EXECUTION_MODES as readonly string[]).includes(mode)
    ) {
      throw new BadRequestException(
        `mode must be one of: ${DETECTOR_NOTEBOOK_EXECUTION_MODES.join(', ')}`,
      );
    }
    const detector = await this.prisma.customDetector.findUnique({
      where: { id: detectorId },
      select: { id: true, pipelineSchema: true },
    });
    if (!detector) {
      throw new NotFoundException(`Custom detector ${detectorId} not found`);
    }
    if (!isCodeDetectorSchema(detector.pipelineSchema)) {
      throw new BadRequestException(
        'Only code detectors (pipeline type CODE_DETECTOR) have a notebook to run.',
      );
    }
    const schema = detector.pipelineSchema as Record<string, any>;
    const current = Number.isInteger(schema.notebook?.revision)
      ? (schema.notebook.revision as number)
      : 1;
    if (dto.revision !== current) {
      throw new BadRequestException(
        `Revision ${String(dto.revision)} is not the detector notebook's current revision (${current}). Save your changes first, then run.`,
      );
    }
    const cells = codeCells(schema);
    if (mode === 'cell') {
      if (!dto.targetCellId) {
        throw new BadRequestException('mode "cell" requires targetCellId.');
      }
      if (!cells.some((cell) => cell.id === dto.targetCellId)) {
        throw new BadRequestException(
          `No cell with id '${dto.targetCellId}' in revision ${current}.`,
        );
      }
    }
    let sourceId: string | null = null;
    let assetId: string | null = null;
    if (mode === 'preview_detect') {
      if (!dto.sourceId) {
        throw new BadRequestException(
          'preview_detect needs sourceId: the source whose assets the detector judges.',
        );
      }
      const source = await this.prisma.source.findUnique({
        where: { id: dto.sourceId },
        select: { id: true },
      });
      if (!source) {
        throw new NotFoundException(`Source ${dto.sourceId} not found`);
      }
      sourceId = source.id;
      if (dto.assetId) {
        const asset = await this.prisma.asset.findFirst({
          where: { id: dto.assetId, sourceId },
          select: { id: true },
        });
        if (!asset) {
          throw new NotFoundException(
            `Asset ${dto.assetId} not found on source ${sourceId}`,
          );
        }
        assetId = asset.id;
      }
    }

    const execution = await this.prisma.notebookExecution.create({
      data: {
        sourceId,
        customDetectorId: detector.id,
        assetId,
        revision: current,
        mode: MODE_BY_DTO[mode],
        scope: NotebookScope.DETECTOR,
        targetCellId: dto.targetCellId ?? null,
        status: NotebookExecutionStatus.PENDING,
        cells: cells,
        triggeredBy: triggeredBy ?? null,
      },
    });

    void this.runForDetector(execution.id, detector.id, {
      mode,
      targetCellId: dto.targetCellId,
      revision: current,
      sourceId,
      assetId,
      // No global ValidationPipe on this route, so the DTO's @Max(10) never
      // runs: clamp here so a preview cannot sample the whole source.
      maxAssets:
        typeof dto.maxAssets === 'number'
          ? Math.min(10, Math.max(1, Math.floor(dto.maxAssets)))
          : undefined,
    });
    return execution;
  }

  private async runForDetector(
    executionId: string,
    detectorId: string,
    params: {
      mode: string;
      targetCellId?: string;
      revision: number;
      sourceId: string | null;
      assetId: string | null;
      maxAssets?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.notebookExecution.update({
        where: { id: executionId },
        data: {
          status: NotebookExecutionStatus.RUNNING,
          startedAt: new Date(),
        },
      });
      const { payload, stderr, exitCode } =
        await this.cliRunner.runDetectorNotebookExecution({
          detectorId,
          sourceId: params.sourceId,
          assetId: params.assetId,
          request: {
            executionId,
            mode: params.mode,
            scope: 'detector',
            targetCellId: params.targetCellId,
            revision: params.revision,
            maxAssets: params.maxAssets,
          },
          onJobCreated: async ({ jobName, namespace }) => {
            await this.prisma.notebookExecution.update({
              where: { id: executionId },
              data: { jobName, jobNamespace: namespace },
            });
          },
        });
      await this.finish(executionId, payload, stderr, exitCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Detector notebook execution ${executionId} failed: ${message}`,
      );
      await this.markFailed(executionId, { type: 'ExecutionFailed', message });
    }
  }

  async listForDetector(detectorId: string, limit = 20) {
    return this.prisma.notebookExecution.findMany({
      where: { customDetectorId: detectorId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  toDto(execution: {
    id: string;
    sourceId: string | null;
    customDetectorId?: string | null;
    assetId?: string | null;
    revision: number;
    mode: NotebookExecutionMode;
    scope?: { toString(): string } | string | null;
    status: NotebookExecutionStatus;
    targetCellId: string | null;
    outputs: unknown;
    failedCellId: string | null;
    error: unknown;
    durationMs: number | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }) {
    return {
      id: execution.id,
      sourceId: execution.sourceId,
      customDetectorId: execution.customDetectorId ?? null,
      assetId: execution.assetId ?? null,
      revision: execution.revision,
      mode: DTO_BY_MODE[execution.mode],
      scope: String(execution.scope ?? 'CONNECTOR').toLowerCase(),
      status: execution.status,
      targetCellId: execution.targetCellId,
      outputs: execution.outputs,
      failedCellId: execution.failedCellId,
      error: execution.error,
      durationMs: execution.durationMs,
      createdAt: execution.createdAt,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
    };
  }
}
