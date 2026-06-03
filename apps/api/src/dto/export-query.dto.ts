import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  AssetStatus,
  AssetType,
  DetectorType,
  FindingStatus,
  RunnerAssetStatus,
  Severity,
} from '@prisma/client';

/**
 * Flat GET query DTOs for the streaming CSV export endpoints. They intentionally
 * mirror the field semantics of the existing POST search DTOs
 * (search-findings-request.dto.ts, search-assets-request.dto.ts,
 * search-runners-assets-request.dto.ts) but are flattened so the browser can
 * trigger a native download via an anchor href with query params.
 */
const normalizeToStringArray = (
  value: unknown,
  uppercase = false,
): string[] => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const values = raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => (uppercase ? item.toUpperCase() : item));

  return Array.from(new Set(values));
};

const toBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === '1';

export class ExportFindingsQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @IsString({ each: true })
  sourceId?: string[];

  @ApiPropertyOptional({ enum: DetectorType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(DetectorType, { each: true })
  detectorType?: DetectorType[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @IsString({ each: true })
  customDetectorKey?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @IsString({ each: true })
  findingType?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @IsString({ each: true })
  category?: string[];

  @ApiPropertyOptional({ enum: Severity, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(Severity, { each: true })
  severity?: Severity[];

  @ApiPropertyOptional({ enum: FindingStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(FindingStatus, { each: true })
  status?: FindingStatus[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeResolved?: boolean = false;
}

export class ExportAssetsQueryDto {
  // ── Asset filters (asset_* prefix) ───────────────────────────────────────
  @ApiPropertyOptional({ description: 'Search asset name / url / hash' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  asset_search?: string;

  @ApiPropertyOptional({ description: 'Single source id filter' })
  @IsOptional()
  @IsString()
  asset_sourceId?: string;

  @ApiPropertyOptional({ enum: AssetStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(AssetStatus, { each: true })
  asset_status?: AssetStatus[];

  @ApiPropertyOptional({ enum: AssetType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(AssetType, { each: true })
  asset_sourceType?: AssetType[];

  // ── Finding filters (finding_* prefix) ───────────────────────────────────
  @ApiPropertyOptional({ enum: DetectorType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(DetectorType, { each: true })
  finding_detectorType?: DetectorType[];

  @ApiPropertyOptional({ enum: Severity, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(Severity, { each: true })
  finding_severity?: Severity[];

  @ApiPropertyOptional({ enum: FindingStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(FindingStatus, { each: true })
  finding_status?: FindingStatus[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  finding_includeResolved?: boolean = false;

  // ── Options ──────────────────────────────────────────────────────────────
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  excludeFindings?: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeAssetsWithoutFindings?: boolean = false;
}

export class LiveQueryResponseDto {
  @ApiProperty({
    description:
      'Page of result rows. Each row is a flat object keyed by column name.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  items!: Record<string, unknown>[];

  @ApiProperty({
    description:
      'Opaque cursor for the next page, or null when this is the last page. ' +
      'Pass it back as the `cursor` query param to fetch the next page.',
    type: String,
    nullable: true,
  })
  nextCursor!: string | null;
}

export class ExportRunnerAssetsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  runnerId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: RunnerAssetStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(RunnerAssetStatus, { each: true })
  status?: RunnerAssetStatus[];
}
