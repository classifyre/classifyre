import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CaseStatus, InquiryStatus, Severity } from '@prisma/client';

export class CreateCaseDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: CaseStatus, default: CaseStatus.OPEN })
  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  @ApiPropertyOptional({ enum: Severity, default: Severity.MEDIUM })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({ type: [String], description: 'Link these questions to the new case (guides)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  inquiryIds?: string[];
}

export class UpdateCaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: CaseStatus })
  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  @ApiPropertyOptional({ enum: Severity })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conclusion?: string;
}

export class QueryCasesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: CaseStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(CaseStatus, { each: true })
  status?: CaseStatus[];

  @ApiPropertyOptional({ enum: Severity, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Severity, { each: true })
  severity?: Severity[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

/** Add an asset as evidence to a case. EntityType must be "asset". */
export class AddEvidenceDto {
  @ApiProperty({ description: 'Entity kind — must be "asset"' })
  @IsString()
  entityType!: string;

  @ApiProperty({ description: 'Asset UUID' })
  @IsString()
  entityId!: string;

  @ApiPropertyOptional({ description: 'Hypothesis UUIDs to link this evidence to (optional)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hypothesisIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addedBy?: string;
}

/** Attach a finding (inferred observation) to a piece of evidence in a case. */
export class AddFindingDto {
  @ApiProperty({ description: 'Finding UUID' })
  @IsString()
  findingId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/** Update the analyst note on an evidence row. */
export class UpdateEvidenceNoteDto {
  @ApiPropertyOptional({ description: 'Analyst note. Pass null or empty string to clear.' })
  @IsOptional()
  @IsString()
  note?: string | null;
}

/** Update the analyst note on a case finding row. */
export class UpdateCaseFindingNoteDto {
  @ApiPropertyOptional({ description: 'Analyst note. Pass null or empty string to clear.' })
  @IsOptional()
  @IsString()
  note?: string | null;
}

/** Pull a question's current matches into the case as evidence + findings. */
export class PullFromInquiryDto {
  @ApiProperty({ description: 'Question to pull matches from' })
  @IsString()
  inquiryId!: string;

  @ApiPropertyOptional({ type: [String], description: 'Specific finding IDs (omit = all current matches)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findingIds?: string[];
}

export class PullFromInquiryResponseDto {
  @ApiProperty({ description: 'Number of findings pulled into the case' })
  pulled!: number;
}

/** Resolved display info for an evidence node. */
export class EvidenceEntityDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiPropertyOptional()
  assetType?: string;

  @ApiPropertyOptional()
  sourceType?: string;
}

/** A resolved finding attached to a piece of case evidence. */
export class CaseFindingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseEvidenceId!: string;

  @ApiProperty()
  findingId!: string;

  @ApiProperty({ description: 'Finding type label (e.g. "Contains PII")' })
  findingLabel!: string;

  @ApiPropertyOptional()
  severity?: string;

  @ApiPropertyOptional()
  detectorType?: string;

  @ApiPropertyOptional({ description: 'Human-readable name for custom detectors (snapshotted at attach time)' })
  customDetectorName?: string | null;

  @ApiPropertyOptional({ description: 'Matched content snippet snapshotted from the finding at attach time' })
  matchedContent?: string | null;

  @ApiPropertyOptional()
  note?: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class CaseEvidenceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  entityType!: string;

  @ApiProperty()
  entityId!: string;

  @ApiPropertyOptional()
  note?: string | null;

  @ApiPropertyOptional()
  addedBy?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ type: EvidenceEntityDto, nullable: true })
  entity?: EvidenceEntityDto | null;

  @ApiPropertyOptional({ type: [CaseFindingDto] })
  findings?: CaseFindingDto[];
}

/** A question linked to a case (guides which findings are relevant). */
export class CaseLinkedInquiryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: InquiryStatus })
  status!: InquiryStatus;

  @ApiProperty({ description: 'Findings currently matching this question' })
  matchCount!: number;
}

export class CaseResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ enum: CaseStatus })
  status!: CaseStatus;

  @ApiProperty({ enum: Severity })
  severity!: Severity;

  @ApiPropertyOptional()
  assignee?: string | null;

  @ApiPropertyOptional()
  createdBy?: string | null;

  @ApiPropertyOptional()
  conclusion?: string | null;

  @ApiProperty()
  evidenceCount!: number;

  @ApiProperty()
  hypothesisCount!: number;

  @ApiProperty()
  inquiryCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ type: [CaseEvidenceDto] })
  evidence?: CaseEvidenceDto[];

  @ApiPropertyOptional({ type: [CaseLinkedInquiryDto] })
  inquiries?: CaseLinkedInquiryDto[];
}

export class CaseListResponseDto {
  @ApiProperty({ type: [CaseResponseDto] })
  items!: CaseResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  limit!: number;
}
