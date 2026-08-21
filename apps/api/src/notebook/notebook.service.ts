import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssetType, NotebookExecutionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { resolveSchemaFile } from '../utils/schema-path';
import * as fs from 'fs';
import {
  CELL_ID_PATTERN,
  CONFIG_KEY_PATTERN,
  type NotebookCellDto,
  type UpdateNotebookDto,
} from './dto/notebook.dto';

export const REQUIRED_FUNCTIONS = ['test_connection', 'extract'];
export const OPTIONAL_FUNCTIONS = ['discover', 'fetch_content'];

const STARTER_EXAMPLE_NAME = 'Starter notebook';

interface NotebookConfig {
  revision: number;
  cells: NotebookCellDto[];
}

@Injectable()
export class NotebookService {
  private readonly logger = new Logger(NotebookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MaskedConfigCryptoService,
  ) {}

  /**
   * The starter cells, read from the same example the CLI reads.
   *
   * Serving them rather than letting the editor carry its own copy is what
   * keeps the scaffold and the contract from drifting: if the contract gains a
   * required function, the example gains a cell, and every surface follows.
   */
  scaffold(): { cells: NotebookCellDto[] } {
    const examples = this.customExamples();
    const starter =
      examples.find((entry) => entry.name === STARTER_EXAMPLE_NAME) ??
      examples[0];
    const cells = starter?.config?.required?.notebook?.cells;
    if (!Array.isArray(cells) || cells.length === 0) {
      throw new Error(
        'all_input_examples.json has no CUSTOM starter notebook to scaffold from',
      );
    }
    return { cells: cells as NotebookCellDto[] };
  }

  /**
   * Every worked example an author can start from, including the starter.
   *
   * The same file the scaffold comes from, for the same reason: the templates
   * teach the SDK, and a copy of them in the frontend would go stale the moment
   * the SDK gained a method. An example with no cells is skipped rather than
   * served -- an empty template in the picker is worse than a missing one.
   */
  templates(): Array<{
    name: string;
    description: string;
    cells: NotebookCellDto[];
  }> {
    return this.customExamples()
      .map((entry) => ({
        name: String(entry.name ?? ''),
        description: String(entry.description ?? ''),
        cells: (entry.config?.required?.notebook?.cells ??
          []) as NotebookCellDto[],
      }))
      .filter((entry) => entry.name && entry.cells.length > 0);
  }

  private customExamples(): Array<{
    name?: string;
    description?: string;
    config?: any;
  }> {
    const path = resolveSchemaFile(__dirname, 'all_input_examples.json');
    const examples = JSON.parse(fs.readFileSync(path, 'utf8')) as Record<
      string,
      Array<{ name?: string; description?: string; config?: any }>
    >;
    return examples.CUSTOM ?? [];
  }

  async getSource(sourceId: string) {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, type: true, config: true, runnerStatus: true },
    });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }
    if (source.type !== AssetType.CUSTOM) {
      throw new BadRequestException(
        `Source ${sourceId} is a ${source.type} source; notebooks exist only on CUSTOM sources.`,
      );
    }
    return source;
  }

  async get(sourceId: string) {
    const source = await this.getSource(sourceId);
    const config = (source.config ?? {}) as Record<string, any>;
    const notebook = this.readNotebook(config);

    return {
      revision: notebook.revision,
      cells: notebook.cells,
      variables: (config.optional?.variables ?? {}) as Record<string, string>,
      // Secret values are write-only. Returning them would put every source's
      // credentials into any browser session that can open the editor.
      secretKeys: Object.keys(config.masked?.secrets ?? {}).sort(),
    };
  }

  private readNotebook(config: Record<string, any>): NotebookConfig {
    const notebook = config?.required?.notebook ?? {};
    return {
      revision: Number.isInteger(notebook.revision) ? notebook.revision : 1,
      cells: Array.isArray(notebook.cells) ? notebook.cells : [],
    };
  }

  /**
   * Structural checks the API can make on its own.
   *
   * Whether the notebook *satisfies the source contract* is a question about
   * Python, answered by the CLI (`notebook --mode validate`) and enforced again
   * before any execution or scan. Blocking a save on it would mean an autosave
   * could not land while the author was midway through typing a function.
   */
  private assertStructurallyValid(cells: NotebookCellDto[]): void {
    if (!cells.length) {
      throw new BadRequestException('A notebook must have at least one cell.');
    }
    const seen = new Set<string>();
    for (const cell of cells) {
      if (!CELL_ID_PATTERN.test(cell.id)) {
        throw new BadRequestException(
          `Cell id '${cell.id}' must match ${CELL_ID_PATTERN.source}.`,
        );
      }
      if (seen.has(cell.id)) {
        throw new BadRequestException(`Duplicate cell id '${cell.id}'.`);
      }
      seen.add(cell.id);
    }
  }

  private assertValidKeys(
    record: Record<string, unknown> | undefined,
    label: string,
  ): void {
    for (const key of Object.keys(record ?? {})) {
      if (!CONFIG_KEY_PATTERN.test(key)) {
        throw new BadRequestException(
          `${label} key '${key}' must be a valid Python identifier (${CONFIG_KEY_PATTERN.source}), ` +
            'because the notebook reads it by name.',
        );
      }
    }
  }

  /**
   * Save the notebook, refusing to overwrite someone else's newer version.
   *
   * The revision lives inside the notebook config rather than in a column, so
   * this locking is contained to notebooks and the generic source update path
   * is untouched.
   */
  async update(sourceId: string, dto: UpdateNotebookDto) {
    const source = await this.getSource(sourceId);
    const config = structuredClone(source.config ?? {}) as Record<string, any>;
    const current = this.readNotebook(config);

    if (dto.baseRevision !== current.revision) {
      throw new ConflictException({
        message:
          `This notebook has changed since you opened it (you have revision ${dto.baseRevision}, ` +
          `it is now at ${current.revision}). Reload to get the latest version.`,
        currentRevision: current.revision,
        yourRevision: dto.baseRevision,
      });
    }

    this.assertStructurallyValid(dto.cells);
    this.assertValidKeys(dto.variables, 'Variable');
    this.assertValidKeys(dto.secrets, 'Secret');

    const revision = current.revision + 1;
    config.type = AssetType.CUSTOM;
    config.required = {
      ...(config.required ?? {}),
      notebook: { revision, cells: dto.cells },
    };

    if (dto.variables) {
      config.optional = {
        ...(config.optional ?? {}),
        variables: dto.variables,
      };
    }
    if (dto.secrets) {
      config.masked = {
        ...(config.masked ?? {}),
        secrets: this.mergeSecrets(config.masked?.secrets ?? {}, dto.secrets),
      };
    }

    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        // Encrypting on the way in keeps the stored shape identical to every
        // other source, so export, import and redaction need no special case.
        config: this.crypto.encryptMaskedConfig(
          config,
        ) as Prisma.InputJsonValue,
      },
    });

    return { revision };
  }

  /**
   * Apply a partial secret update.
   *
   * Only the keys present are touched, and a null value deletes one. A full
   * replacement would mean the editor -- which never receives secret values --
   * could not save anything without wiping them.
   */
  private mergeSecrets(
    existing: Record<string, string>,
    incoming: Record<string, string | null>,
  ): Record<string, string> {
    const merged: Record<string, string> = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null || value === '') {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  /**
   * The notebook as an ordinary Python module.
   *
   * `# %%` is just a comment, so the result runs under plain `python
   * workflow.py` with no notebook runtime -- which is what makes "productize"
   * a download rather than a rewrite.
   */
  async exportPython(sourceId: string): Promise<string> {
    const { cells } = await this.get(sourceId);
    const parts: string[] = [];
    for (const cell of cells) {
      if (cell.type === 'markdown') {
        parts.push(`# %% [markdown] id=${cell.id}`);
        parts.push(
          ...cell.source
            .split('\n')
            .map((line) => (line.trim() ? `# ${line}` : '#')),
        );
      } else {
        parts.push(`# %% id=${cell.id}`);
        parts.push(...cell.source.split('\n'));
      }
      parts.push('');
    }
    return `${parts.join('\n').trimEnd()}\n`;
  }

  // -- executions ----------------------------------------------------------

  async listExecutions(sourceId: string, limit = 20) {
    await this.getSource(sourceId);
    return this.prisma.notebookExecution.findMany({
      where: { sourceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async getExecution(executionId: string) {
    const execution = await this.prisma.notebookExecution.findUnique({
      where: { id: executionId },
    });
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }
    return execution;
  }

  isTerminal(status: NotebookExecutionStatus): boolean {
    return (
      status === NotebookExecutionStatus.SUCCESS ||
      status === NotebookExecutionStatus.ERROR ||
      status === NotebookExecutionStatus.CANCELLED ||
      status === NotebookExecutionStatus.TIMEOUT
    );
  }
}
