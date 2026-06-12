import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  CaseThreadKind,
  CaseThreadEntryType,
  EvidenceStance,
  HypothesisStatus,
} from '@prisma/client';

// ─── Create / Update ──────────────────────────────────────────────────────────

export class CreateThreadDto {
  @ApiProperty({ enum: CaseThreadKind, default: CaseThreadKind.HYPOTHESIS })
  @IsEnum(CaseThreadKind)
  kind!: CaseThreadKind;

  @ApiProperty({ description: 'Short display title (hypothesis name or discussion topic)' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ description: 'Initial statement body (hypothesis threads)' })
  @IsOptional()
  @IsString()
  statement?: string;

  @ApiPropertyOptional({ enum: HypothesisStatus })
  @IsOptional()
  @IsEnum(HypothesisStatus)
  status?: HypothesisStatus;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class UpdateThreadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ enum: HypothesisStatus, nullable: true })
  @IsOptional()
  @IsEnum(HypothesisStatus)
  status?: HypothesisStatus | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actor?: string;
}

export class AddThreadEntryDto {
  @ApiProperty({ enum: CaseThreadEntryType })
  @IsEnum(CaseThreadEntryType)
  entryType!: CaseThreadEntryType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  author?: string;
}

export class LinkThreadSupportDto {
  @ApiProperty({ enum: ['evidence', 'finding'] })
  @IsIn(['evidence', 'finding'])
  targetType!: 'evidence' | 'finding';

  @ApiProperty()
  @IsString()
  targetId!: string;

  @ApiPropertyOptional({ enum: EvidenceStance })
  @IsOptional()
  @IsEnum(EvidenceStance)
  stance?: EvidenceStance;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

// ─── Response shapes ──────────────────────────────────────────────────────────

export class ThreadSupportLinkDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['evidence', 'finding'] })
  targetType!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ enum: EvidenceStance })
  stance!: EvidenceStance;

  @ApiPropertyOptional()
  weight?: number | null;

  @ApiPropertyOptional()
  note?: string | null;

  @ApiProperty()
  targetLabel!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class ThreadEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty({ enum: CaseThreadEntryType })
  entryType!: CaseThreadEntryType;

  @ApiPropertyOptional()
  body?: string | null;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  author?: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class ThreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseId!: string;

  @ApiProperty({ enum: CaseThreadKind })
  kind!: CaseThreadKind;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ enum: HypothesisStatus, nullable: true })
  status?: HypothesisStatus | null;

  @ApiPropertyOptional({ nullable: true })
  confidence?: number | null;

  @ApiPropertyOptional({ nullable: true })
  color?: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdBy?: string | null;

  @ApiProperty({ description: 'Count of SUPPORTS links' })
  supportingCount!: number;

  @ApiProperty({ description: 'Count of CONTRADICTS links' })
  contradictingCount!: number;

  @ApiProperty({ type: [ThreadSupportLinkDto] })
  links!: ThreadSupportLinkDto[];

  @ApiProperty({ type: [ThreadEntryDto] })
  entries!: ThreadEntryDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class ThreadEntriesResponseDto {
  @ApiProperty({ type: [ThreadEntryDto] })
  items!: ThreadEntryDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor!: string | null;
}
