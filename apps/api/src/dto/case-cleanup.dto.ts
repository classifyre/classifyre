import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CaseFindingFilterKind, CaseFindingRuleAction } from '@prisma/client';

// ─── Clean-up rules ───────────────────────────────────────────────────────────

/** The three clean-up switches, as sent to the preview. */
export class CaseCleanupRulesDto {
  @ApiPropertyOptional({
    description:
      'Take out findings the scans no longer see (retired by a run, or deleted).',
  })
  @IsOptional()
  @IsBoolean()
  removeGoneFindings?: boolean;

  @ApiPropertyOptional({ description: 'Take out findings someone resolved.' })
  @IsOptional()
  @IsBoolean()
  removeResolvedFindings?: boolean;

  @ApiPropertyOptional({
    description:
      'Take out assets deleted from their source, with their findings.',
  })
  @IsOptional()
  @IsBoolean()
  removeGoneAssets?: boolean;
}

/** One finding or asset a rule or filter would take out (or took out). */
export class CaseCleanupItemDto {
  @ApiProperty({
    enum: [
      'FINDING_GONE',
      'FINDING_RESOLVED',
      'FILTER',
      'ASSET_GONE',
      'FILTER_EMPTIED',
      'EMPTIED',
    ],
    description:
      'FILTER_EMPTIED: an asset a filter left without any finding in the case. ' +
      'EMPTIED: an asset the clean-up rules left without any finding (one that ' +
      'carries a note stays)',
  })
  reason!:
    | 'FINDING_GONE'
    | 'FINDING_RESOLVED'
    | 'FILTER'
    | 'ASSET_GONE'
    | 'FILTER_EMPTIED'
    | 'EMPTIED';

  @ApiPropertyOptional({
    enum: ['RETIRED', 'DELETED'],
    description:
      'For something gone: retired by a scan, or its row deleted outright.',
  })
  state?: 'RETIRED' | 'DELETED';

  @ApiProperty({ description: 'Finding type, or the asset name' })
  label!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Matched value' })
  value?: string | null;

  @ApiPropertyOptional({ nullable: true })
  assetLabel?: string | null;

  @ApiPropertyOptional({ description: 'The filter that matched (FILTER)' })
  filterId?: string;
}

export class CaseCleanupPreviewDto {
  @ApiProperty({
    description: 'Findings the scans no longer see that would leave the case',
  })
  goneFindings!: number;

  @ApiProperty({ description: 'Resolved findings that would leave the case' })
  resolvedFindings!: number;

  @ApiProperty({
    description: 'Assets gone from their source that would leave',
  })
  goneAssets!: number;

  @ApiProperty({ description: 'Findings that would leave with those assets' })
  findingsWithAssets!: number;

  @ApiProperty({ type: [CaseCleanupItemDto], description: 'A few of them' })
  sample!: CaseCleanupItemDto[];
}

/** What one clean-up pass took out. */
export class CaseCleanupResultDto {
  @ApiProperty()
  findingsRemoved!: number;

  @ApiProperty()
  evidenceRemoved!: number;

  @ApiProperty({ description: 'Findings that left with the removed evidence' })
  findingsWithEvidence!: number;
}

// ─── Finding filters ──────────────────────────────────────────────────────────

export class CaseFindingFilterDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CaseFindingFilterKind })
  kind!: CaseFindingFilterKind;

  @ApiProperty({
    enum: CaseFindingRuleAction,
    description:
      'EXCLUDE: a filter (matches leave the case and are not pulled again). ESCALATE: matches are marked escalated and highlighted, and a watch brings them in even with auto-add off.',
  })
  action!: CaseFindingRuleAction;

  @ApiProperty({
    description:
      'FINDING_TYPE: the finding type, exactly. VALUE_PATTERN: a regular expression over the matched value.',
  })
  pattern!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Null: case-wide (every watch, and the case's own findings). Otherwise the one watch it applies to.",
  })
  inquiryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  inquiryTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdBy?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CaseFindingFilterRuleDto {
  @ApiProperty({ enum: CaseFindingFilterKind })
  @IsEnum(CaseFindingFilterKind)
  kind!: CaseFindingFilterKind;

  @ApiProperty({ description: 'Finding type, or a regular expression' })
  @IsString()
  @MaxLength(500)
  pattern!: string;

  @ApiPropertyOptional({ description: 'Why the filter exists' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class AddCaseFindingFiltersDto {
  @ApiPropertyOptional({
    enum: CaseFindingRuleAction,
    default: CaseFindingRuleAction.EXCLUDE,
    description: 'What the rules do: filter out (default) or escalate',
  })
  @IsOptional()
  @IsEnum(CaseFindingRuleAction)
  action?: CaseFindingRuleAction;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Scope: omit or null for the whole case, or a linked inquiry id to filter only that watch',
  })
  @IsOptional()
  @IsString()
  inquiryId?: string | null;

  @ApiProperty({ type: [CaseFindingFilterRuleDto] })
  @IsArray()
  rules!: CaseFindingFilterRuleDto[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Filters only: also take out of the case every asset the filter leaves without a finding in it. ' +
      'An asset that had no finding in the case to begin with is left alone.',
  })
  @IsOptional()
  @IsBoolean()
  removeEmptiedAssets?: boolean;

  @ApiPropertyOptional({
    description:
      'The board tab asking, so it can ignore the echo of its own change',
  })
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class UpdateCaseFindingFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pattern?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Filters only: also take out of the case every asset the filter leaves without a finding in it. ' +
      'An asset that had no finding in the case to begin with is left alone.',
  })
  @IsOptional()
  @IsBoolean()
  removeEmptiedAssets?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class CaseFindingFiltersChangeResponseDto {
  @ApiProperty({ type: [CaseFindingFilterDto] })
  filters!: CaseFindingFilterDto[];

  @ApiProperty({
    description: 'Findings the change took out of the case (filters)',
  })
  detached!: number;

  @ApiProperty({
    description:
      'Findings already in the case the change marked escalated (escalations)',
  })
  escalated!: number;

  @ApiProperty({
    description:
      'Assets taken out because the filter left them without a finding (removeEmptiedAssets)',
  })
  assetsRemoved!: number;
}

export class PreviewCaseFindingFiltersDto {
  @ApiPropertyOptional({
    enum: CaseFindingRuleAction,
    default: CaseFindingRuleAction.EXCLUDE,
  })
  @IsOptional()
  @IsEnum(CaseFindingRuleAction)
  action?: CaseFindingRuleAction;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  inquiryId?: string | null;

  @ApiProperty({ type: [CaseFindingFilterRuleDto] })
  @IsArray()
  rules!: CaseFindingFilterRuleDto[];
}

export class CaseFindingFiltersPreviewDto {
  @ApiProperty({
    description:
      'Findings in the case these rules would take out (filters) or mark escalated (escalations) now',
  })
  matched!: number;

  @ApiProperty({
    type: [Number],
    description: 'Per rule, in request order: findings it alone would match',
  })
  perRule!: number[];

  @ApiProperty({
    type: [String],
    description:
      'Per rule, in request order: why it cannot be saved, or an empty string',
  })
  problems!: string[];

  @ApiProperty({ type: [CaseCleanupItemDto], description: 'A few of them' })
  sample!: CaseCleanupItemDto[];

  @ApiProperty({
    description:
      'Filters only: assets these rules would leave without a finding in the case',
  })
  emptiedAssets!: number;

  @ApiProperty({
    type: [String],
    description: 'Names of a few of those assets',
  })
  emptiedSample!: string[];
}

/** A finding type the scope detects, for the filter picker. */
export class CaseFindingTypeOptionDto {
  @ApiProperty()
  findingType!: string;

  @ApiPropertyOptional({ nullable: true })
  detectorType?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Custom detector name, when the type comes from one',
  })
  detectorName?: string | null;

  @ApiProperty({ description: 'Findings of this type in the case now' })
  inCase!: number;

  @ApiProperty({
    description: 'Open findings of this type the scope’s watches answer',
  })
  answers!: number;
}

export class CaseFindingFilterOptionsDto {
  @ApiProperty({ type: [CaseFindingTypeOptionDto] })
  types!: CaseFindingTypeOptionDto[];

  @ApiProperty({
    description:
      'The watch answer counts are an estimate (a value pattern could not be applied to every row)',
  })
  approximate!: boolean;
}

// ─── Escalations ──────────────────────────────────────────────────────────────

export class ClearCaseEscalationsDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Finding ids (not case-finding ids) to clear; omit to clear every escalation of the case',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findingIds?: string[];
}

export class ClearCaseEscalationsResponseDto {
  @ApiProperty({ description: 'Findings whose escalation mark was cleared' })
  cleared!: number;
}
