import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CaseLeadOrigin, CaseLeadStatus } from '@prisma/client';

export class ListCaseLeadsQueryDto {
  @ApiPropertyOptional({ enum: CaseLeadStatus })
  @IsOptional()
  @IsEnum(CaseLeadStatus)
  status?: CaseLeadStatus;
}

export class ProposeCaseLeadDto {
  @ApiProperty()
  @IsUUID()
  findingId!: string;

  @ApiProperty({ description: 'Why this finding might belong in the case' })
  @IsString()
  @MaxLength(2000)
  rationale!: string;

  @ApiPropertyOptional({ description: 'Actor recorded as proposedBy' })
  @IsOptional()
  @IsString()
  proposedBy?: string;
}

export class ReviewCaseLeadDto {
  @ApiProperty({ enum: ['ACCEPT', 'DISMISS'] })
  @IsIn(['ACCEPT', 'DISMISS'])
  action!: 'ACCEPT' | 'DISMISS';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewedBy?: string;

  @ApiPropertyOptional({ description: 'Why the lead was dismissed' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CaseLeadDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseId!: string;

  @ApiProperty()
  findingId!: string;

  @ApiPropertyOptional({ nullable: true })
  assetId?: string | null;

  @ApiProperty({ enum: CaseLeadOrigin })
  origin!: string;

  @ApiProperty({ enum: CaseLeadStatus })
  status!: string;

  @ApiProperty()
  rationale!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  importance?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 1 })
  similarity?: number | null;

  @ApiProperty()
  proposedBy!: string;

  @ApiPropertyOptional({ nullable: true })
  reviewedBy?: string | null;

  @ApiPropertyOptional({ nullable: true })
  reviewedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class GenerateCaseLeadsResponseDto {
  @ApiProperty()
  proposed!: number;

  @ApiProperty()
  considered!: number;
}
