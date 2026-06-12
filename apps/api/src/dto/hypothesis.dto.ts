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
import { EvidenceStance, HypothesisStatus } from '@prisma/client';

export class CreateHypothesisDto {
  @ApiProperty()
  @IsString()
  statement!: string;

  @ApiPropertyOptional({ enum: HypothesisStatus, default: HypothesisStatus.PROPOSED })
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

export class UpdateHypothesisDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  statement?: string;

  @ApiPropertyOptional({ enum: HypothesisStatus })
  @IsOptional()
  @IsEnum(HypothesisStatus)
  status?: HypothesisStatus;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number | null;

  @ApiPropertyOptional({ description: 'Hex color string for graph visualization (e.g. "#ef4444")', nullable: true })
  @IsOptional()
  @IsString()
  color?: string | null;
}

/** Link a piece of question evidence OR a question finding to a hypothesis with a stance. */
export class LinkSupportDto {
  @ApiProperty({ enum: ['evidence', 'finding'], description: 'What is being linked' })
  @IsIn(['evidence', 'finding'])
  targetType!: 'evidence' | 'finding';

  @ApiProperty({ description: 'QuestionEvidence.id or QuestionFinding.id' })
  @IsString()
  targetId!: string;

  @ApiPropertyOptional({ enum: EvidenceStance, default: EvidenceStance.SUPPORTS })
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

export class HypothesisSupportLinkDto {
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

  @ApiProperty({ description: 'Display label for the linked target' })
  targetLabel!: string;
}

export class HypothesisResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseId!: string;

  @ApiProperty()
  statement!: string;

  @ApiProperty({ enum: HypothesisStatus })
  status!: HypothesisStatus;

  @ApiPropertyOptional()
  confidence?: number | null;

  @ApiPropertyOptional()
  createdBy?: string | null;

  @ApiProperty({ description: 'Count of SUPPORTS links' })
  supportingCount!: number;

  @ApiProperty({ description: 'Count of CONTRADICTS links' })
  contradictingCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ description: 'Custom hex color for graph visualization', nullable: true })
  color?: string | null;

  @ApiProperty({ type: [HypothesisSupportLinkDto] })
  links!: HypothesisSupportLinkDto[];
}
