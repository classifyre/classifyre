import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  NotebookExecutionMode,
  NotebookExecutionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { NotebookService } from './notebook.service';
import type { CreateNotebookExecutionDto } from './dto/notebook.dto';

const MODE_BY_DTO: Record<string, NotebookExecutionMode> = {
  cell: NotebookExecutionMode.CELL,
  all: NotebookExecutionMode.ALL,
  test_connection: NotebookExecutionMode.TEST_CONNECTION,
  preview_extract: NotebookExecutionMode.PREVIEW_EXTRACT,
};

const DTO_BY_MODE: Record<NotebookExecutionMode, string> = {
  [NotebookExecutionMode.CELL]: 'cell',
  [NotebookExecutionMode.ALL]: 'all',
  [NotebookExecutionMode.TEST_CONNECTION]: 'test_connection',
  [NotebookExecutionMode.PREVIEW_EXTRACT]: 'preview_extract',
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
    const notebook = await this.notebooks.get(sourceId);

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
        targetCellId: dto.targetCellId ?? null,
        status: NotebookExecutionStatus.PENDING,
        // Snapshot, not a reference: an execution must remain readable after
        // the notebook has moved on, and must never silently re-run different
        // code than the one it claims.
        cells: notebook.cells as unknown as Prisma.InputJsonValue,
        triggeredBy: triggeredBy ?? null,
      },
    });

    void this.run(execution.id, sourceId, dto);
    return execution;
  }

  private async run(
    executionId: string,
    sourceId: string,
    dto: CreateNotebookExecutionDto,
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
    await this.prisma.notebookExecution.update({
      where: { id: executionId },
      data: {
        status: failed
          ? payload.error?.type === 'ExecutionTimeout'
            ? NotebookExecutionStatus.TIMEOUT
            : NotebookExecutionStatus.ERROR
          : NotebookExecutionStatus.SUCCESS,
        outputs: this.buildOutputs(payload),
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

  toDto(execution: {
    id: string;
    sourceId: string;
    revision: number;
    mode: NotebookExecutionMode;
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
      revision: execution.revision,
      mode: DTO_BY_MODE[execution.mode],
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
