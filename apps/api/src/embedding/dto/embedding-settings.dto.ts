import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

/**
 * One configuration knob, as the settings page needs to render it.
 *
 * The pair matters: an operator changing a model has to see what the
 * deployment asked for (Helm values, or the desktop bundle's defaults) next to
 * what this workspace chose, or "reset to default" is a button with an unknown
 * destination.
 */
@ApiExtraModels()
export class EmbeddingSettingValueDto {
  @ApiProperty({ description: 'Value currently in force for this workspace' })
  value!: string | number | boolean | null;

  @ApiProperty({
    description:
      'What the deployment configured (Helm values, or the desktop defaults)',
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

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Bytes held by the evidence-ranking table derived from vectors',
  })
  analysisStorageBytes?: number | null;

  @ApiProperty({ description: 'Text chunks eligible for embedding' })
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
}

@ApiExtraModels(EmbeddingSettingValueDto)
export class EmbeddingSettingsResponseDto {
  @ApiProperty({ description: 'Semantic embedding is on for this workspace' })
  enabled!: boolean;

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

  @ApiPropertyOptional({
    nullable: true,
    description: 'AI provider supplying the remote embedding endpoint and key',
  })
  aiProviderConfigId?: string | null;

  @ApiProperty({
    description:
      'Whether this deployment may download models from Hugging Face. False in the packaged desktop app, which ships one pinned model and runs offline — so a different local model cannot be fetched there.',
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
  @ApiPropertyOptional({ nullable: true }) enabled?: boolean | null;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['transformers-js', 'openai-compatible'],
  })
  provider?: string | null;
  @ApiPropertyOptional({ nullable: true }) model?: string | null;
  @ApiPropertyOptional({ nullable: true }) revision?: string | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 2000 })
  dimensions?: number | null;
  @ApiPropertyOptional({ nullable: true, enum: ['mean', 'cls', 'none'] })
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
