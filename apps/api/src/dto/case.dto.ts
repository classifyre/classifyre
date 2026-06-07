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
import { CaseStatus, Severity } from '@prisma/client';

export class CreateCaseDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiProperty({ description: 'Initial hypothesis — what do you suspect?' })
  @IsString()
  hypothesis!: string;

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

  @ApiProperty({
    description: 'At least one hypothesis UUID this evidence should be linked to. Evidence without a hypothesis is not allowed.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  hypothesisIds!: string[];

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
  @ApiProperty({ description: 'CaseEvidence id the finding belongs to' })
  @IsString()
  caseEvidenceId!: string;

  @ApiProperty({ description: 'Finding UUID' })
  @IsString()
  findingId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/** Resolved display info for an evidence asset. */
export class EvidenceEntityDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiPropertyOptional()
  assetType?: string;

  @ApiPropertyOptional()
  sourceType?: string;

  @ApiPropertyOptional({ description: 'True when the referenced row no longer exists' })
  missing?: boolean;
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
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ type: [CaseEvidenceDto] })
  evidence?: CaseEvidenceDto[];
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
