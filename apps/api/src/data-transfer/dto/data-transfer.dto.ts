import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TRANSFER_SCOPE_IDS, type TransferScopeId } from '../transfer-scopes';

export const DATA_TRANSFER_KINDS = ['EXPORT', 'IMPORT'] as const;
export const DATA_TRANSFER_STATUSES = [
  'STAGED',
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export const DATA_TRANSFER_CONFLICT_MODES = ['SKIP', 'OVERWRITE'] as const;

export class TransferScopeDto {
  @ApiProperty({ enum: TRANSFER_SCOPE_IDS, example: 'findings' })
  id: TransferScopeId;

  @ApiProperty({ example: 'Findings' })
  label: string;

  @ApiProperty()
  description: string;

  @ApiProperty({
    description:
      'Scopes this one references. Importing without them skips orphaned rows.',
    enum: TRANSFER_SCOPE_IDS,
    isArray: true,
  })
  dependsOn: readonly TransferScopeId[];

  @ApiProperty({
    description: 'Large or binary payload — off by default in the UI.',
  })
  heavy: boolean;

  @ApiProperty({
    description: 'Contains configuration whose credentials are stripped.',
  })
  redactsSecrets: boolean;

  @ApiProperty({
    description: 'Rows currently in this namespace for this scope.',
    example: 4312,
  })
  rows: number;
}

export class StartExportDto {
  @ApiProperty({
    description: 'Scopes to include in the archive.',
    enum: TRANSFER_SCOPE_IDS,
    isArray: true,
    example: ['sources', 'findings'],
  })
  scopes: string[];
}

export class StartImportDto {
  @ApiProperty({
    description:
      'Handle returned by the upload endpoint for the staged archive.',
  })
  uploadId: string;

  @ApiProperty({
    description:
      'Scopes to take from the archive. May be a subset of what it holds.',
    enum: TRANSFER_SCOPE_IDS,
    isArray: true,
  })
  scopes: string[];

  @ApiPropertyOptional({
    description:
      'What to do about an entry that already exists. Imported rows always get ' +
      'fresh ids, so this only applies where identity is natural rather than ' +
      'generated — glossary terms, MCP server slugs — and to singleton ' +
      'configuration. SKIP keeps what is there; OVERWRITE replaces it.',
    enum: DATA_TRANSFER_CONFLICT_MODES,
    default: 'SKIP',
  })
  conflictMode?: (typeof DATA_TRANSFER_CONFLICT_MODES)[number];
}

export class ArchivePreviewDto {
  @ApiProperty({ description: 'Pass back to the import endpoint.' })
  uploadId: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty({ description: 'Compressed size in bytes.' })
  fileSize: number;

  @ApiProperty({ description: 'When the archive was exported.' })
  createdAt: string;

  @ApiProperty({ description: 'Classifyre version that wrote the archive.' })
  appVersion: string;

  @ApiProperty({ description: 'Namespace the archive was exported from.' })
  sourceNamespace: string;

  @ApiProperty({ enum: TRANSFER_SCOPE_IDS, isArray: true })
  scopes: TransferScopeId[];

  @ApiProperty({
    description: 'Rows per scope, keyed by scope id.',
    example: { sources: 4, findings: 5120 },
  })
  rowsByScope: Record<string, number>;

  @ApiProperty()
  totalRows: number;
}

export class DataTransferJobDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: DATA_TRANSFER_KINDS })
  kind: (typeof DATA_TRANSFER_KINDS)[number];

  @ApiProperty({ enum: DATA_TRANSFER_STATUSES })
  status: (typeof DATA_TRANSFER_STATUSES)[number];

  @ApiProperty({ enum: TRANSFER_SCOPE_IDS, isArray: true })
  scopes: string[];

  @ApiProperty({ enum: DATA_TRANSFER_CONFLICT_MODES })
  conflictMode: (typeof DATA_TRANSFER_CONFLICT_MODES)[number];

  @ApiProperty({ nullable: true })
  fileName: string | null;

  @ApiProperty({
    description: 'Compressed archive size in bytes; null until it is written.',
    nullable: true,
  })
  fileSize: number | null;

  @ApiProperty({
    description: 'SHA-256 of the compressed archive.',
    nullable: true,
  })
  checksum: string | null;

  @ApiProperty({
    description: 'True while the archive is still stored and downloadable.',
  })
  downloadAvailable: boolean;

  @ApiProperty({ description: 'Estimated total rows for this transfer.' })
  totalRows: number;

  @ApiProperty()
  processedRows: number;

  @ApiProperty({
    description:
      'Rows not written: already present, or referencing an excluded scope.',
  })
  skippedRows: number;

  @ApiProperty({ description: '0–100, clamped to 99 until the job finishes.' })
  percent: number;

  @ApiProperty({
    description: 'Model currently being read or written.',
    nullable: true,
  })
  currentTable: string | null;

  @ApiProperty({
    description: 'Rows transferred per model.',
    example: { sources: 4, findings: 5120 },
  })
  counts: Record<string, number>;

  @ApiProperty({
    description:
      'Operator-facing notes — stripped credentials, skipped rows, version drift.',
    isArray: true,
    type: String,
  })
  warnings: string[];

  @ApiProperty({ nullable: true })
  errorMessage: string | null;

  @ApiProperty()
  cancelRequested: boolean;

  @ApiProperty({ nullable: true })
  startedAt: string | null;

  @ApiProperty({ nullable: true })
  finishedAt: string | null;

  @ApiProperty({
    description: 'When the archive is dropped and stops being downloadable.',
    nullable: true,
  })
  expiresAt: string | null;

  @ApiProperty()
  createdAt: string;
}

export class DataTransferJobListDto {
  @ApiProperty({ type: [DataTransferJobDto] })
  jobs: DataTransferJobDto[];
}

export class DeleteDataTransferJobResponseDto {
  @ApiProperty({ example: true })
  deleted: boolean;
}
