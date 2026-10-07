import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CaseFindingFilterKind, EvidenceStance } from '@prisma/client';

// ─── Hypothesis rules ─────────────────────────────────────────────────────────

export class CaseHypothesisRuleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The linked watch (inquiry) this rule handles' })
  inquiryId!: string;

  @ApiPropertyOptional({ nullable: true })
  inquiryTitle?: string | null;

  @ApiProperty({ description: 'The hypothesis (thread) answers are linked to' })
  threadId!: string;

  @ApiPropertyOptional({ nullable: true })
  threadTitle?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "The hypothesis's own status, for display",
  })
  threadStatus?: string | null;

  @ApiProperty({
    enum: EvidenceStance,
    description:
      'SUPPORTS: the answer speaks for the hypothesis. CONTRADICTS: against it. NEUTRAL: related, neither.',
  })
  stance!: EvidenceStance;

  @ApiPropertyOptional({
    enum: CaseFindingFilterKind,
    nullable: true,
    description:
      'Null together with `pattern`: the rule takes every answer of the watch.',
  })
  kind?: CaseFindingFilterKind | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'FINDING_TYPE: the finding type, exactly. VALUE_PATTERN: a regular expression over the matched value.',
  })
  pattern?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({
    description: 'How many links in the case this rule made and still holds',
  })
  linkCount!: number;

  @ApiPropertyOptional({ nullable: true })
  createdBy?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class AddCaseHypothesisRuleDto {
  @ApiProperty({ description: 'A watch already linked to the case' })
  @IsString()
  inquiryId!: string;

  @ApiProperty({ description: 'A hypothesis thread of the case' })
  @IsString()
  threadId!: string;

  @ApiPropertyOptional({
    enum: EvidenceStance,
    default: EvidenceStance.SUPPORTS,
  })
  @IsOptional()
  @IsEnum(EvidenceStance)
  stance?: EvidenceStance;

  @ApiPropertyOptional({
    enum: CaseFindingFilterKind,
    nullable: true,
    description: 'Narrow the rule to some answers; needs `pattern` too.',
  })
  @IsOptional()
  @IsEnum(CaseFindingFilterKind)
  kind?: CaseFindingFilterKind | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pattern?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Also link what the case already holds from this watch (its current answers that are in the case and match the rule). Links a person made are never changed.',
  })
  @IsOptional()
  @IsBoolean()
  applyToExisting?: boolean;
}

export class UpdateCaseHypothesisRuleDto {
  @ApiPropertyOptional({ description: 'Move the rule to another hypothesis' })
  @IsOptional()
  @IsString()
  threadId?: string;

  @ApiPropertyOptional({ enum: EvidenceStance })
  @IsOptional()
  @IsEnum(EvidenceStance)
  stance?: EvidenceStance;

  @ApiPropertyOptional({ enum: CaseFindingFilterKind, nullable: true })
  @IsOptional()
  @IsEnum(CaseFindingFilterKind)
  kind?: CaseFindingFilterKind | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pattern?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({
    default: true,
    description:
      'When the stance or the hypothesis changes: carry the links this rule already made along. Off leaves them as they are.',
  })
  @IsOptional()
  @IsBoolean()
  updateLinks?: boolean;
}

export class CaseHypothesisRulesChangeResponseDto {
  @ApiProperty({ type: [CaseHypothesisRuleDto] })
  rules!: CaseHypothesisRuleDto[];

  @ApiProperty({
    description: 'Links made, moved or taken away by this change',
  })
  linked!: number;
}

export class CaseHypothesisRuleRemovalResponseDto {
  @ApiProperty({ type: [CaseHypothesisRuleDto] })
  rules!: CaseHypothesisRuleDto[];

  @ApiProperty({
    description: 'Links the rule had made that were taken away with it',
  })
  unlinked!: number;
}

// ─── Deleting a hypothesis ────────────────────────────────────────────────────

export class ThreadRemovalPreviewDto {
  @ApiProperty({
    description:
      'Findings of the case linked to the hypothesis (directly or through their asset)',
  })
  linkedFindings!: number;

  @ApiProperty({ description: 'Assets of the case linked to the hypothesis' })
  linkedAssets!: number;

  @ApiProperty({
    description:
      'Findings that would leave the case with the hypothesis: not linked to another hypothesis and without a note',
  })
  removableFindings!: number;

  @ApiProperty({
    description:
      'Assets that would leave the case: every finding of theirs leaves too and they carry no note',
  })
  removableAssets!: number;

  @ApiProperty({
    description:
      'Findings that stay because another hypothesis is linked to them too',
  })
  keptShared!: number;

  @ApiProperty({
    description: 'Findings and assets that stay because someone wrote a note',
  })
  keptNoted!: number;

  @ApiProperty({
    description: 'Hypothesis rules that go with the hypothesis',
  })
  rules!: number;
}

export class ThreadRemovalResultDto {
  @ApiProperty()
  deleted!: boolean;

  @ApiProperty({ description: 'Findings taken out of the case with it' })
  findingsRemoved!: number;

  @ApiProperty({ description: 'Assets taken out of the case with it' })
  assetsRemoved!: number;
}
