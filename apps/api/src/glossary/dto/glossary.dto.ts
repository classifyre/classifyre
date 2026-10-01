import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  GlossaryEntityType,
  GlossaryOrigin,
  GlossaryRelationType,
  GlossaryStatus,
  GlossaryTermKind,
} from '@prisma/client';

export class ListGlossaryQueryDto {
  @ApiPropertyOptional({
    description:
      'Free-text filter over term, key, aliases, codes, definition and notes.',
  })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ enum: GlossaryEntityType })
  @IsOptional()
  @IsEnum(GlossaryEntityType)
  entityType?: GlossaryEntityType;

  @ApiPropertyOptional({ enum: GlossaryTermKind })
  @IsOptional()
  @IsEnum(GlossaryTermKind)
  kind?: GlossaryTermKind;

  @ApiPropertyOptional({
    description: 'Scheme id, or "none" for terms without a scheme.',
  })
  @IsOptional()
  @IsString()
  schemeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  schemeKey?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated statuses (DRAFT, APPROVED, DEPRECATED).',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  steward?: string;

  @ApiPropertyOptional({ default: 25, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number = 25;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;
}

export class LookupGlossaryQueryDto {
  @ApiProperty({ description: 'Name, alias, code or hidden alias to resolve.' })
  @IsString()
  query!: string;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({ enum: GlossaryTermKind })
  @IsOptional()
  @IsEnum(GlossaryTermKind)
  kind?: GlossaryTermKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  schemeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  schemeKey?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated statuses; default DRAFT,APPROVED.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  includeDeprecated?: string;
}

export class UpsertGlossaryTermDto {
  @ApiPropertyOptional({
    description: 'Existing row ID when editing or renaming',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  term!: string;

  @ApiPropertyOptional({
    enum: GlossaryTermKind,
    description: 'CONCEPT (business term) or ENTITY (named thing).',
  })
  @IsOptional()
  @IsEnum(GlossaryTermKind)
  kind?: GlossaryTermKind;

  @ApiPropertyOptional({
    description:
      'Stable key (C8). Accepted on edit only; the old key keeps resolving.',
  })
  @IsOptional()
  @IsString()
  key?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Exact notations (GES, PKS 725000). Case is significant.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  codes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Lookup-only spellings, never matched in text.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  hiddenAliases?: string[];

  @ApiPropertyOptional({ description: 'Markdown, up to 10,000 characters.' })
  @IsOptional()
  @IsString()
  definition?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  schemeId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  schemeKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  steward?: string | null;

  @ApiPropertyOptional({ enum: GlossaryStatus })
  @IsOptional()
  @IsEnum(GlossaryStatus)
  status?: GlossaryStatus;

  @ApiPropertyOptional({ enum: GlossaryEntityType })
  @IsOptional()
  @IsEnum(GlossaryEntityType)
  entityType?: GlossaryEntityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({
    description:
      'Create a new ENTITY even when one with the same name exists (two people called Jane Doe are two entities).',
  })
  @IsOptional()
  @IsBoolean()
  createNew?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refId?: string;

  @ApiPropertyOptional({
    description:
      'Operator identity recorded as approver. Defaults to the X-Actor-Name header or "operator".',
  })
  @IsOptional()
  @IsString()
  author?: string;
}

export class BulkUpdateGlossaryFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ enum: GlossaryEntityType })
  @IsOptional()
  @IsEnum(GlossaryEntityType)
  entityType?: GlossaryEntityType;

  @ApiPropertyOptional({ enum: GlossaryTermKind })
  @IsOptional()
  @IsEnum(GlossaryTermKind)
  kind?: GlossaryTermKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  schemeId?: string;

  @ApiPropertyOptional({ enum: GlossaryStatus, isArray: true })
  @IsOptional()
  @IsArray()
  status?: GlossaryStatus[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  steward?: string;
}

export class BulkUpdateGlossaryTermsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({ type: BulkUpdateGlossaryFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkUpdateGlossaryFiltersDto)
  filters?: BulkUpdateGlossaryFiltersDto;

  @ApiPropertyOptional({
    description:
      'True approves the selected terms, false returns them to DRAFT (kept for compatibility; prefer status).',
  })
  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional({ enum: GlossaryStatus })
  @IsOptional()
  @IsEnum(GlossaryStatus)
  status?: GlossaryStatus;

  @ApiPropertyOptional({ enum: GlossaryEntityType })
  @IsOptional()
  @IsEnum(GlossaryEntityType)
  entityType?: GlossaryEntityType;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null clears the scheme',
  })
  @IsOptional()
  schemeId?: string | null;

  @ApiPropertyOptional({ enum: GlossaryTermKind })
  @IsOptional()
  @IsEnum(GlossaryTermKind)
  kind?: GlossaryTermKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verifiedBy?: string;
}

export class BulkUpdateGlossaryTermsResponseDto {
  @ApiProperty()
  updatedCount!: number;

  @ApiProperty({ type: [String] })
  ids!: string[];

  @ApiPropertyOptional({ type: [Object] })
  refused?: Array<{ id: string; reason: string }>;
}

export class GlossarySchemeRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  color?: string | null;
}

export class GlossaryTermDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Stable key (C8).' })
  key!: string;

  @ApiProperty({ type: [String] })
  previousKeys!: string[];

  @ApiProperty()
  term!: string;

  @ApiProperty({ enum: GlossaryTermKind })
  kind!: GlossaryTermKind;

  @ApiProperty({ enum: GlossaryStatus })
  status!: GlossaryStatus;

  @ApiProperty({ type: [String] })
  aliases!: string[];

  @ApiProperty({ type: [String] })
  codes!: string[];

  @ApiProperty({ type: [String] })
  hiddenAliases!: string[];

  @ApiProperty({
    type: [String],
    description: 'Unverified aliases suggested by agents for operator review',
  })
  proposedAliases!: string[];

  @ApiPropertyOptional({ nullable: true })
  definition?: string | null;

  @ApiProperty({ enum: GlossaryEntityType })
  entityType!: GlossaryEntityType;

  @ApiPropertyOptional({ nullable: true })
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  steward?: string | null;

  @ApiPropertyOptional({ nullable: true })
  schemeId?: string | null;

  @ApiPropertyOptional({ type: GlossarySchemeRefDto, nullable: true })
  scheme?: GlossarySchemeRefDto | null;

  @ApiPropertyOptional({ nullable: true })
  replacedById?: string | null;

  @ApiPropertyOptional({ nullable: true })
  deprecatedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  sourceIri?: string | null;

  @ApiPropertyOptional({ nullable: true })
  packKey?: string | null;

  @ApiProperty({ description: 'AGENT proposals are DRAFT hypotheses' })
  origin!: string;

  @ApiProperty({ description: 'True when APPROVED (kept for compatibility).' })
  verified!: boolean;

  @ApiPropertyOptional({ nullable: true })
  verifiedBy?: string | null;

  @ApiPropertyOptional({ nullable: true })
  approvedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class UpsertGlossaryTermResponseDto extends GlossaryTermDto {
  @ApiPropertyOptional({
    description:
      'True when an agent alias proposal was stored for an operator-owned term',
  })
  merged?: boolean;
}

export class GlossaryListResponseDto {
  @ApiProperty({ type: [GlossaryTermDto] })
  terms!: GlossaryTermDto[];

  @ApiProperty()
  total!: number;
}

export class GlossaryLookupHitDto extends GlossaryTermDto {
  @ApiProperty({
    enum: ['exact', 'alias', 'partial', 'semantic'],
    description:
      'Compatibility tier; `matchedOn` says precisely which label matched.',
  })
  matchType!: 'exact' | 'alias' | 'partial' | 'semantic';

  @ApiProperty({ enum: ['term', 'alias', 'code', 'hiddenAlias', 'semantic'] })
  matchedOn!: 'term' | 'alias' | 'code' | 'hiddenAlias' | 'semantic';

  @ApiProperty()
  deprecated!: boolean;

  @ApiPropertyOptional({ type: Object, nullable: true })
  replacedBy?: { id: string; key: string; term: string } | null;

  @ApiPropertyOptional({ minimum: -1, maximum: 1 })
  similarity?: number;
}

export class DeleteGlossaryTermResponseDto {
  @ApiProperty()
  deleted!: boolean;

  @ApiProperty()
  id!: string;
}

export class VerifyGlossaryTermDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verifiedBy?: string;
}

export class DeprecateGlossaryTermDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Successor: an APPROVED term of the same kind (id or key).',
  })
  @IsOptional()
  @IsString()
  replacedById?: string | null;
}

export class UpsertGlossarySchemeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  key?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string | null;
}

export class GlossarySchemeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  color?: string | null;

  @ApiProperty({ enum: GlossaryOrigin })
  origin!: GlossaryOrigin;

  @ApiPropertyOptional({ nullable: true })
  packKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  packVersion?: string | null;

  @ApiProperty()
  termCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CreateGlossaryRelationDto {
  @ApiProperty({ description: 'Term id or key' })
  @IsString()
  from!: string;

  @ApiProperty({ description: 'Term id or key' })
  @IsString()
  to!: string;

  @ApiProperty({ enum: GlossaryRelationType })
  @IsEnum(GlossaryRelationType)
  type!: GlossaryRelationType;

  @ApiPropertyOptional({ description: 'The verb, for CUSTOM' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class GlossaryImportDto {
  @ApiProperty({ enum: ['csv', 'skos'] })
  @IsIn(['csv', 'skos'])
  format!: 'csv' | 'skos';

  @ApiProperty({ description: 'The file content (UTF-8 text).' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    enum: ['skip', 'overwrite', 'merge-labels'],
    default: 'skip',
  })
  @IsOptional()
  @IsIn(['skip', 'overwrite', 'merge-labels'])
  conflict?: 'skip' | 'overwrite' | 'merge-labels';

  @ApiPropertyOptional({ description: 'SKOS: preferred label language.' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  asDraft?: boolean;

  @ApiPropertyOptional({ description: 'Import into this scheme.' })
  @IsOptional()
  @IsString()
  schemeKey?: string;
}
