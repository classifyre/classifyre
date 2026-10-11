import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  EMBEDDING_MEDIA_FORMATS,
  MEDIA_MODALITIES,
} from '../embedding-modality';

/**
 * One configuration knob, as the settings page needs to render it.
 *
 * The pair matters: an operator changing a model has to see what the
 * deployment asked for (Helm values, or the image's own defaults) next to
 * what this workspace chose, or "reset to default" is a button with an unknown
 * destination.
 */
@ApiExtraModels()
export class EmbeddingSettingValueDto {
  @ApiProperty({ description: 'Value currently in force for this workspace' })
  value!: string | number | boolean | null;

  @ApiProperty({
    description:
      'What the deployment configured (Helm values, or the image defaults)',
  })
  deploymentDefault!: string | number | boolean | null;

  @ApiProperty({ description: 'Whether this workspace overrides the default' })
  overridden!: boolean;
}

export class EmbeddingSpaceStatsDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() model!: string;
  @ApiProperty() revision!: string;
  @ApiProperty() dimensions!: number;
  @ApiProperty() pooling!: string;
  @ApiProperty() normalized!: boolean;
  @ApiProperty({
    description: 'Whether new vectors and searches use this space',
  })
  isActive!: boolean;
  @ApiProperty() vectors!: number;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) lastRecalibratedAt?: string | null;
}

export class EmbeddingStatsDto {
  @ApiProperty({ type: [EmbeddingSpaceStatsDto] })
  spaces!: EmbeddingSpaceStatsDto[];

  @ApiProperty({ description: 'Vectors stored in the active space' })
  vectors!: number;

  @ApiProperty({
    description: 'Vectors across every space — what actually occupies disk',
  })
  vectorsAllSpaces!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Bytes held by the vector table and its HNSW indexes',
  })
  storageBytes?: number | null;

  @ApiProperty({
    description:
      'Pictures and sound clips stored for embedding, of every modality',
  })
  mediaChunks!: number;

  @ApiProperty({ description: 'Bytes those prepared media items occupy' })
  mediaBytes!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Bytes held by the evidence-ranking table derived from vectors',
  })
  analysisStorageBytes?: number | null;

  @ApiProperty({
    description: 'Text chunks eligible for embedding (media is counted apart)',
  })
  chunks!: number;

  @ApiProperty({ description: 'Findings carrying embeddable evidence text' })
  embeddableFindings!: number;

  @ApiProperty({ description: 'Findings ranked from the active space' })
  rankedFindings!: number;
}

/** An AI provider that can serve embeddings, for the remote-provider picker. */
export class EmbeddingAiProviderOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() provider!: string;
  @ApiPropertyOptional({ nullable: true }) baseUrl?: string | null;
  @ApiProperty({ description: 'Whether an API key is stored for it' })
  hasApiKey!: boolean;

  @ApiProperty({
    description:
      'Whether the provider is marked as serving an embeddings endpoint',
  })
  supportsEmbedding!: boolean;

  @ApiProperty({
    enum: MEDIA_MODALITIES,
    isArray: true,
    description: 'What its embedding model takes besides text',
  })
  embeddingModalities!: string[];

  @ApiPropertyOptional({ nullable: true, enum: EMBEDDING_MEDIA_FORMATS })
  embeddingMediaFormat?: string | null;
}

/** Megabytes a local model downloads, per part. */
export class EmbeddingLocalModelDownloadDto {
  @ApiProperty() text!: number;
  @ApiPropertyOptional() image?: number;
  @ApiPropertyOptional() audio?: number;
}

/** A model the built-in provider is known to run, for the model picker. */
export class EmbeddingLocalModelDto {
  @ApiProperty({
    description: 'Hugging Face repository holding the ONNX files',
  })
  id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() dimensions!: number;
  @ApiProperty({
    enum: ['mean', 'cls', 'last_token', 'none'],
    description:
      'How the model is pooled. Picking the model resets pooling to this.',
  })
  pooling!: string;

  @ApiProperty({
    enum: MEDIA_MODALITIES,
    isArray: true,
    description: 'What it embeds besides text. Empty for a text-only model.',
  })
  mediaModalities!: string[];

  @ApiProperty({
    type: [String],
    description:
      'Other names accepted for it, such as the repository of the original (non-ONNX) weights',
  })
  aliases!: string[];

  @ApiPropertyOptional({
    nullable: true,
    type: EmbeddingLocalModelDownloadDto,
    description: 'Megabytes fetched on first use at q8, where stated',
  })
  downloadMb?: EmbeddingLocalModelDownloadDto | null;
}

@ApiExtraModels(EmbeddingSettingValueDto)
export class EmbeddingSettingsResponseDto {
  @ApiProperty({
    description:
      'Semantic embedding is on for this workspace. Read-only here: it is turned on or off in Settings → Cleanup › Features (PUT /maintenance/features/embeddings).',
  })
  enabled!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['kept', 'deleted'],
    description:
      'How embeddings were turned off: "kept" is a pause (vectors, rankings and text chunks stay, and scans keep saving chunks), "deleted" purged all of it. Null while on.',
  })
  disabledMode?: 'kept' | 'deleted' | null;

  @ApiProperty({
    description: 'transformers-js (local inference) or openai-compatible',
  })
  provider!: string;

  @ApiProperty() model!: string;
  @ApiProperty() revision!: string;
  @ApiProperty() dimensions!: number;
  @ApiProperty() pooling!: string;
  @ApiProperty() normalize!: boolean;
  @ApiProperty() batchSize!: number;
  @ApiProperty() workerConcurrency!: number;
  @ApiProperty() maxParallelCalls!: number;
  @ApiProperty() intraOpThreads!: number;
  @ApiProperty() dtype!: string;
  @ApiProperty() device!: string;
  @ApiProperty() autoBackfill!: boolean;
  @ApiProperty() hnswM!: number;
  @ApiProperty() hnswEfConstruction!: number;
  @ApiProperty() hnswEfSearch!: number;

  @ApiProperty({
    description:
      'Whether this workspace wants pictures embedded as pictures. Takes effect only on a model that can (see supportedMedia).',
  })
  embedImages!: boolean;

  @ApiProperty({
    description:
      'Whether this workspace wants sound embedded as sound. Takes effect only on a model that can.',
  })
  embedAudio!: boolean;

  @ApiProperty({
    enum: MEDIA_MODALITIES,
    isArray: true,
    description:
      'What the model in use can embed besides text, in the same vector space',
  })
  supportedMedia!: string[];

  @ApiProperty({
    enum: MEDIA_MODALITIES,
    isArray: true,
    description:
      'What is embedded besides text right now: wanted by the workspace and supported by the model',
  })
  mediaModalities!: string[];

  @ApiPropertyOptional({
    nullable: true,
    enum: EMBEDDING_MEDIA_FORMATS,
    description: 'Request shape the bound remote provider takes media in',
  })
  mediaFormat?: string | null;

  @ApiProperty({
    type: [EmbeddingLocalModelDto],
    description: 'Models the built-in provider is known to run',
  })
  localModels!: EmbeddingLocalModelDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'AI provider supplying the remote embedding endpoint and key',
  })
  aiProviderConfigId?: string | null;

  @ApiProperty({
    description:
      'Whether this deployment may download models from Hugging Face. False by default in the all-in-one Docker image, which bakes in one pinned model so it works offline — a different local model cannot be fetched there unless EMBEDDING_ALLOW_REMOTE_MODELS is turned on.',
  })
  allowRemoteModels!: boolean;

  @ApiProperty({
    description:
      'Per-field deployment defaults and whether this workspace overrides them',
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(EmbeddingSettingValueDto) },
  })
  fields!: Record<string, EmbeddingSettingValueDto>;

  @ApiProperty({
    type: [EmbeddingAiProviderOptionDto],
    description: 'AI providers available to serve embeddings',
  })
  aiProviders!: EmbeddingAiProviderOptionDto[];

  @ApiProperty({
    description:
      'Fields that redefine the vector space, so changing them forces a rebuild',
    type: [String],
  })
  rebuildTriggerFields!: string[];

  @ApiProperty({ type: EmbeddingStatsDto })
  stats!: EmbeddingStatsDto;

  @ApiProperty({ description: 'A rebuild is in flight right now' })
  rebuildRunning!: boolean;

  @ApiPropertyOptional({ nullable: true }) rebuildStartedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) rebuildCompletedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) rebuildError?: string | null;
  @ApiPropertyOptional({ nullable: true }) rebuildReason?: string | null;
}

/**
 * A patch. Undefined leaves a field alone; **null clears the override** and
 * returns the field to the deployment default, which is what the page's
 * "use default" control sends.
 */
export class UpdateEmbeddingSettingsDto {
  // No `enabled` here: the on/off switch lives with the other feature switches
  // (PUT /maintenance/features/embeddings), which is also what holds the
  // embedding queues paused and offers keeping or deleting the corpus. A patch
  // carrying it is refused rather than half-applied.
  @ApiPropertyOptional({
    nullable: true,
    enum: ['transformers-js', 'openai-compatible'],
  })
  provider?: string | null;
  @ApiPropertyOptional({ nullable: true }) model?: string | null;
  @ApiPropertyOptional({ nullable: true }) revision?: string | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 2000 })
  dimensions?: number | null;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['mean', 'cls', 'last_token', 'none'],
  })
  pooling?: string | null;
  @ApiPropertyOptional({ nullable: true }) normalize?: boolean | null;
  @ApiPropertyOptional({ nullable: true }) aiProviderConfigId?: string | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 256 })
  batchSize?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 32 })
  workerConcurrency?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 32 })
  maxParallelCalls?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 16 })
  intraOpThreads?: number | null;
  @ApiPropertyOptional({ nullable: true }) dtype?: string | null;
  @ApiPropertyOptional({ nullable: true }) device?: string | null;
  @ApiPropertyOptional({ nullable: true }) autoBackfill?: boolean | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Embed pictures as pictures when the model can. Turning it off deletes the stored pictures and their vectors.',
  })
  embedImages?: boolean | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Embed sound as sound when the model can. Turning it off deletes the stored clips and their vectors.',
  })
  embedAudio?: boolean | null;
  @ApiPropertyOptional({ nullable: true, minimum: 2, maximum: 100 })
  hnswM?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 4, maximum: 2000 })
  hnswEfConstruction?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 2000 })
  hnswEfSearch?: number | null;
}

export class UpdateEmbeddingSettingsResponseDto {
  @ApiProperty({ type: EmbeddingSettingsResponseDto })
  settings!: EmbeddingSettingsResponseDto;

  @ApiProperty({
    description:
      'The change redefined the vector space, so a rebuild was started',
  })
  rebuildStarted!: boolean;

  @ApiProperty({ type: [String], description: 'Fields whose value changed' })
  changedFields!: string[];
}

export class EmbeddingRebuildResponseDto {
  @ApiProperty() started!: boolean;
}
