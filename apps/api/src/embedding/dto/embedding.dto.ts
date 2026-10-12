import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MEDIA_MODALITIES } from '../embedding-modality';

export class AssetChunkDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  ordinal!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  charOffset!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  charLength!: number;

  @ApiProperty()
  @IsString()
  text!: string;
}

/**
 * A picture or sound clip prepared from an asset, to be embedded as what it
 * is. Prepared by the scan the way `GET /embeddings/collection` asks for it.
 */
export class AssetMediaChunkDto {
  @ApiProperty({ enum: MEDIA_MODALITIES })
  @IsIn(MEDIA_MODALITIES)
  modality!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ description: 'The prepared bytes, base64-encoded' })
  @IsString()
  data!: string;

  @ApiPropertyOptional({
    description: 'Page, frame or clip number within the asset, from 1',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
}

export class PutAssetChunksDto {
  @ApiProperty()
  @IsString()
  assetHash!: string;

  @ApiProperty({ type: [AssetChunkDto], maxItems: 5000 })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => AssetChunkDto)
  chunks!: AssetChunkDto[];

  @ApiPropertyOptional({ type: [AssetMediaChunkDto], maxItems: 64 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => AssetMediaChunkDto)
  media?: AssetMediaChunkDto[];
}

/** One kind of media a scan should prepare, and how. */
export class EmbeddingCollectionMediaDto {
  @ApiProperty({ enum: MEDIA_MODALITIES })
  modality!: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType!: string;

  @ApiProperty({ description: 'Most items taken from one asset' })
  maxItems!: number;

  @ApiProperty({
    description:
      'Key the scan records in the asset scan-cache state, with `fingerprint` as its value, once this media was sent',
    example: 'EMBED_MEDIA::image',
  })
  cacheKey!: string;

  @ApiProperty({
    description:
      'Changes whenever the way this kind of media is prepared changes; an asset recorded under another value sends its media again',
  })
  fingerprint!: string;

  @ApiPropertyOptional({ description: 'Pictures: longest edge, in pixels' })
  maxEdge?: number;

  @ApiPropertyOptional({ description: 'Pictures: JPEG quality, 1-100' })
  quality?: number;

  @ApiPropertyOptional({ description: 'Sound: sample rate, in Hz' })
  sampleRate?: number;

  @ApiPropertyOptional({ description: 'Sound: length of one clip, in seconds' })
  clipSeconds?: number;
}

/** What a scan should send for embedding in this workspace right now. */
export class EmbeddingCollectionPlanDto {
  @ApiProperty({
    description:
      'Whether text chunks are stored at all (false after embeddings were turned off and deleted)',
  })
  chunks!: boolean;

  @ApiProperty({ type: [EmbeddingCollectionMediaDto] })
  media!: EmbeddingCollectionMediaDto[];
}

export class SimilarFindingsQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class BoilerplateClustersQueryDto {
  @ApiPropertyOptional({ default: 0.95, minimum: 0.8, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.8)
  @Max(1)
  threshold = 0.95;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class GlobalBoilerplateClustersQueryDto extends BoilerplateClustersQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Restrict clusters to findings from these sources; omit for the whole corpus',
  })
  @IsOptional()
  sourceIds?: string[] | string;
}

export class EmbeddingRecalibrateResponseDto {
  @ApiProperty()
  scheduled!: boolean;
}

/** Inference worker health, as the provider service reports it. */
export class EmbeddingProviderHealthDto {
  @ApiProperty({
    description:
      'The local inference worker is paused after repeated native failures',
  })
  workerDisabled!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the paused worker is probed again',
  })
  workerRetryAt?: string | null;

  @ApiProperty()
  requestErrorCount!: number;

  @ApiPropertyOptional({ nullable: true })
  lastRequestError?: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastRequestErrorAt?: string | null;

  @ApiProperty({
    description:
      'Native aborts of the forked inference child since this process started. onnxruntime can abort natively when an allocation fails under memory pressure; the fork contains that (the batch fails and is retried) but leaves nothing visible in the product, so it is counted here.',
    example: 0,
  })
  workerCrashCount!: number;

  @ApiPropertyOptional({ nullable: true })
  lastWorkerCrashAt?: string | null;

  @ApiProperty({
    description:
      'Native aborts since the last successful embed. The breaker opens when this reaches its threshold.',
    example: 0,
  })
  consecutiveWorkerFailures!: number;

  @ApiProperty({
    description:
      'How many times the breaker has opened. Drives the cooldown backoff and resets on a successful embed.',
    example: 0,
  })
  breakerTrips!: number;
}

export class EmbeddingStatusResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  pgvector!: boolean;

  @ApiPropertyOptional({ nullable: true })
  pgvectorVersion?: string | null;

  @ApiProperty()
  searchStrategy!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  dimensions!: number;

  @ApiPropertyOptional({ nullable: true })
  spaceId?: string | null;

  @ApiProperty()
  persistentQueue!: boolean;

  @ApiProperty()
  pendingQueueWrites!: number;

  @ApiProperty()
  workerRegistered!: boolean;

  @ApiProperty()
  autoBackfill!: boolean;

  @ApiProperty()
  backfillRunning!: boolean;

  @ApiPropertyOptional({ nullable: true })
  backfillStartedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  backfillCompletedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  backfillError?: string | null;

  @ApiProperty({
    description:
      'A recalibration pass is queued (debounced) but not yet running',
  })
  recalibrationScheduled!: boolean;

  @ApiProperty()
  recalibrationRunning!: boolean;

  @ApiPropertyOptional({ nullable: true })
  lastRecalibratedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastRecalibrationError?: string | null;

  // Returned by the queue since it was written, but never declared — so the
  // generated client could not see the numbers the settings page needs.
  @ApiPropertyOptional({
    nullable: true,
    description: 'Vectors stored in the active space',
  })
  embeddedRows?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Embedding batches queued, active or deferred',
  })
  pendingEmbedJobs?: number | null;

  @ApiProperty({ description: 'Embedding batches that failed since startup' })
  embedJobFailureCount!: number;

  @ApiPropertyOptional({ nullable: true })
  lastEmbedJobError?: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastEmbedJobErrorAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastEmbedSuccessAt?: string | null;

  @ApiProperty({
    type: EmbeddingProviderHealthDto,
    description: 'Inference worker health and circuit-breaker state',
  })
  providerHealth!: EmbeddingProviderHealthDto;
}

export class EmbeddingReindexResponseDto {
  @ApiProperty()
  started!: boolean;

  @ApiProperty()
  spaceId!: string;
}

export class SimilarFindingAssetDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class SimilarFindingSourceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class SimilarFindingEvidenceAnalysisDto {
  @ApiProperty()
  importanceScore!: number;

  @ApiProperty()
  qualityScore!: number;

  @ApiProperty()
  similarCount!: number;

  @ApiPropertyOptional({ nullable: true })
  duplicateGroupHash?: string | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  reasons!: Array<Record<string, unknown>>;
}

export class SimilarFindingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  findingType!: string;

  @ApiProperty()
  severity!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  matchedContent!: string;

  @ApiProperty({ minimum: -1, maximum: 1 })
  similarity!: number;

  @ApiProperty()
  confidence!: number;

  @ApiProperty()
  assetId!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiPropertyOptional({ type: SimilarFindingAssetDto, nullable: true })
  asset?: SimilarFindingAssetDto | null;

  @ApiPropertyOptional({ type: SimilarFindingSourceDto, nullable: true })
  source?: SimilarFindingSourceDto | null;

  @ApiPropertyOptional({
    type: SimilarFindingEvidenceAnalysisDto,
    nullable: true,
  })
  evidenceAnalysis?: SimilarFindingEvidenceAnalysisDto | null;
}

export class BoilerplateClusterDto {
  @ApiProperty()
  groupHash!: string;

  @ApiProperty()
  findingCount!: number;

  @ApiProperty({ type: [String] })
  findingIds!: string[];

  @ApiProperty()
  meanImportance!: number;

  @ApiProperty({
    description: 'Distinct sources the cluster spans (>1 = cross-source)',
  })
  sourceCount!: number;

  @ApiProperty({ type: [String] })
  sourceIds!: string[];

  @ApiProperty({
    type: [String],
    description: 'Assets containing the clustered findings (up to 50)',
  })
  assetIds!: string[];

  @ApiProperty()
  threshold!: number;
}
