import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Which of a source's assets to retire.
 *
 * Every field is optional and they AND together. Omitting all of them means
 * "every asset of this source", which is what this endpoint has always done —
 * the predicate is an addition, not a change of default.
 *
 * This exists because a connector that narrows its scope leaves orphans no
 * scan can ever clear: retirement requires a run that covered the whole scope
 * and found the asset gone, and a rotating-sample connector never has one. Ask
 * with `dryRun` first; the response reports what matched and echoes back the
 * predicate the server understood.
 */
export class PurgeSourceAssetsQueryDto {
  @ApiPropertyOptional({
    description:
      'Retire assets whose connector-assigned id (metadata.external_id — a ' +
      "notebook's own Asset(id=...)) starts with this. The natural handle for " +
      "'everything the old connector made', e.g. 'fin-'.",
    example: 'fin-',
  })
  @IsOptional()
  @IsString()
  externalIdPrefix?: string;

  @ApiPropertyOptional({
    description:
      'Retire assets of one catalog kind only (record, document, page, file, table).',
    example: 'record',
  })
  @IsOptional()
  @IsString()
  assetKind?: string;

  @ApiPropertyOptional({
    description: 'Retire assets whose display name starts with this.',
  })
  @IsOptional()
  @IsString()
  namePrefix?: string;

  @ApiPropertyOptional({
    description: 'Retire assets whose URN starts with this.',
    example: 'document://at/firmenbuch/',
  })
  @IsOptional()
  @IsString()
  urnPrefix?: string;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp. Retire assets last scanned before it, and assets ' +
      'never scanned at all — an asset ingested before scan tracking existed ' +
      'is exactly the leftover this is for.',
    example: '2026-08-01T00:00:00Z',
  })
  @IsOptional()
  @IsString()
  notScannedSince?: string;

  @ApiPropertyOptional({
    description:
      'Report what the predicate matches and delete nothing. Always worth one ' +
      'call before an irreversible one.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class PurgeSourceAssetsResponseDto {
  @ApiProperty({
    description: 'Assets actually deleted. Always 0 for a dry run.',
  })
  purgedAssets: number;

  @ApiProperty({
    description:
      'Assets the predicate selected. Equals purgedAssets outside a dry run.',
  })
  matchedAssets: number;

  @ApiProperty({ description: 'Whether this call deleted anything.' })
  dryRun: boolean;

  @ApiProperty({
    description:
      'The predicate the server understood, field by field. Empty means the ' +
      'whole source was targeted. Compare it against what you sent: an ' +
      'unrecognised parameter is rejected, never silently dropped.',
    type: 'object',
    additionalProperties: true,
  })
  predicate: Record<string, unknown>;
}
