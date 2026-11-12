import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GovernanceStatus, LegalBasis } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { GOVERNANCE_ROLES } from './governance-rules';

/** A person or group as the governance screens show it. */
export class GovernancePrincipalDto {
  @ApiProperty({ example: 'user:5c1f…' })
  ref: string;

  @ApiProperty({ enum: ['user', 'group'] })
  kind: 'user' | 'group';

  @ApiProperty({ example: 'Jordan Reyes' })
  displayName: string;

  @ApiPropertyOptional({ example: 'jordan@example.org' })
  email?: string;

  @ApiPropertyOptional({
    description: 'For a group: its path in the tenant.',
    example: '/finance/controlling',
  })
  path?: string;
}

export class GovernanceRoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: GOVERNANCE_ROLES })
  role: string;

  @ApiProperty({ type: GovernancePrincipalDto })
  principal: GovernancePrincipalDto;

  @ApiProperty({
    description: "Set on the asset's source, not on the asset itself.",
  })
  inherited: boolean;

  @ApiProperty()
  dateIn: Date;

  @ApiPropertyOptional({
    description: 'When the role ended; absent while open.',
  })
  dateOut?: Date;

  @ApiPropertyOptional()
  replacedByRef?: string;

  @ApiPropertyOptional()
  assignedBy?: string;

  @ApiPropertyOptional()
  removedBy?: string;
}

export class GovernanceChecklistItemDto {
  @ApiProperty({
    enum: [
      'owner',
      'steward',
      'description',
      'meaning',
      'classification',
      'quality',
      'certified',
    ],
  })
  key: string;

  @ApiProperty()
  done: boolean;
}

export class AssetGovernanceDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty({
    description:
      'Whether someone owns the asset, itself or through its source.',
  })
  governed: boolean;

  @ApiPropertyOptional({
    enum: GovernanceStatus,
    nullable: true,
    description: 'Lifecycle; null while the asset is not governed.',
  })
  status: GovernanceStatus | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  usage: string | null;

  @ApiPropertyOptional({ nullable: true })
  limitations: string | null;

  @ApiPropertyOptional({ enum: LegalBasis, nullable: true })
  legalBasis: LegalBasis | null;

  @ApiPropertyOptional({ nullable: true })
  retention: string | null;

  @ApiPropertyOptional({ nullable: true })
  certifiedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  certifiedBy: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  updatedBy: string | null;

  @ApiProperty({
    type: [GovernanceRoleDto],
    description: 'Open roles that apply: its own, else its source’s.',
  })
  roles: GovernanceRoleDto[];

  @ApiProperty({
    type: [GovernanceRoleDto],
    description: 'Ended roles of the asset, newest first.',
  })
  history: GovernanceRoleDto[];

  @ApiProperty({ type: [GovernanceChecklistItemDto] })
  checklist: GovernanceChecklistItemDto[];

  @ApiProperty({
    description:
      'Whether the caller may change it: asset.govern, or owner or steward of the asset or its source.',
  })
  canGovern: boolean;

  @ApiProperty({
    description:
      'Whether the caller may name owners, stewards and custodians: asset.govern only.',
  })
  canAssignRoles: boolean;
}

export class SourceGovernanceCoverageDto {
  @ApiProperty()
  assets: number;

  @ApiProperty({ description: 'Assets with an owner, own or inherited.' })
  owned: number;

  @ApiProperty({ description: 'Owned assets whose lifecycle is ACTIVE.' })
  active: number;
}

export class SourceGovernanceDto {
  @ApiProperty()
  sourceId: string;

  @ApiProperty({ type: [GovernanceRoleDto] })
  roles: GovernanceRoleDto[];

  @ApiProperty({ type: [GovernanceRoleDto] })
  history: GovernanceRoleDto[];

  @ApiProperty({ type: SourceGovernanceCoverageDto })
  coverage: SourceGovernanceCoverageDto;

  @ApiProperty()
  canGovern: boolean;

  @ApiProperty()
  canAssignRoles: boolean;
}

export class UpdateAssetGovernanceDto {
  @ApiPropertyOptional({ nullable: true, description: 'Markdown.' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  usage?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  limitations?: string | null;

  @ApiPropertyOptional({ enum: LegalBasis, nullable: true })
  @IsOptional()
  @IsEnum(LegalBasis)
  legalBasis?: LegalBasis | null;

  @ApiPropertyOptional({ nullable: true, example: '10 y' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  retention?: string | null;

  @ApiPropertyOptional({
    enum: GovernanceStatus,
    description: 'ACTIVE certifies the asset; it needs an owner.',
  })
  @IsOptional()
  @IsEnum(GovernanceStatus)
  status?: GovernanceStatus;
}

export class AssignGovernanceRoleDto {
  @ApiProperty({ enum: GOVERNANCE_ROLES })
  @IsIn(GOVERNANCE_ROLES)
  role: (typeof GOVERNANCE_ROLES)[number];

  @ApiProperty({
    description:
      '`user:<id>` (owner, steward) or `group:<id>` (steward, custodian).',
  })
  @IsString()
  @MaxLength(200)
  principalRef: string;
}

// ── Columns (G-2) ───────────────────────────────────────────────────────────

const CLASSIFICATION_VALUES = [
  'public',
  'internal',
  'confidential',
  'personal',
  'sensitive',
  'secret',
];

export class ColumnFindingGroupDto {
  @ApiProperty({ example: 'PII' })
  detectorType: string;

  @ApiProperty({ example: 'EMAIL_ADDRESS' })
  findingType: string;

  @ApiProperty()
  count: number;

  @ApiProperty({ enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  maxSeverity: string;
}

export class ColumnTermDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  term: string;

  @ApiProperty()
  status: string;
}

export class AssetColumnDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'As the scan recorded it; empty when unknown.' })
  type: string;

  @ApiPropertyOptional({ nullable: true })
  businessName: string | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ type: ColumnTermDto, nullable: true })
  term: ColumnTermDto | null;

  @ApiProperty({ description: 'ODCS criticalDataElement.' })
  criticalDataElement: boolean;

  @ApiPropertyOptional({
    enum: CLASSIFICATION_VALUES,
    nullable: true,
    description: "A steward's classification; null when derived.",
  })
  classification: string | null;

  @ApiPropertyOptional({
    enum: CLASSIFICATION_VALUES,
    nullable: true,
    description: 'What open findings in this column say.',
  })
  derivedClassification: string | null;

  @ApiPropertyOptional({ enum: CLASSIFICATION_VALUES, nullable: true })
  effectiveClassification: string | null;

  @ApiProperty({ type: [ColumnFindingGroupDto] })
  findings: ColumnFindingGroupDto[];

  @ApiPropertyOptional({ nullable: true })
  reviewedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  reviewedBy: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  updatedBy: string | null;
}

export class AssetColumnsDto {
  @ApiProperty({ type: [AssetColumnDto] })
  columns: AssetColumnDto[];

  @ApiProperty({
    type: [AssetColumnDto],
    description: 'Annotations of columns the last scan no longer has.',
  })
  removed: AssetColumnDto[];

  @ApiProperty({
    description: 'Open findings of a table that name no column.',
  })
  findingsWithoutColumn: number;

  @ApiPropertyOptional({
    description:
      'Whether every column findings classify was reviewed; absent without columns.',
  })
  classificationReviewed?: boolean;

  @ApiProperty()
  canGovern: boolean;
}

export class UpdateAssetColumnDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  businessName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'A glossary term id.' })
  @IsOptional()
  @IsString()
  termId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  criticalDataElement?: boolean;

  @ApiPropertyOptional({
    enum: CLASSIFICATION_VALUES,
    nullable: true,
    description: 'Null returns to the derived classification.',
  })
  @IsOptional()
  classification?: string | null;

  @ApiPropertyOptional({
    description: 'Confirm the classification as it stands.',
  })
  @IsOptional()
  reviewClassification?: boolean;
}

export class MoveAssetColumnDto {
  @ApiProperty({ description: 'The column it became.' })
  @IsString()
  to: string;
}

// ── Usage and summary (G-2) ─────────────────────────────────────────────────

export class UsageDayDto {
  @ApiProperty({ example: '2026-11-12' })
  day: string;

  @ApiProperty()
  reads: number;

  @ApiProperty()
  exports: number;
}

export class UsageReaderDto {
  @ApiProperty()
  actorRef: string;

  @ApiProperty()
  reads: number;

  @ApiProperty()
  exports: number;
}

export class UsageFormatDto {
  @ApiProperty({ example: 'xlsx' })
  format: string;

  @ApiProperty()
  count: number;
}

export class AssetUsageDto {
  @ApiProperty()
  days: number;

  @ApiProperty()
  reads: number;

  @ApiProperty()
  exports: number;

  @ApiProperty({ description: 'Distinct people and tokens.' })
  readers: number;

  @ApiProperty({ type: [UsageDayDto] })
  perDay: UsageDayDto[];

  @ApiProperty({ type: [UsageReaderDto] })
  topReaders: UsageReaderDto[];

  @ApiProperty({ type: [UsageFormatDto] })
  exportsByFormat: UsageFormatDto[];
}

export class GovernanceTotalsDto {
  @ApiProperty()
  assets: number;

  @ApiProperty()
  owned: number;

  @ApiProperty()
  active: number;
}

export class SourceCoverageDto extends GovernanceTotalsDto {
  @ApiProperty()
  sourceId: string;

  @ApiProperty()
  name: string;
}

export class GovernFirstDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty()
  sourceName: string;

  @ApiProperty()
  reads: number;

  @ApiProperty()
  readers: number;
}

export class GovernanceMineDto {
  @ApiProperty({ description: 'Sources and assets you own.' })
  owned: number;

  @ApiProperty({
    description: 'Sources and assets you or your groups steward.',
  })
  stewarded: number;
}

export class GovernanceSummaryDto {
  @ApiProperty()
  days: number;

  @ApiProperty({ type: GovernanceTotalsDto })
  totals: GovernanceTotalsDto;

  @ApiProperty({ type: [SourceCoverageDto] })
  sources: SourceCoverageDto[];

  @ApiProperty({
    type: [GovernFirstDto],
    description:
      'Ungoverned tables read most in the period: govern these first.',
  })
  governFirst: GovernFirstDto[];

  @ApiProperty({ type: GovernanceMineDto })
  mine: GovernanceMineDto;
}

// ── Meaning ─────────────────────────────────────────────────────────────────

export class MeaningTermRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  term: string;

  @ApiProperty({ enum: ['DRAFT', 'APPROVED', 'DEPRECATED'] })
  status: string;

  @ApiPropertyOptional({ nullable: true })
  definition: string | null;
}

export class GovernanceMeaningTermDto {
  @ApiProperty({ type: MeaningTermRefDto })
  term: MeaningTermRefDto;

  @ApiProperty({
    type: [String],
    description: 'MANUAL, BINDING, DECLARED, SUGGESTED, MENTION',
  })
  methods: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'The hand-made link; only these can be removed here.',
  })
  referenceId: string | null;

  @ApiProperty({ description: 'Linked moments ago; still being rolled up.' })
  pending: boolean;
}

export class GovernanceMeaningSuggestionDto {
  @ApiProperty({ type: MeaningTermRefDto })
  term: MeaningTermRefDto;

  @ApiProperty({ enum: ['semantic', 'name', 'column'] })
  source: string;

  @ApiPropertyOptional({ nullable: true })
  suggestionId: string | null;

  @ApiProperty({
    description: 'What it matched: a column, the name, a passage.',
  })
  reason: string;

  @ApiProperty()
  score: number;
}

export class GovernanceMeaningDto {
  @ApiProperty({ type: [GovernanceMeaningTermDto] })
  terms: GovernanceMeaningTermDto[];

  @ApiProperty({ type: [GovernanceMeaningSuggestionDto] })
  suggestions: GovernanceMeaningSuggestionDto[];

  @ApiProperty()
  canGovern: boolean;

  @ApiProperty({ description: 'Whether the caller may create glossary terms.' })
  canEditGlossary: boolean;
}

export class LinkGovernanceTermDto {
  @ApiProperty()
  @IsString()
  termId: string;
}

// ── Quality (G-3) ───────────────────────────────────────────────────────────

const DIMENSION_VALUES = [
  'accuracy',
  'completeness',
  'conformity',
  'consistency',
  'coverage',
  'timeliness',
  'uniqueness',
];
const METRIC_VALUES = [
  'openFindings',
  'rowCount',
  'freshness',
  'nullValues',
  'missingValues',
  'invalidValues',
  'duplicateValues',
  'query',
];
const OPERATOR_VALUES = [
  'mustBe',
  'mustNotBe',
  'mustBeGreaterThan',
  'mustBeGreaterOrEqualTo',
  'mustBeLessThan',
  'mustBeLessOrEqualTo',
  'mustBeBetween',
  'mustNotBeBetween',
];

export class QualityRuleArgumentsDto {
  @ApiPropertyOptional({
    type: 'array',
    items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    description: 'library: values counted as missing besides null.',
  })
  missingValues?: (string | number)[];

  @ApiPropertyOptional({
    type: 'array',
    items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    description: 'library invalidValues: the only values allowed.',
  })
  validValues?: (string | number)[];

  @ApiPropertyOptional({
    description:
      'library invalidValues: a regular expression valid values match.',
  })
  pattern?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'library duplicateValues on the table: columns unique together.',
  })
  properties?: string[];

  @ApiPropertyOptional({
    description:
      'sql: one SELECT returning one number; {object} and {property} are substituted.',
  })
  query?: string;

  @ApiPropertyOptional({ example: 'PII' })
  detectorType?: string;

  @ApiPropertyOptional()
  customDetectorKey?: string;

  @ApiPropertyOptional({ example: 'EMAIL_ADDRESS' })
  findingType?: string;

  @ApiPropertyOptional({ example: 'QUALITY' })
  category?: string;
}

export class QualityResultDto {
  @ApiProperty()
  evaluatedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  measuredValue: number | null;

  @ApiProperty()
  passed: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why it could not be measured; says nothing about the data.',
  })
  error: string | null;
}

export class QualityRuleDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'ODCS id, unique per asset.' })
  key: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  columnName: string | null;

  @ApiProperty({ enum: DIMENSION_VALUES })
  dimension: string;

  @ApiProperty({ enum: ['detector', 'metadata', 'library', 'sql'] })
  type: string;

  @ApiProperty({ enum: METRIC_VALUES })
  metric: string;

  @ApiProperty({ type: QualityRuleArgumentsDto })
  arguments: QualityRuleArgumentsDto;

  @ApiProperty({ enum: OPERATOR_VALUES })
  operator: string;

  @ApiProperty({
    description: 'A number, or [low, high] for the between operators.',
    oneOf: [
      { type: 'number' },
      { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    ],
  })
  threshold: number | [number, number];

  @ApiProperty({ example: 'findings' })
  unit: string;

  @ApiProperty({ enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] })
  severity: string;

  @ApiPropertyOptional({ nullable: true })
  businessImpact: string | null;

  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cron in UTC; null = after each scan and on request.',
  })
  schedule: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdBy: string | null;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: QualityResultDto, nullable: true })
  latest: QualityResultDto | null;

  @ApiProperty({
    type: [QualityResultDto],
    description: 'Oldest first, at most 20.',
  })
  history: QualityResultDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'The open QUALITY finding while the rule fails.',
  })
  findingId: string | null;
}

export class QualityDimensionDto {
  @ApiProperty({ enum: DIMENSION_VALUES })
  dimension: string;

  @ApiPropertyOptional({ nullable: true })
  score: number | null;

  @ApiProperty()
  rules: number;
}

export class AssetQualityDto {
  @ApiProperty({ type: [QualityRuleDto] })
  rules: QualityRuleDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: '0–100 weighted by severity; null until a rule has a result.',
  })
  score: number | null;

  @ApiProperty({ type: [QualityDimensionDto] })
  dimensions: QualityDimensionDto[];

  @ApiProperty()
  failing: number;

  @ApiPropertyOptional({ nullable: true })
  lastEvaluatedAt: Date | null;

  @ApiProperty({
    description: 'A whole-table query for its rules is still out.',
  })
  measuring: boolean;

  @ApiProperty()
  canGovern: boolean;
}

export class SaveQualityRuleDto {
  @ApiPropertyOptional({ description: 'Derived from the name when absent.' })
  key?: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  columnName?: string | null;

  @ApiProperty({ enum: DIMENSION_VALUES })
  dimension: string;

  @ApiProperty({ enum: ['detector', 'metadata', 'library', 'sql'] })
  type: string;

  @ApiProperty({ enum: METRIC_VALUES })
  metric: string;

  @ApiPropertyOptional({ type: QualityRuleArgumentsDto })
  arguments?: QualityRuleArgumentsDto;

  @ApiPropertyOptional({
    enum: ['rows', 'percent'],
    description: 'library counts: rows (default) or percent of the rows.',
  })
  unit?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'hourly, daily, weekly or a 5-field cron (UTC, at most hourly); null = after each scan.',
  })
  schedule?: string | null;

  @ApiProperty({ enum: OPERATOR_VALUES })
  operator: string;

  @ApiProperty({
    oneOf: [
      { type: 'number' },
      { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    ],
  })
  threshold: number | [number, number];

  @ApiPropertyOptional({ enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] })
  severity?: string;

  @ApiPropertyOptional({ nullable: true })
  businessImpact?: string | null;

  @ApiPropertyOptional()
  enabled?: boolean;
}

// ── ODCS contract (G-4) ─────────────────────────────────────────────────────

export class ImportContractDto {
  @ApiProperty({ description: 'The contract as YAML or JSON text.' })
  @IsString()
  contract: string;
}

export class ContractAppliedDto {
  @ApiProperty()
  governance: boolean;

  @ApiProperty()
  members: number;

  @ApiProperty()
  columns: number;

  @ApiProperty()
  rules: number;
}

export class ContractSkippedDto {
  @ApiProperty({ example: 'schema.properties: notes' })
  path: string;

  @ApiProperty()
  reason: string;
}

export class ContractImportResultDto {
  @ApiProperty({ type: ContractAppliedDto })
  applied: ContractAppliedDto;

  @ApiProperty({ type: [ContractSkippedDto] })
  skipped: ContractSkippedDto[];
}
