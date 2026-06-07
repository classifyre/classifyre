import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
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
}

export class LinkEvidenceDto {
  @ApiProperty({ description: 'CaseEvidence id to link to this hypothesis' })
  @IsString()
  caseEvidenceId!: string;

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

export class HypothesisEvidenceLinkDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseEvidenceId!: string;

  @ApiProperty({ enum: EvidenceStance })
  stance!: EvidenceStance;

  @ApiPropertyOptional()
  weight?: number | null;

  @ApiPropertyOptional()
  note?: string | null;

  @ApiPropertyOptional({ description: 'Display label for the linked evidence entity' })
  evidenceLabel?: string | null;
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

  @ApiProperty({ description: 'Count of linked SUPPORTS evidence' })
  supportingCount!: number;

  @ApiProperty({ description: 'Count of linked CONTRADICTS evidence' })
  contradictingCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: [HypothesisEvidenceLinkDto] })
  links!: HypothesisEvidenceLinkDto[];
}
