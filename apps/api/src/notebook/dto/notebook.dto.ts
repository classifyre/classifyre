import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Cell ids are addressable in URLs and in Monaco model URIs
 * (`notebook://<source>/<cell>.py`), so they are restricted to characters that
 * survive both.
 */
export const CELL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Variable and secret keys are read from the notebook by name
 * (`ctx.var("api_base")`), so a key that is not a Python identifier would be
 * unreachable from the code that needs it.
 */
export const CONFIG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export class NotebookCellDto {
  @ApiProperty({ example: 'extract', pattern: CELL_ID_PATTERN.source })
  @IsString()
  @Matches(CELL_ID_PATTERN)
  id!: string;

  @ApiProperty({ enum: ['code', 'markdown'] })
  @IsIn(['code', 'markdown'])
  type!: 'code' | 'markdown';

  @ApiProperty({ description: 'Cell source text' })
  @IsString()
  source!: string;
}

export class NotebookDto {
  @ApiProperty({ description: 'Revision this notebook is currently at' })
  @IsInt()
  @Min(1)
  revision!: number;

  @ApiProperty({ type: [NotebookCellDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotebookCellDto)
  cells!: NotebookCellDto[];

  @ApiProperty({
    description: 'Non-secret values the notebook reads with ctx.var(name)',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  variables!: Record<string, string>;

  @ApiProperty({
    description:
      'Names of configured secrets. Values are never returned -- they are write-only.',
    type: [String],
  })
  @IsArray()
  secretKeys!: string[];

  @ApiPropertyOptional({
    description: 'Contract violations, if the notebook is not currently valid',
  })
  @IsOptional()
  contract?: Record<string, unknown> | null;
}

export class UpdateNotebookDto {
  @ApiProperty({
    description:
      'The revision the editor started from. A mismatch means someone else saved first and the request is rejected with 409.',
  })
  @IsInt()
  @Min(1)
  baseRevision!: number;

  @ApiProperty({ type: [NotebookCellDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotebookCellDto)
  cells!: NotebookCellDto[];

  @ApiPropertyOptional({
    description: 'Replaces the full variable map when present.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Secrets to set. Only the keys present are changed; a null value deletes that key.',
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
  })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string | null>;
}

export class UpdateNotebookResponseDto {
  @ApiProperty()
  revision!: number;

  @ApiProperty({
    description: 'Whether the saved notebook satisfies the source contract',
  })
  contractOk!: boolean;

  @ApiPropertyOptional()
  contract?: Record<string, unknown> | null;
}

export const NOTEBOOK_EXECUTION_MODES = [
  'cell',
  'all',
  'test_connection',
  'preview_extract',
] as const;

export class CreateNotebookExecutionDto {
  @ApiPropertyOptional({
    description:
      'The revision to execute. Executions run a snapshot, never "whatever is ' +
      'in the database now". Either this or `baseRevision` is required — they ' +
      'mean the same thing. The alias exists because the notebook PUT next to ' +
      'this endpoint spells the same concept `baseRevision`, and sending that ' +
      'name here used to be rejected with "Revision undefined is not the ' +
      'current notebook revision": correct about the value, silent about the ' +
      'field name that produced it.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  revision?: number;

  @ApiPropertyOptional({
    description:
      'Alias of `revision`, matching the notebook PUT. Supply either one.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  baseRevision?: number;

  @ApiProperty({ enum: NOTEBOOK_EXECUTION_MODES })
  @IsIn(NOTEBOOK_EXECUTION_MODES)
  mode!: (typeof NOTEBOOK_EXECUTION_MODES)[number];

  @ApiPropertyOptional({ description: 'Required when mode is "cell"' })
  @IsOptional()
  @IsString()
  @Matches(CELL_ID_PATTERN)
  targetCellId?: string;

  @ApiPropertyOptional({
    description: 'Assets to sample in preview_extract mode',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAssets?: number;
}

export class NotebookExecutionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiProperty()
  revision!: number;

  @ApiProperty({ enum: ['CELL', 'ALL', 'TEST_CONNECTION', 'PREVIEW_EXTRACT'] })
  mode!: string;

  @ApiProperty({
    enum: ['PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'CANCELLED', 'TIMEOUT'],
  })
  status!: string;

  @ApiPropertyOptional()
  targetCellId?: string | null;

  @ApiPropertyOptional({
    description: 'Per-cell outputs, keyed by cell id in execution order',
  })
  outputs?: unknown;

  @ApiPropertyOptional({
    description: 'The cell that raised, which is not always the target cell',
  })
  failedCellId?: string | null;

  @ApiPropertyOptional()
  error?: unknown;

  @ApiPropertyOptional()
  durationMs?: number | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  startedAt?: Date | null;

  @ApiPropertyOptional()
  finishedAt?: Date | null;
}

export class NotebookTemplateDto {
  @ApiProperty({ description: 'Shown in the template picker' })
  name!: string;

  @ApiProperty({ description: 'One line on what this template does' })
  description!: string;

  @ApiProperty({
    type: [NotebookCellDto],
    description: 'Cells to append. The editor assigns fresh ids on insert.',
  })
  cells!: NotebookCellDto[];
}

export class NotebookScaffoldDto {
  @ApiProperty({ type: [NotebookCellDto] })
  cells!: NotebookCellDto[];

  @ApiProperty({
    description: 'Function names every notebook must define',
    type: [String],
  })
  requiredFunctions!: string[];

  @ApiProperty({
    description: 'Function names a notebook may define',
    type: [String],
  })
  optionalFunctions!: string[];
}
