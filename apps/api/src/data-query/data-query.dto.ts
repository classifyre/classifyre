import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueryColumnDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Type as the source or Arrow names it.' })
  type: string;
}

export class QueryCatalogTableDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty({
    description: "The asset's name as the rest of the app shows it.",
  })
  name: string;

  @ApiProperty()
  schema: string;

  @ApiProperty()
  table: string;

  @ApiProperty({
    example: 'shop_lake.shop.orders',
    description: 'What to type in SQL: `<source>.<schema>.<table>`.',
  })
  sqlName: string;

  @ApiProperty({ type: [QueryColumnDto] })
  columns: QueryColumnDto[];

  @ApiProperty({ description: 'The table can be read with SQL at all.' })
  queryable: boolean;

  @ApiProperty({
    description:
      'You may query it now: SQL is on here, it is queryable, and a role or grant gives you access.',
  })
  canQuery: boolean;

  @ApiPropertyOptional({
    description: 'Why it cannot be queried, when it cannot.',
  })
  reason?: string;
}

export class QueryCatalogSourceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  type: string;

  @ApiProperty({ example: 'shop_lake' })
  sqlName: string;

  @ApiProperty()
  queryable: boolean;

  @ApiProperty({ type: [QueryCatalogTableDto] })
  tables: QueryCatalogTableDto[];
}

export class QueryLimitsDto {
  @ApiProperty()
  maxRows: number;

  @ApiProperty()
  timeoutSeconds: number;

  @ApiProperty({ description: 'Rows an export may hold.' })
  exportMaxRows: number;
}

export class QueryCatalogDto {
  @ApiProperty({
    description:
      'You may query every table here; false when only some sources or tables are granted.',
  })
  canQueryAll: boolean;

  @ApiProperty({ type: QueryLimitsDto })
  limits: QueryLimitsDto;

  @ApiProperty({ type: [QueryCatalogSourceDto] })
  sources: QueryCatalogSourceDto[];
}

export class DataQuerySettingsDto {
  @ApiProperty()
  maxRows: number;

  @ApiProperty()
  timeoutSeconds: number;

  @ApiProperty()
  exportMaxRows: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  updatedBy: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  updatedAt: Date | null;
}

export class UpdateDataQuerySettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  maxRows?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 900 })
  timeoutSeconds?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000000 })
  exportMaxRows?: number;
}

export class CreateQueryRunDto {
  @ApiProperty({
    example: 'SELECT * FROM shop_lake.shop.orders LIMIT 100',
    description: 'One SELECT over tables named `<source>.<schema>.<table>`.',
  })
  sql: string;

  @ApiPropertyOptional({
    enum: ['xlsx', 'csv', 'parquet'],
    description:
      'Export the whole result (up to the export row limit) as a file instead of showing rows. Needs data.export.',
  })
  format?: 'xlsx' | 'csv' | 'parquet';
}

export class QueryRunErrorDto {
  @ApiProperty({
    example: 'table_not_available',
    description:
      'invalid_sql, select_only, function_not_allowed, table_name_required, table_not_available, ' +
      'source_unavailable, execution_error, timeout, result_too_large, job_failed, no_result',
  })
  code: string;

  @ApiProperty()
  message: string;
}

export class QueryRunDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sql: string;

  @ApiProperty({
    enum: ['PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'TIMEOUT', 'CANCELLED'],
  })
  status: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  actorRef: string | null;

  @ApiProperty({
    type: [String],
    description: 'The tables it read, as assets.',
  })
  assetIds: string[];

  @ApiPropertyOptional({ nullable: true, type: Number })
  rowCount: number | null;

  @ApiProperty()
  truncated: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '`rows` (the row limit) or `bytes` (the result size limit).',
  })
  truncatedReason: string | null;

  @ApiPropertyOptional({ nullable: true, type: [QueryColumnDto] })
  columns: QueryColumnDto[] | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'setupMs, executeMs, totalMs (inside the job).',
  })
  timings: Record<string, number> | null;

  @ApiPropertyOptional({ nullable: true, type: QueryRunErrorDto })
  error: QueryRunErrorDto | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  resultBytes: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Null for rows shown in the app; xlsx, csv or parquet for an export.',
  })
  resultFormat: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  startedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  finishedAt: Date | null;
}
