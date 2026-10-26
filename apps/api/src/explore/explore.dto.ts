import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  EXPLORE_KINDS,
  EXPLORE_SCOPES,
  type ExploreKind,
  type ExploreScope,
} from './explore-kinds';

export const DUPLICATE_FAMILIES = [
  'SHARED_LABELS',
  'PHONETIC',
  'IDENTICAL_CONTENT',
  'NEAR_DUPLICATE_TEXT',
] as const;
export const DUPLICATE_REVIEW_STATES = ['any', 'open', 'confirmed'] as const;

/** Which of duplicate review's pairs to draw. */
export class ExploreDuplicatesFilterDto {
  @ApiPropertyOptional({ description: 'Only the pairs of this pattern' })
  @IsOptional()
  @IsString()
  patternKey?: string;

  @ApiPropertyOptional({
    enum: DUPLICATE_FAMILIES,
    description:
      'Only this kind of match: shared values, similar spelling, identical content, repeated text',
  })
  @IsOptional()
  @IsIn(DUPLICATE_FAMILIES)
  family?: (typeof DUPLICATE_FAMILIES)[number];

  @ApiPropertyOptional({
    description: 'Only pairs scored at least this (0–1)',
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore?: number;

  @ApiPropertyOptional({
    enum: DUPLICATE_REVIEW_STATES,
    description:
      'any (default): every pair not ruled apart; open: not reviewed yet (or unsure); confirmed: ruled the same',
  })
  @IsOptional()
  @IsIn(DUPLICATE_REVIEW_STATES)
  review?: (typeof DUPLICATE_REVIEW_STATES)[number];

  @ApiPropertyOptional({
    description: 'Only pairs with an asset in this source',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;
}

export class ExploreNeighbourhoodRequestDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Assets to start from (at most 10)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  assetIds?: string[];

  @ApiPropertyOptional({
    enum: EXPLORE_KINDS,
    enumName: 'ExploreKind',
    isArray: true,
    description: 'Kinds of connection to follow (default: all)',
  })
  @IsOptional()
  @IsArray()
  @IsIn(EXPLORE_KINDS, { each: true })
  kinds?: ExploreKind[];

  @ApiPropertyOptional({
    description:
      'Hops to trace lineage and links (1–6; 6 stands for "all"). Duplicates and shared values go at most 2; meaning and alike are always one hop.',
    minimum: 1,
    maximum: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  depth?: number;

  @ApiPropertyOptional({
    enum: ['up', 'down', 'both'],
    description:
      'Which way to trace lineage and links: where the data came from, where it went, or both (default)',
  })
  @IsOptional()
  @IsIn(['up', 'down', 'both'])
  direction?: 'up' | 'down' | 'both';

  @ApiPropertyOptional({
    description:
      "A source to explore. Without assetIds, Explore starts from the source's most connected assets; with them, it is the source that 'same source' and 'other sources' are measured against.",
  })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({
    enum: EXPLORE_SCOPES,
    description:
      "Which connections to keep: all (default), only those to assets of the same source ('internal'), or only those leaving it ('external'). The same source is `sourceId`, or the starting points' own sources.",
  })
  @IsOptional()
  @IsIn(EXPLORE_SCOPES)
  scope?: ExploreScope;

  @ApiPropertyOptional({
    description:
      'A glossary term to explore: without assetIds, Explore starts from the assets that carry it most, and the term stands between them',
  })
  @IsOptional()
  @IsString()
  termId?: string;

  @ApiPropertyOptional({
    type: ExploreDuplicatesFilterDto,
    description:
      "Without assetIds: draw duplicate review's pairs that match, around the assets with the most of them. scope then keeps pairs inside one source (internal) or across two (external).",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExploreDuplicatesFilterDto)
  duplicates?: ExploreDuplicatesFilterDto;
}

export class ExploreNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "'asset' or 'external' (a URN nothing scanned)" })
  type!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) assetType!:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceType!:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceName!:
    | string
    | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceId!:
    | string
    | null;
  @ApiProperty({
    description:
      "From a source other than the one explored, or than the starting points' own",
  })
  foreign!: boolean;
  @ApiProperty({ description: 'Hops from the nearest seed; 0 for a seed' })
  depth!: number;
  @ApiProperty({
    enum: ['seed', 'up', 'down', 'side'],
    description:
      'Where it stands from the seeds: upstream, downstream, or sideways',
  })
  side!: string;
  @ApiProperty({
    enum: EXPLORE_KINDS,
    enumName: 'ExploreKind',
    isArray: true,
    description: 'Every kind of connection that reached it',
  })
  kinds!: ExploreKind[];
  @ApiProperty({
    type: [String],
    description: 'Cases this asset is evidence in (ids into `cases`)',
  })
  caseIds!: string[];
  @ApiProperty({
    type: [String],
    description:
      'Watches (inquiries) its open findings answer (ids into `inquiries`)',
  })
  inquiryIds!: string[];
}

export class ExploreMarkDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
}

export class ExploreTermDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'CONCEPT or ENTITY' }) kind!: string;
}

export class ExploreEdgeDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "'asset', 'external' or 'term'" })
  fromType!: string;
  @ApiProperty() fromId!: string;
  @ApiProperty({ description: "'asset', 'external' or 'term'" })
  toType!: string;
  @ApiProperty() toId!: string;
  @ApiProperty({ enum: EXPLORE_KINDS, enumName: 'ExploreKind' })
  kind!: ExploreKind;
  @ApiProperty() relationType!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) relationClass!:
    | string
    | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Score of a scored link: shared values, or likeness by meaning',
  })
  confidence!: number | null;
  @ApiProperty({
    description:
      'INFERRED, SOURCE_DERIVED or MANUAL. Only MANUAL links can be changed or removed.',
  })
  origin!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'number' },
    nullable: true,
    description: 'Shared values per label, for duplicates and shared values',
  })
  sharedByLabel!: Record<string, number> | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'What the person who drew a link wrote about it',
  })
  note!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'For alike: the passage of the other asset that read closest',
  })
  passage!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: ['CONFIRMED', 'UNSURE'],
    description:
      'For duplicates and shared values: what duplicate review decided about the pair. Pairs ruled apart are never returned.',
  })
  review?: 'CONFIRMED' | 'UNSURE' | null;
}

export class ExploreNeighbourhoodResponseDto {
  @ApiProperty({ type: [String], description: 'The assets it started from' })
  seeds!: string[];
  @ApiProperty({
    type: [String],
    description:
      "The sources 'same source' is measured against: the explored source, or the starting points' own",
  })
  home!: string[];
  @ApiProperty({ type: [ExploreNodeDto] }) nodes!: ExploreNodeDto[];
  @ApiProperty({ type: [ExploreTermDto] }) terms!: ExploreTermDto[];
  @ApiProperty({ type: [ExploreEdgeDto] }) edges!: ExploreEdgeDto[];
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Assets (not seeds) reached by each kind of connection',
  })
  counts!: Record<ExploreKind, number>;
  @ApiProperty({
    enum: ['ok', 'off'],
    description:
      "'off' when embeddings are switched off, so nothing can be alike by meaning",
  })
  alike!: 'ok' | 'off';
  @ApiProperty({
    description: 'True when some kind hit its bound or ran out of time',
  })
  truncated!: boolean;
  @ApiProperty({
    type: [ExploreMarkDto],
    description: 'Cases holding assets of this view as evidence',
  })
  cases!: ExploreMarkDto[];
  @ApiProperty({
    type: [ExploreMarkDto],
    description: 'Watches (inquiries) answered by assets of this view',
  })
  inquiries!: ExploreMarkDto[];
}

export class ExploreAssetRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceName!:
    | string
    | null;
}

export class ExplorePatternStarterDto {
  @ApiProperty() patternKey!: string;
  @ApiProperty({ type: [String] }) labels!: string[];
  @ApiProperty() family!: string;
  @ApiProperty() pairCount!: number;
  @ApiProperty() assetCount!: number;
  @ApiProperty({
    type: [ExploreAssetRefDto],
    description: 'The strongest pair of this pattern, to start from',
  })
  pair!: ExploreAssetRefDto[];
}

export class ExploreLineageStarterDto {
  @ApiProperty({ type: ExploreAssetRefDto }) asset!: ExploreAssetRefDto;
  @ApiProperty({ description: 'How many lineage links it has' })
  degree!: number;
}

export class ExploreLinkStarterDto {
  @ApiProperty() id!: string;
  @ApiProperty() relationType!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: ExploreAssetRefDto }) from!: ExploreAssetRefDto;
  @ApiProperty({ type: ExploreAssetRefDto }) to!: ExploreAssetRefDto;
  @ApiProperty() createdAt!: Date;
}

export class ExploreStartersResponseDto {
  @ApiProperty({ type: [ExploreLineageStarterDto] })
  lineage!: ExploreLineageStarterDto[];
  @ApiProperty({ type: [ExplorePatternStarterDto] })
  patterns!: ExplorePatternStarterDto[];
  @ApiProperty({ type: [ExploreLinkStarterDto] })
  links!: ExploreLinkStarterDto[];
}

const VIEW_NAMES = ['lineage', 'duplicates', 'connected', 'meaning'] as const;

export class ExplorePositionDto {
  @ApiProperty() x!: number;
  @ApiProperty() y!: number;
}

/** Create or change a saved view; on change, what is left out stays. */
export class SaveExploreViewDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'The assets it starts from (at most 10)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  seedIds?: string[];

  @ApiPropertyOptional({ enum: VIEW_NAMES, nullable: true })
  @IsOptional()
  @IsIn([...VIEW_NAMES, null])
  view?: (typeof VIEW_NAMES)[number] | null;

  @ApiPropertyOptional({
    enum: EXPLORE_KINDS,
    enumName: 'ExploreKind',
    isArray: true,
    description: 'Kinds chosen by hand; empty follows the view',
  })
  @IsOptional()
  @IsArray()
  @IsIn(EXPLORE_KINDS, { each: true })
  kinds?: ExploreKind[];

  @ApiPropertyOptional({ minimum: 1, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  depth?: number;

  @ApiPropertyOptional({ enum: ['up', 'down', 'both'] })
  @IsOptional()
  @IsIn(['up', 'down', 'both'])
  direction?: 'up' | 'down' | 'both';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/ExplorePositionDto' },
    description: 'Node id → where it was dragged to',
  })
  @IsOptional()
  @IsObject()
  positions?: Record<string, ExplorePositionDto>;

  @ApiPropertyOptional({ description: 'Who saved it' })
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class ExploreViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description!:
    | string
    | null;
  @ApiProperty({ type: [String] }) seedIds!: string[];
  @ApiProperty({
    type: [ExploreAssetRefDto],
    description: 'The starting points that still exist, by name',
  })
  seeds!: ExploreAssetRefDto[];
  @ApiPropertyOptional({ enum: VIEW_NAMES, nullable: true })
  view!: string | null;
  @ApiProperty({ enum: EXPLORE_KINDS, enumName: 'ExploreKind', isArray: true })
  kinds!: ExploreKind[];
  @ApiProperty() depth!: number;
  @ApiProperty({ enum: ['up', 'down', 'both'] }) direction!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/ExplorePositionDto' },
  })
  positions!: Record<string, ExplorePositionDto>;
  @ApiPropertyOptional({ type: String, nullable: true }) createdBy!:
    | string
    | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ExploreFindRequestDto {
  @ApiProperty({
    type: [String],
    description: 'The assets on the canvas (at most 400)',
  })
  @IsArray()
  @ArrayMaxSize(400)
  @IsString({ each: true })
  assetIds!: string[];

  @ApiProperty({ description: 'What to find among them: words or a question' })
  @IsString()
  @MaxLength(200)
  q!: string;
}

export class ExploreFindHitDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    enum: ['name', 'words', 'meaning'],
    description: 'Found in its name, in a passage, or closest by meaning',
  })
  how!: 'name' | 'words' | 'meaning';
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Likeness by meaning of its best passage (0–1)',
  })
  score!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) page!: number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The passage that matched',
  })
  text!: string | null;
  @ApiProperty({
    description:
      'Lit on the canvas: a match by name or words, or one of the few that stand out by meaning',
  })
  lit!: boolean;
}

export class ExploreFindResponseDto {
  @ApiProperty({ type: [ExploreFindHitDto] }) hits!: ExploreFindHitDto[];
  @ApiProperty({
    enum: ['ok', 'off'],
    description:
      "'off' when embeddings are off: only names and words were read",
  })
  meaning!: 'ok' | 'off';
}
