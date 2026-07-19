import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CaseEventPrecision } from '@prisma/client';

export class CreateCaseEventDto {
  @ApiProperty({ description: 'When the real-world event happened' })
  @Type(() => Date)
  @IsDate()
  occurredAt!: Date;

  @ApiPropertyOptional({ enum: CaseEventPrecision, default: 'DAY' })
  @IsOptional()
  @IsEnum(CaseEventPrecision)
  precision?: CaseEventPrecision;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findingIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceIds?: string[];

  @ApiPropertyOptional({ description: 'Actor recorded as createdBy' })
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class UpdateCaseEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;

  @ApiPropertyOptional({ enum: CaseEventPrecision })
  @IsOptional()
  @IsEnum(CaseEventPrecision)
  precision?: CaseEventPrecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findingIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceIds?: string[];

  @ApiPropertyOptional({ description: 'Explicitly mark the event verified' })
  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  updatedBy?: string;
}

export class CaseEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseId!: string;

  @ApiProperty()
  occurredAt!: Date;

  @ApiProperty({ enum: CaseEventPrecision })
  precision!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 1 })
  confidence?: number | null;

  @ApiProperty({
    description: 'AGENT-extracted events are unverified hypotheses',
  })
  origin!: string;

  @ApiProperty()
  verified!: boolean;

  @ApiPropertyOptional({ nullable: true })
  verifiedBy?: string | null;

  @ApiProperty({ type: [String] })
  findingIds!: string[];

  @ApiProperty({ type: [String] })
  evidenceIds!: string[];

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
