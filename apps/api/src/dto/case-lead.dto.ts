import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
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

export class ReviewCaseLeadsDto extends ReviewCaseLeadDto {
  @ApiProperty({
    type: [String],
    description: 'Leads to review with the same decision (at most 200)',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  leadIds!: string[];
}

export class ReviewCaseLeadsResponseDto {
  @ApiProperty({ description: 'Leads whose status changed' })
  updated!: number;

  @ApiProperty({
    description: 'Leads that could not be reviewed (gone, or not in this case)',
  })
  failed!: number;
}

export class CaseLeadDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseId!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'The finding this lead proposes; null for an asset lead (a look-alike document)',
  })
  findingId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  assetId?: string | null;

  @ApiPropertyOptional({
    enum: ['FINDING', 'ASSET'],
    description:
      'FINDING: accepting attaches the finding. ASSET: accepting adds the document; its findings wait around it on the board',
  })
  kind?: 'FINDING' | 'ASSET';

  @ApiPropertyOptional({
    enum: ['OPEN', 'IN_CASE', 'GONE'],
    description:
      'For a PROPOSED lead: OPEN waits for review; IN_CASE joined the case another way; GONE lost its finding or asset. The next refresh settles the last two',
  })
  state?: 'OPEN' | 'IN_CASE' | 'GONE';

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

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 1,
    description:
      'Semantic similarity (SEMANTIC_NEIGHBOR) or the pair match weight (DUPLICATE)',
  })
  similarity?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'The evidence finding this lead resembles',
  })
  viaFindingId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      "The evidence asset this lead hangs off (the duplicated document, or the resembled finding's asset)",
  })
  viaAssetId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'The watch (inquiry) this lead answers',
  })
  viaInquiryId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'What the lead hangs off, in words: the resembled finding, the watch title or the duplicated document',
  })
  viaLabel?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  viaAssetName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'Origin-specific facts: sameValue, isNew, relation (identical_content | likely_duplicate | confirmed), verdict, sharedLabels',
  })
  details?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  findingType?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'The matched value, shortened',
  })
  value?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  severity?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: "The finding's current status (OPEN, RESOLVED, …)",
  })
  findingStatus?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'The document the lead is in, or is',
  })
  assetName?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  assetType?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  sourceType?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  sourceName?: string | null;

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
  @ApiProperty({ description: 'New leads written by this refresh' })
  proposed!: number;

  @ApiProperty({ description: 'Candidates found before quotas and room' })
  considered!: number;

  @ApiPropertyOptional({
    description:
      'Waiting leads the case settled: already in it another way, gone, or filtered out',
  })
  settled?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'New leads per origin',
  })
  byOrigin?: Record<string, number>;

  @ApiPropertyOptional({
    description:
      'The case already holds as many waiting leads as it may; review some first',
  })
  full?: boolean;
}
